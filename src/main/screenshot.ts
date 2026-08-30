/**
 * 区域截图(对标 Eagle 借鉴点「区域截图」):工具栏触发 → 隐藏主窗 → 捕获主窗所在显示器 →
 * 全屏透明覆层框选 → 裁剪后走真实导入管线入库(sourceUrl=屏幕截图)。
 *
 * V1 范围:仅捕获主窗所在显示器;覆层为无边框透明置顶窗(Windows 上 setFullscreen 会破坏
 * 透明,故用 setBounds 贴显示器边界)。commit/cancel 对无覆层状态幂等,便于测试直调 commit。
 */
import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'
import { mkdtempSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { importFiles } from './importer'
import { logger } from './logger'
import type { ImportResult } from '../shared/types'

let overlayWindow: BrowserWindow | null = null
/** 本次捕获的整屏图与缩放比(commit 裁剪换算用;置 null 即"无进行中会话") */
let captureMeta: { dataUrl: string; dpr: number } | null = null

const EMPTY_RESULT: ImportResult = { imported: 0, skipped: 0, failed: 0 }

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function loadOverlayPage(win: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    const u = new URL(process.env['ELECTRON_RENDERER_URL'])
    u.searchParams.set('screenshot', '1')
    void win.loadURL(u.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { screenshot: '1' } })
  }
}

/** 捕获指定显示器整屏(按物理像素),返回 dataUrl 与逻辑像素→物理像素缩放比 */
async function captureDisplay(display: Electron.Display): Promise<{ dataUrl: string; dpr: number }> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  })
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!src || src.thumbnail.isEmpty()) throw new Error('屏幕捕获失败')
  const size = src.thumbnail.getSize()
  const dpr = clamp(size.width / Math.max(1, display.size.width), 0.5, 4)
  return { dataUrl: src.thumbnail.toDataURL(), dpr }
}

/** 结束截图会话:关覆层 + 恢复主窗(可重入) */
function finishOverlay(getMainWindow: () => BrowserWindow | null): void {
  captureMeta = null
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy()
  overlayWindow = null
  const main = getMainWindow()
  if (main && !main.isDestroyed()) {
    main.show()
    main.focus()
  }
}

export function registerScreenshotIpc(getMainWindow: () => BrowserWindow | null): void {
  /* 工具栏触发:隐藏主窗 → 捕获 → 打开覆层 */
  ipcMain.handle('screenshot:start', async (): Promise<boolean> => {
    if (overlayWindow && !overlayWindow.isDestroyed()) return false
    const main = getMainWindow()
    if (!main || main.isDestroyed()) return false
    const display = screen.getDisplayMatching(main.getBounds())
    main.hide()
    try {
      // 等待窗口隐藏后的合成器重绘,否则主窗会出现在截屏里
      await new Promise((r) => setTimeout(r, 260))
      captureMeta = await captureDisplay(display)
      const overlay = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.size.width,
        height: display.size.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: true,
          contextIsolation: true
        }
      })
      overlay.setAlwaysOnTop(true, 'screen-saver')
      overlay.once('ready-to-show', () => overlay.show())
      overlay.on('closed', () => {
        // 覆层被意外关闭(如任务管理器/崩溃):恢复主窗,会话作废
        if (overlayWindow && overlayWindow.isDestroyed()) finishOverlay(getMainWindow)
        overlayWindow = null
      })
      overlayWindow = overlay
      loadOverlayPage(overlay)
      return true
    } catch (e) {
      captureMeta = null
      finishOverlay(getMainWindow)
      logger.warn('[screenshot]', `启动失败: ${(e as Error).message}`)
      throw e
    }
  })

  /* 覆层渲染层就绪 → 下发整屏图(几 MB 的 dataUrl 走 ipc 消息) */
  ipcMain.on('screenshot:overlayReady', (e) => {
    if (overlayWindow && !overlayWindow.isDestroyed() && e.sender === overlayWindow.webContents && captureMeta) {
      e.sender.send('screenshot:data', { dataUrl: captureMeta.dataUrl, dpr: captureMeta.dpr })
    }
  })

  /* 框选确认:裁剪(逻辑像素×dpr=物理像素) → 走导入管线 → 结束会话恢复主窗。
   * source 可选:外部直传整屏 dataUrl(测试用);缺省用当前会话捕获的整屏图 */
  ipcMain.handle(
    'screenshot:commit',
    async (
      _e,
      rect: { x: number; y: number; width: number; height: number },
      dpr?: number,
      source?: string
    ): Promise<ImportResult> => {
      const meta = captureMeta
      const dataUrl = typeof source === 'string' && source.startsWith('data:image/') ? source : meta?.dataUrl
      const scale = typeof dpr === 'number' && Number.isFinite(dpr) ? clamp(dpr, 0.5, 4) : (meta?.dpr ?? 1)
      if (!dataUrl) return EMPTY_RESULT
      try {
        const img = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64')
        const metadata = await sharp(img).metadata()
        const imgW = metadata.width ?? 0
        const imgH = metadata.height ?? 0
        const left = clamp(Math.round(rect.x * scale), 0, Math.max(0, imgW - 2))
        const top = clamp(Math.round(rect.y * scale), 0, Math.max(0, imgH - 2))
        const width = clamp(Math.round(rect.width * scale), 2, imgW - left)
        const height = clamp(Math.round(rect.height * scale), 2, imgH - top)
        if (width < 2 || height < 2) throw new Error('选区太小')
        const buf = await sharp(img)
          .extract({ left, top, width, height })
          .png()
          .toBuffer()
        const tmpDir = mkdtempSync(join(tmpdir(), 'lumen-shot-'))
        const file = join(tmpDir, `screenshot_${Date.now()}.png`)
        try {
          writeFileSync(file, buf)
          const result = await importFiles([file], { sourceUrl: '屏幕截图' })
          if (result.imported > 0) getMainWindow()?.webContents.send('screenshot:imported', result.imported)
          return result
        } finally {
          rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
        }
      } catch (err) {
        logger.warn('[screenshot]', `裁剪导入失败: ${(err as Error).message}`)
        throw err
      } finally {
        finishOverlay(getMainWindow)
      }
    }
  )

  /* Esc/右键取消 */
  ipcMain.handle('screenshot:cancel', () => {
    finishOverlay(getMainWindow)
  })
}
