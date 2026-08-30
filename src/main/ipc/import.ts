import { BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { importFiles } from '../importer'
import { mapWithConcurrency } from '../aiClient'
import { guardedFetch, readBodyCapped } from '../netGuard'
import { MIME_EXT } from '../clipServer'
import { loadConfig } from '../library'
import type { ImportResult } from '../../shared/types'

export function registerImportIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 导入 ---------------- */
  // 导入进度推送（阶段 A 逐文件 + 阶段 B 提交后一次），渲染层 onImportProgress 消费
  const sendImportProgress = (phase: 'prepare' | 'commit', done: number, total: number): void => {
    getWindow()?.webContents.send('import:progress', { phase, done, total })
  }

  ipcMain.handle('import:dialog', async (): Promise<{ imported: number; skipped: number; failed: number }> => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '导入素材',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return { imported: 0, skipped: 0, failed: 0 }
    return importFiles(result.filePaths, { move: loadConfig().importMode === 'move', onProgress: sendImportProgress })
  })

  ipcMain.handle('import:paths', async (_e, paths: string[]) => {
    return importFiles(paths ?? [], { onProgress: sendImportProgress })
  })

  /* ---------------- URL 粘贴抓图 ---------------- */
  const URL_IMPORT_MAX = 50
  const URL_FETCH_TIMEOUT = 30_000
  const URL_MAX_BYTES = 100 * 1024 * 1024

  // 并发下载图片直链到临时目录 → 逐个走导入管线(sourceUrl 记录来源,查重/缩略图全继承)。
  // 单条失败(非 http(s)/超时/非图片/超大)只记入 failedUrls 不阻塞其他。
  ipcMain.handle('import:urls', async (_e, rawUrls: string[]): Promise<ImportResult> => {
    const tokens = Array.isArray(rawUrls) ? rawUrls.map((u) => String(u).trim()).filter(Boolean) : []
    const urls = tokens.filter((u) => /^https?:\/\//i.test(u)).slice(0, URL_IMPORT_MAX)
    const result: ImportResult = { imported: 0, skipped: 0, failed: 0, failedFiles: [], failedUrls: [] }
    // 非法协议不给静默忽略:计入失败清单让 UI 可反馈
    for (const u of tokens.filter((u) => !/^https?:\/\//i.test(u))) {
      result.failed++
      result.failedUrls?.push(`${u}(仅支持 http/https 链接)`)
    }
    if (urls.length > URL_IMPORT_MAX) {
      result.failed += urls.length - URL_IMPORT_MAX
      result.failedUrls?.push(`单次最多抓取 ${URL_IMPORT_MAX} 个链接`)
    }
    if (urls.length === 0 && result.failed === 0) return result

    const tmpDir = mkdtempSync(join(tmpdir(), 'lumen-url-'))
    try {
      const usedNames = new Set<string>()
      const downloaded = await mapWithConcurrency(urls, 3, async (url): Promise<{ url: string; file: string } | null> => {
        try {
          // 出网防护：逐跳协议校验 + 30s 超时 + 流式读取边下边限 100MB。
          // allowLocal: 用户主动粘贴的 URL 允许本机/局域网图源（响应只进本机素材库，无外泄通道）
          const resp = await guardedFetch(url, URL_FETCH_TIMEOUT, { allowLocal: true })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const contentType = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
          if (!contentType.startsWith('image/')) throw new Error(`非图片内容(${contentType || '未知类型'})`)
          const buf = await readBodyCapped(resp, URL_MAX_BYTES)
          if (buf.length === 0) throw new Error('空内容')

          // 文件名:URL 尾段优先 → 非法字符/控制字符清洗、去尾点尾空格(Windows 写盘约束);
          // 无扩展名/扩展名异常时按 content-type 补全;同名加序号
          let base = ''
          try {
            base = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
          } catch {
            /* 解析失败保持空,走默认名 */
          }
          base = base
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/[. ]+$/g, '')
            .slice(0, 120)
          const dot = base.lastIndexOf('.')
          let ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
          if (!ext || ext.length > 5) ext = MIME_EXT[contentType] ?? 'jpg'
          if (dot > 0) base = base.slice(0, dot)
          if (!base) base = `url_${Date.now()}`
          // Windows 保留设备名(CON/NUL/COM1…)不能做文件名主干
          if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(base)) base = `_${base}`
          let name = `${base}.${ext}`
          for (let i = 2; usedNames.has(name.toLowerCase()); i++) name = `${base}_${i}.${ext}`
          usedNames.add(name.toLowerCase())

          const file = join(tmpDir, name)
          writeFileSync(file, buf)
          return { url, file }
        } catch (e) {
          result.failed++
          result.failedUrls?.push(`${url}(${(e as Error).message})`)
          return null
        }
      })

      const okItems = downloaded.filter((d): d is { url: string; file: string } => d !== null)
      let done = 0
      for (const item of okItems) {
        // 用户主动导入:不设 checkTombstone(与对话框/拖拽/剪藏一致)
        const r = await importFiles([item.file], { sourceUrl: item.url })
        done++
        sendImportProgress('commit', done, okItems.length)
        result.imported += r.imported
        result.skipped += r.skipped
        result.failed += r.failed
        if (r.failedFiles) result.failedFiles!.push(...r.failedFiles)
        if (r.importedIds) result.importedIds = [...(result.importedIds ?? []), ...r.importedIds]
      }
      return result
    } finally {
      // Windows Defender 可能短暂锁定刚写的文件,重试清理(boardFile 成例),失败仅告警
      for (let i = 0; i < 10; i++) {
        try {
          rmSync(tmpDir, { recursive: true, force: true })
          break
        } catch {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
        }
      }
    }
  })
}
