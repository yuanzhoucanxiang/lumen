/**
 * 白板文件（.lumenboard）导入导出：跨设备交换参考白板（对标 MOTZ .motzboard）。
 *
 * 文件格式 = ZIP（store 无压缩）：
 *   manifest.json  白板名 / 参考线 / 元素清单 / 文件映射（assetId -> {file,name,size}）
 *   assets/<assetId>.<ext>  图片原图 / 视频故事板（视频文件太大,跨设备参考用故事板）
 *
 * 导入策略：嵌入图片走真实导入管线（自动去重 + 缩略图/主色/dHash 全量计算），
 * 临时文件名带序号前缀用于映射回 manifest（导入后还原原名）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addBoardItem,
  assetPaths,
  createBoard,
  listBoardItems,
  listBoards,
  queryAssets,
  updateAsset,
  updateBoardAppearance,
  updateBoardGuides,
  updateBoardItem
} from './repository'
import { getDb } from './db'
import { importFiles } from './importer'
import { logger } from './logger'
import { zipRead, zipStore } from './zipLib'
import type { ZipEntry } from './zipLib'
import { VIDEO_EXTS } from '../shared/types'
import type { BoardItem } from '../shared/types'

const MANIFEST = 'manifest.json'
const ASSET_DIR = 'assets'

/** 导出白板为 .lumenboard 文件 */
export function exportBoardToFile(boardId: number, targetPath: string): { count: number; target: string } {
  const db = getDb()
  const board = db.prepare('SELECT id, name, guides, appearance FROM boards WHERE id = ?').get(boardId) as
    | { id: number; name: string; guides: string; appearance: string }
    | undefined
  if (!board) throw new Error('白板不存在')
  const items = listBoardItems(boardId)
  const entries: ZipEntry[] = []
  const files: Record<string, { file: string; name: string; size: number }> = {}
  for (const it of items) {
    if (it.type !== 'asset' || !it.assetId) continue
    const paths = assetPaths(it.assetId)
    if (!paths) continue
    const asset = db.prepare('SELECT name, ext, size FROM assets WHERE id = ?').get(it.assetId) as
      | { name: string; ext: string; size: number }
      | undefined
    if (!asset) continue
    let src: string | null = paths.original
    let ext = asset.ext
    // 视频嵌故事板（视频文件大,参考场景用封面图足够）
    if (VIDEO_EXTS.includes(ext)) {
      const sb = join(paths.dir, 'storyboard.jpg')
      if (existsSync(sb)) {
        src = sb
        ext = 'jpg'
      }
    }
    if (!src || !existsSync(src)) {
      // 原图缺失：退退缩略图
      src = existsSync(paths.thumbnail) ? paths.thumbnail : null
      if (!src) continue
      ext = 'jpg'
    }
    const fname = `${it.assetId}.${ext}`
    entries.push({ name: `${ASSET_DIR}/${fname}`, data: readFileSync(src) })
    files[it.assetId] = { file: fname, name: asset.name, size: asset.size }
  }
  const manifest = {
    app: 'LUMEN',
    format: 'lumenboard',
    version: 1,
    exportedAt: Date.now(),
    board: { name: board.name, guides: board.guides, appearance: board.appearance },
    files,
    items: items.map((i) => {
      const { boardId: _b, ...rest } = i
      return rest
    })
  }
  entries.push({ name: MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8') })
  writeFileSync(targetPath, zipStore(entries))
  return { count: items.length, target: targetPath }
}

interface ManifestItem {
  id: string
  assetId: string | null
  type: 'asset' | 'note' | 'shape'
  x: number
  y: number
  width: number
  height: number
  z: number
  text: string
  noteFont: string
  noteColor: string
  noteFontSize: number
  opacity: number
  shape: string | null
}

interface Manifest {
  app: string
  format: string
  version: number
  board: { name: string; guides: string; appearance?: string }
  files: Record<string, { file: string; name: string; size: number }>
  items: ManifestItem[]
}

/** 导入 .lumenboard：图片入素材库（去重），重建白板与元素 */
export async function importBoardFromFile(filePath: string): Promise<{ boardId: number; name: string; imported: number }> {
  const entries = zipRead(readFileSync(filePath))
  const manifestBuf = entries.get(MANIFEST)
  if (!manifestBuf) throw new Error('.lumenboard 缺少 manifest.json')
  const manifest = JSON.parse(manifestBuf.toString('utf-8')) as Manifest
  if (manifest.app !== 'LUMEN' || manifest.format !== 'lumenboard') throw new Error('不是有效的 LUMEN 白板文件')
  if (manifest.version != null && manifest.version > 1) {
    throw new Error(`白板文件版本过高(version=${manifest.version}),请升级 LUMEN 后再导入`)
  }
  const boardName = String(manifest.board?.name ?? '导入的白板')
  const guides = String(manifest.board?.guides ?? '[]')

  // 1. 图片解包到临时目录（文件名带序号前缀,导入后按前缀映射）
  const tmpDir = mkdtempSync(join(tmpdir(), 'lumenboard-'))
  const tmpFiles: { tmp: string; assetId: string; idx: number }[] = []
  try {
    for (const [fname, buf] of entries) {
      if (!fname.startsWith(`${ASSET_DIR}/`)) continue
      const base = fname.slice(ASSET_DIR.length + 1)
      // 防 Zip Slip：条目名由外部文件控制，只接受 assets/ 下的单段安全文件名，
      // 否则 join(tmpDir, base) 可被 ../ 带出临时目录任意写文件
      if (!base || base.includes('/') || base.includes('\\') || base.includes('..')) {
        logger.warn('[boardFile]', `跳过可疑的 ZIP 条目: ${fname}`)
        continue
      }
      const assetId = base.replace(/\.[^.]+$/, '')
      // 写盘文件名白名单化（NTFS 冒号会写进备用数据流等奇异路径）
      const safeName = base.replace(/[^A-Za-z0-9._-]/g, '_')
      const tmp = join(tmpDir, `lumenboard-${tmpFiles.length}-${safeName}`)
      writeFileSync(tmp, buf)
      tmpFiles.push({ tmp, assetId, idx: tmpFiles.length })
    }

    // 2. 走真实导入管线（去重/缩略图/主色/dHash）
    if (tmpFiles.length > 0) {
      const r = await importFiles(tmpFiles.map((f) => f.tmp))
      if (r.failed > 0) logger.warn('[boardFile]', `导入 ${r.failed} 个文件失败`)
    }

    // 3. manifest assetId -> 库内 asset id（优先序号前缀;去重跳过时按 原名+size 兜底）
    const idMap = new Map<string, string>()
    for (const f of tmpFiles) {
      const meta = manifest.files?.[f.assetId]
      const stem = `lumenboard-${f.idx}-`
      let hit = queryAssets({ keyword: stem, limit: 10 }).find((a) => a.name.startsWith(stem))
      if (!hit && meta) {
        const stem2 = meta.name.replace(/\.[^.]+$/, '')
        const byName = queryAssets({ keyword: stem2, limit: 50 }).find((a) => a.size === meta.size)
        if (byName) hit = byName
      }
      if (hit) {
        idMap.set(f.assetId, hit.id)
        // 还原原名（去掉序号前缀）
        if (meta && hit.name.startsWith(stem)) {
          updateAsset(hit.id, { name: meta.name })
        }
      } else {
        logger.warn('[boardFile]', `找不到导入素材映射: ${f.assetId}`)
      }
    }

    // 4. 建白板（同名冲突加后缀）
    let name = boardName
    if (listBoards().some((b) => b.name === name)) name = `${boardName}（导入）`
    const board = createBoard(name)
    updateBoardGuides(board.id, guides)
    // 画布外观（背景/网格）随文件还原
    if (manifest.board?.appearance) {
      try {
        updateBoardAppearance(board.id, manifest.board.appearance)
      } catch {
        /* 外观 JSON 异常时保持默认，不阻断导入 */
      }
    }

    // 5. 重建元素（保持 z 顺序；asset 映射失败的丢弃）
    let imported = 0
    for (const it of manifest.items ?? []) {
      if (it.type === 'asset' && it.assetId) {
        const mappedId = idMap.get(it.assetId)
        if (!mappedId) {
          logger.warn('[boardFile]', `丢弃无图片元素: ${it.id}`)
          continue
        }
        const row = await addItemSafe(board.id, {
          assetId: mappedId,
          type: 'asset',
          x: it.x,
          y: it.y,
          width: it.width,
          height: it.height,
          text: ''
        })
        if (row) {
          await updateBoardItem(row.id, { z: it.z, opacity: it.opacity ?? 100 })
          imported++
        }
      } else if (it.type === 'note') {
        const row = await addItemSafe(board.id, {
          type: 'note',
          x: it.x,
          y: it.y,
          width: it.width,
          height: it.height,
          text: it.text ?? ''
        })
        if (row) {
          await updateBoardItem(row.id, {
            z: it.z,
            opacity: it.opacity ?? 100,
            noteFont: it.noteFont ?? '',
            noteColor: it.noteColor ?? '',
            noteFontSize: it.noteFontSize ?? 16
          })
          imported++
        }
      } else if (it.type === 'shape' && it.shape) {
        const row = await addItemSafe(board.id, {
          type: 'shape',
          x: it.x,
          y: it.y,
          width: it.width,
          height: it.height,
          shape: it.shape
        })
        if (row) {
          await updateBoardItem(row.id, { z: it.z, opacity: it.opacity ?? 100 })
          imported++
        }
      }
    }
    logger.info('[boardFile]', `导入完成: 白板「${name}」${imported} 个元素`)
    return { boardId: board.id, name, imported }
  } finally {
    // 安全删除临时目录：Windows Defender 实时扫描可能短暂锁定刚写的文件(EPERM)。
    // 清理失败绝不抛出（否则会把成功导入变成错误返回）；残留目录在系统临时目录,由系统策略回收。
    // 异步等待而非 Atomics.wait 同步阻塞(主进程卡死所有 IPC 最坏 2 秒)。
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(tmpDir, { recursive: true, force: true })
        break
      } catch (e) {
        if (i === 9) logger.warn('[boardFile]', `临时目录删除失败(10次重试): ${(e as Error).message}`)
        else await new Promise((r) => setTimeout(r, 200))
      }
    }
  }
}

/** 与 addBoardItem 同签名但类型收窄（错误不抛出,记日志返回 null） */
async function addItemSafe(
  boardId: number,
  item: { assetId?: string | null; type: 'asset' | 'note' | 'shape'; x: number; y: number; width: number; height: number; text?: string; shape?: string }
): Promise<BoardItem | null> {
  try {
    return addBoardItem(boardId, item)
  } catch (e) {
    logger.warn('[boardFile]', `元素创建失败: ${(e as Error).message}`)
    return null
  }
}
