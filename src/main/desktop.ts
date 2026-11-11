/**
 * 桌面集成（里程碑 235）：托盘常驻 + 关闭即最小化到托盘 + 区域截图全局快捷键。
 *
 * - 点窗口关闭按钮不再退出应用，而是隐藏到系统托盘；托盘菜单提供 打开 / 截图 / 退出
 * - 区域截图注册为**全局快捷键**（默认 Ctrl+Shift+S，可在设置里改），窗口隐藏时也能触发，
 *   截图仍走原有导入管线存入当前素材库
 * - 单实例再次启动时会唤起已隐藏的窗口（index.ts 的 second-instance 已处理）
 */
import { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { loadConfig } from './library'
import { startScreenshot } from './screenshot'
import { logger } from './logger'

const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+S'

let tray: Tray | null = null
let getMain: () => BrowserWindow | null = () => null
/** 主窗被异常销毁时重建（正常情况下关闭只是 hide，不会走到这里） */
let createMain: (() => void) | null = null
/** 用户主动退出（托盘菜单/系统关机）时才真的关闭窗口 */
let quitting = false
/** 当前注册成功的全局快捷键（空 = 未注册） */
let registeredShortcut = ''

export function isQuitting(): boolean {
  return quitting
}

export function markQuitting(): void {
  quitting = true
}

/**
 * 显示并前置主窗口（托盘单击/菜单/第二实例/任务栏重启共用）。
 * Windows 的 show/focus 会被系统前台锁拦下，置顶一次再取消作为兜底。
 */
export function restoreWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  if (process.platform === 'win32' && !win.isFocused()) {
    win.setAlwaysOnTop(true)
    win.setAlwaysOnTop(false)
    win.focus()
  }
}

function showMain(): void {
  const win = getMain()
  if (!win || win.isDestroyed()) {
    // 窗口不存在（异常销毁/启动竞态）：请求主进程重建，ready-to-show 会自动显示
    createMain?.()
    return
  }
  restoreWindow(win)
}

/** 托盘图标：打包后由 extraResources 复制到 resources/icon.ico|png；开发态读 build/ */
function trayIcon(): Electron.NativeImage {
  const resources = process.resourcesPath ?? ''
  const winCandidates = [
    join(resources, 'icon.ico'),
    join(__dirname, '../../build/icon.ico'),
    join(resources, 'icon.png'),
    join(__dirname, '../../build/icon.png')
  ]
  const macCandidates = [
    join(resources, 'icon.png'),
    join(__dirname, '../../build/icon.png'),
    join(resources, 'icon.ico'),
    join(__dirname, '../../build/icon.ico')
  ]
  for (const p of process.platform === 'win32' ? winCandidates : macCandidates) {
    if (!existsSync(p)) continue
    let img = nativeImage.createFromPath(p)
    if (img.isEmpty()) continue
    // macOS 菜单栏按 16pt 渲染；Windows 由系统从多尺寸 ICO 里选
    if (process.platform === 'darwin') img = img.resize({ width: 16, height: 16 })
    return img
  }
  logger.warn('[desktop]', '托盘图标缺失：resources/icon.ico|png 与 build/ 均未找到')
  return nativeImage.createEmpty()
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: '打开 LUMEN', click: showMain },
    {
      label: registeredShortcut ? '区域截图' : '区域截图（快捷键未启用）',
      accelerator: registeredShortcut || undefined,
      click: () => void startScreenshot(getMain).catch(() => undefined)
    },
    { type: 'separator' },
    {
      label: '退出 LUMEN',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
}

function createTray(): void {
  if (tray) return
  const icon = trayIcon()
  tray = new Tray(icon)
  logger.info('[desktop]', `托盘图标: ${icon.isEmpty() ? '空(异常)' : `${icon.getSize().width}x${icon.getSize().height}`}`)
  tray.setToolTip('LUMEN · 本地素材档案')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', showMain)
  tray.on('double-click', showMain)
}

/**
 * 重新注册全局截图快捷键（启动时 + 设置里改快捷键后调用）。
 * 注册失败（被占用/格式非法）只记日志，托盘菜单里提示未启用，不影响应用使用。
 */
export function refreshGlobalShortcut(): void {
  if (registeredShortcut) {
    try {
      globalShortcut.unregister(registeredShortcut)
    } catch {
      /* 未注册或平台不支持时忽略 */
    }
    registeredShortcut = ''
  }
  const raw = loadConfig().screenshotShortcut
  const accelerator = (typeof raw === 'string' ? raw : DEFAULT_SHORTCUT).trim()
  if (!accelerator) {
    logger.info('[desktop]', '全局截图快捷键已关闭')
    tray?.setContextMenu(buildTrayMenu())
    return
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      void startScreenshot(getMain).catch(() => undefined)
    })
    if (ok) {
      registeredShortcut = accelerator
      logger.info('[desktop]', `全局截图快捷键已注册: ${accelerator}`)
    } else {
      logger.warn('[desktop]', `全局截图快捷键注册失败（可能被其它程序占用）: ${accelerator}`)
    }
  } catch (e) {
    logger.warn('[desktop]', `全局截图快捷键无效: ${accelerator} — ${(e as Error).message}`)
  }
  tray?.setContextMenu(buildTrayMenu())
}

/** 初始化托盘与全局快捷键（主窗口创建后调用一次） */
export function initDesktop(
  getMainWindow: () => BrowserWindow | null,
  recreateMainWindow?: () => void
): void {
  getMain = getMainWindow
  createMain = recreateMainWindow ?? null
  createTray()
  refreshGlobalShortcut()
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    tray?.destroy()
    tray = null
  })
}
