import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { createHash } from 'crypto'
import { mkdtempSync } from 'fs'
import { rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { importFiles } from '../importer'
import { assetPaths } from '../repository'
import { exportToFolder, exportToZip } from '../exporter'
import { installAgentSkill, agentSkillStatus, openAgentSkillFolder } from '../agentSkill'
import type { ExportOptions } from '../../shared/types'

/** 白板选区复制的"内容指纹"（里程碑 253/254）：粘贴时用来区分
 *  「板内 Ctrl+C 的选区」与「从浏览器/其他软件复制来的图片」。
 *  不用 HTML 标记——那会让剪贴板多出 text/html，个别偏好 HTML 的软件会粘成空白；
 *  指纹方案下剪贴板保持纯 image/png（实测 writeImage → readImage().toPNG() 字节一致），
 *  粘到微信/其他软件的行为与之前完全相同。 */
let boardClipPrint: { hash: string; size: number; w: number; h: number } | null = null
const pngPrint = (buf: Buffer, w: number, h: number) => ({
  hash: createHash('sha256').update(buf).digest('hex'),
  size: buf.length,
  w,
  h
})
/** 是否白板自己刚复制的图：hash 命中（Windows 实测字节一致）；
 *  兜底用 尺寸+字节数 同形（个别平台读回会重新编码，不保证字节一致）。
 *  先比尺寸再编码——外部大图尺寸不同即短路，避免每次粘贴都编码整张 PNG。 */
function isBoardClipImage(img: ReturnType<typeof clipboard.readImage>): boolean {
  if (!boardClipPrint) return false
  const { width, height } = img.getSize()
  if (width !== boardClipPrint.w || height !== boardClipPrint.h) return false
  const buf = img.toPNG()
  if (boardClipPrint.hash === createHash('sha256').update(buf).digest('hex')) return true
  return buf.length === boardClipPrint.size
}

export function registerSystemIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 系统操作 ---------------- */
  ipcMain.handle('assets:export', async (_e, ids: string[], mode: 'folder' | 'zip', opts: ExportOptions | undefined) => {
    const win = getWindow()
    if (!win || ids.length === 0) return null
    const options: ExportOptions = opts ?? { naming: 'original', groupByTag: false }
    if (mode === 'folder') {
      const r = await dialog.showOpenDialog(win, {
        title: `导出 ${ids.length} 个素材到文件夹`,
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || r.filePaths.length === 0) return null
      return { exported: exportToFolder(ids, r.filePaths[0], options), target: r.filePaths[0] }
    }
    const r = await dialog.showSaveDialog(win, {
      title: `打包 ${ids.length} 个素材为 ZIP`,
      defaultPath: `lumen-export-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    })
    if (r.canceled || !r.filePath) return null
    return { exported: await exportToZip(ids, r.filePath, options), target: r.filePath }
  })

  ipcMain.handle('shell:showItem', (_e, id: string) => {
    const paths = assetPaths(id)
    if (paths) shell.showItemInFolder(paths.original)
  })

  ipcMain.handle('asset:copyImage', (_e, id: string): boolean => {
    const paths = assetPaths(id)
    if (!paths) return false
    const img = nativeImage.createFromPath(paths.original)
    if (img.isEmpty()) return false
    clipboard.writeImage(img)
    return true
  })

  /** 读取系统剪贴板里的图片（里程碑 231）：返回 PNG dataURL，没有图片返回 null。
   *  用于「网站里右键复制图片 → 回 LUMEN 直接粘贴」——paste 事件里的 clipboardData
   *  在跨应用复制时经常拿不到内容，必须回主进程读系统剪贴板 */
  ipcMain.handle('clipboard:readImage', (): string | null => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    return `data:image/png;base64,${img.toPNG().toString('base64')}`
  })

  /** 剪贴板图片导入素材库（里程碑 231）：dataURL 落临时文件后走统一导入管线
   *  （缩略图/查重/拼音/来源标记都复用），导入后删临时目录 */
  ipcMain.handle('clipboard:importImage', async (_e, dataUrl: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return { imported: 0, skipped: 0, failed: 1, failedFiles: [], importedIds: [] }
    const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl)
    if (!m) return { imported: 0, skipped: 0, failed: 1, failedFiles: [], importedIds: [] }
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1].replace('svg+xml', 'svg')
    const buffer = Buffer.from(m[2], 'base64')
    if (buffer.length === 0) return { imported: 0, skipped: 0, failed: 1, failedFiles: [], importedIds: [] }
    const dir = mkdtempSync(join(tmpdir(), 'lumen-paste-'))
    const file = join(dir, `paste_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`)
    try {
      await writeFile(file, buffer)
      return await importFiles([file], { detail: true, source: 'clip' })
    } finally {
      void rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  /** 白板选区复制到系统剪贴板（里程碑 222，借鉴 MOTZ 富剪贴板）：dataURL → nativeImage。
   *  只写图片本身（不附加 HTML 标记，外部软件粘贴行为保持不变）；
   *  另记内容指纹供 `clipboard:readImageInfo` 判断"这张图是不是白板刚复制的"（里程碑 253/254）。 */
  ipcMain.handle('board:copyImage', (_e, dataUrl: string): boolean => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false
    const img = nativeImage.createFromDataURL(dataUrl)
    if (img.isEmpty()) return false
    const { width, height } = img.getSize()
    boardClipPrint = pngPrint(img.toPNG(), width, height)
    clipboard.writeImage(img)
    return true
  })

  /** 系统剪贴板里是否有图片、且是否是白板自己刚复制的选区（里程碑 253/254）。
   *  轻量查询（只有命中指纹时才需要编码比对）：粘贴前先判来源，
   *  决定"导入外部图片"还是"复制板内元素"。 */
  ipcMain.handle('clipboard:readImageInfo', (): { hasImage: boolean; isBoardCopy: boolean } => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return { hasImage: false, isBoardCopy: false }
    return { hasImage: true, isBoardCopy: isBoardClipImage(img) }
  })

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  /* ---------------- Agent 技能 ---------------- */
  ipcMain.handle('agent:installSkill', () => installAgentSkill())
  ipcMain.handle('agent:openSkillFolder', () => openAgentSkillFolder())
  ipcMain.handle('agent:skillStatus', () => agentSkillStatus())
}
