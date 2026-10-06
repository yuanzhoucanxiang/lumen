/**
 * 区域截图(对标 Eagle 借鉴点「区域截图」):工具栏/快捷键触发 → 隐藏主窗 → 逐屏捕获 →
 * 每个显示器一个全屏透明覆层框选 → 裁剪后走真实导入管线入库(sourceUrl=屏幕截图)。
 *
 * 覆层为无边框透明置顶窗(Windows 上 setFullscreen 会破坏透明,故用 setBounds 贴显示器边界);
 * 多显示器时每个覆层各持自己那一屏的捕获图,任意覆层确认/取消即结束整个会话。
 * commit 的 source 参数允许直传整屏 dataUrl(测试用,覆层路径不用);对无会话状态幂等。
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

/** 一次捕获:整屏图 + 逻辑像素→物理像素缩放比;wcId 为承载它的覆层 webContents id(未挂接前 null) */
interface CaptureSession {
  dataUrl: string
  dpr: number
  wcId: number | null
}

let overlays: BrowserWindow[] = []
let sessions: CaptureSession[] = []
/** 覆层 webContents → 所属会话(ready/commit 时定位是哪一屏) */
const wcSessions = new WeakMap<Electron.WebContents, CaptureSession>()
/** 启动互斥:captureDisplay 有 260ms 等待,期间 handle 可重入,须同步标志挡住二次触发 */
let starting = false

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

/** 捕获指定显示器整屏(按物理像素),返回会话 */
async function captureDisplay(display: Electron.Display): Promise<CaptureSession> {
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
  return { dataUrl: src.thumbnail.toDataURL(), dpr, wcId: null }
}

/** 结束截图会话:关全部覆层 + 恢复主窗(可重入) */
function finishAll(getMainWindow: () => BrowserWindow | null): void {
  sessions = []
  const alive = overlays.filter((w) => !w.isDestroyed())
  overlays = []
  for (const w of alive) w.destroy()
  const main = getMainWindow()
  if (main && !main.isDestroyed()) {
    main.show()
    main.focus()
  }
}

export function registerScreenshotIpc(getMainWindow: () => BrowserWindow | null): void {
  /* 工具栏/快捷键触发:隐藏主窗 → 逐屏捕获 → 每屏一个覆层 */
  ipcMain.handle('screenshot:start', async (): Promise<boolean> => {
    if (starting || sessions.length > 0) return false
    const main = getMainWindow()
    if (!main || main.isDestroyed()) return false
    starting = true
    main.hide()
    try {
      // 等待窗口隐藏后的合成器重绘,否则主窗会出现在截屏里
      await new Promise((r) => setTimeout(r, 260))
      sessions = []
      for (const display of screen.getAllDisplays()) {
        const session = await captureDisplay(display)
        sessions.push(session)
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
          overlays = overlays.filter((w) => w !== overlay)
          // 全部覆层都没了而会话还在(意外关闭/逐个被关):收尾恢复主窗
          if (sessions.length > 0 && overlays.length === 0) finishAll(getMainWindow)
        })
        wcSessions.set(overlay.webContents, session)
        session.wcId = overlay.webContents.id
        overlays.push(overlay)
        loadOverlayPage(overlay)
      }
      starting = false
      return true
    } catch (e) {
      starting = false
      finishAll(getMainWindow)
      logger.warn('[screenshot]', `启动失败: ${(e as Error).message}`)
      throw e
    }
  })

  /* 覆层渲染层就绪 → 下发该屏整屏图(几 MB 的 dataUrl 走 ipc 消息) */
  ipcMain.on('screenshot:overlayReady', (e) => {
    const session = wcSessions.get(e.sender)
    if (session && session.wcId === e.sender.id && sessions.includes(session)) {
      e.sender.send('screenshot:data', { dataUrl: session.dataUrl, dpr: session.dpr })
    }
  })

  /* 框选确认:裁剪(逻辑像素×dpr=物理像素) → 走导入管线 → 结束会话恢复主窗 */
  ipcMain.handle(
    'screenshot:commit',
    async (
      e,
      rect: { x: number; y: number; width: number; height: number },
      dpr?: number,
      source?: string
    ): Promise<ImportResult> => {
      // 会话定位:覆层提交按 sender;主窗/测试提交回退到首个会话(主显示器)
      const session = e && e.sender ? (wcSessions.get(e.sender) ?? null) : null
      const active = source ? null : (session ?? sessions[0] ?? null)
      const dataUrl = typeof source === 'string' && source.startsWith('data:image/') ? source : active?.dataUrl
      const scale = typeof dpr === 'number' && Number.isFinite(dpr) ? clamp(dpr, 0.5, 4) : (active?.dpr ?? 1)
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
          const result = await importFiles([file], { sourceUrl: '屏幕截图', source: 'screenshot' })
          if (result.imported > 0) getMainWindow()?.webContents.send('screenshot:imported', result.imported)
          return result
        } finally {
          rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
        }
      } catch (err) {
        logger.warn('[screenshot]', `裁剪导入失败: ${(err as Error).message}`)
        throw err
      } finally {
        if (!source) finishAll(getMainWindow)
      }
    }
  )

  /* Esc/右键取消 */
  ipcMain.handle('screenshot:cancel', () => {
    finishAll(getMainWindow)
  })
}
