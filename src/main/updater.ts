import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logger } from './logger'
import type { UpdateStatus } from '../shared/types'

let lastStatus: UpdateStatus = { state: 'idle' }
let manualCheck = false

/** 启动静默检查的重试计划：首次 8s，失败后 30s/2min/10min/30min 递增重试 */
const RETRY_DELAYS = [8000, 30_000, 120_000, 600_000, 1_800_000]
let autoRetryIndex = 0
let autoRetryTimer: ReturnType<typeof setTimeout> | null = null

/** UpdateInfo.releaseNotes 可能是字符串或数组，统一成纯文本 */
function releaseNotesOf(info: { releaseNotes?: unknown }): string | undefined {
  const rn = info.releaseNotes
  if (typeof rn === 'string') return rn.trim() || undefined
  if (Array.isArray(rn)) {
    const text = rn
      .map((n) => (n && typeof n === 'object' && 'note' in n ? String((n as { note: unknown }).note) : ''))
      .filter(Boolean)
      .join('\n')
    return text.trim() || undefined
  }
  return undefined
}

export function initUpdater(getWindow: () => BrowserWindow | null): void {
  const send = (status: UpdateStatus): void => {
    lastStatus = status
    logger.info('[updater]', `${status.state} ${status.version ?? ''} ${status.percent ?? ''} ${status.message ?? ''}`.trim())
    getWindow()?.webContents.send('update:event', status)
  }

  // 开发模式：只响应手动调用，给出明确状态
  if (!app.isPackaged) {
    ipcMain.handle('update:check', () => ({ state: 'dev' }) satisfies UpdateStatus)
    ipcMain.handle('update:download', () => undefined)
    ipcMain.handle('update:install', () => undefined)
    ipcMain.handle('update:getState', () => ({ state: 'dev' }) satisfies UpdateStatus)
    return
  }

  autoUpdater.autoDownload = false // 发现更新后由用户确认再下载
  // 本地联调：SHIGUANG_AUTO_DL=1 时免确认直接下载
  if (process.env.SHIGUANG_AUTO_DL === '1') autoUpdater.autoDownload = true

  /** 启动静默自动检查（失败/超时自动重试，直至成功或重试次数耗尽） */
  const scheduleAutoCheck = (delay: number): void => {
    if (autoRetryTimer) clearTimeout(autoRetryTimer)
    autoRetryTimer = setTimeout(() => {
      // 超时保护：网络抖动时 electron-updater 的请求可能无限挂起（无 error 事件），
      // 用 Promise.race 强制超时，超时视为失败走重试
      const CHECK_TIMEOUT = 60_000
      const check = autoUpdater.checkForUpdates()
      Promise.race([check, new Promise((_, rej) => setTimeout(() => rej(new Error('检查超时')), CHECK_TIMEOUT))])
        .then(() => {
          autoRetryIndex = 0
        })
        .catch(() => {
          // 静默检查失败：按计划重试（网络抖动常见），不打扰用户
          if (autoRetryIndex < RETRY_DELAYS.length - 1) {
            autoRetryIndex++
            logger.warn('[updater]', `静默检查失败，${RETRY_DELAYS[autoRetryIndex] / 1000}s 后重试`)
            scheduleAutoCheck(RETRY_DELAYS[autoRetryIndex])
          } else {
            logger.warn('[updater]', '静默检查重试次数耗尽，本次启动不再自动检查（可手动「检查更新」）')
          }
        })
    }, delay)
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    autoRetryIndex = 0
    send({ state: 'available', version: info.version, notes: releaseNotesOf(info) })
  })
  autoUpdater.on('update-not-available', () => {
    autoRetryIndex = 0
    // 静默启动检查无更新时不打扰；仅手动检查才提示「已是最新」
    if (manualCheck) send({ state: 'none' })
    else lastStatus = { state: 'none' }
    manualCheck = false
  })
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.floor(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    send({ state: 'downloaded', version: info.version, notes: releaseNotesOf(info) })
  )
  autoUpdater.on('error', (err) => {
    // 网络异常只在手动检查时提示；下载阶段的错误必须提示（否则用户点「立即下载」无反馈）
    if (manualCheck || lastStatus.state === 'downloading') {
      send({ state: 'error', message: err?.message ?? '网络异常' })
    } else {
      logger.warn('[updater]', `silent error: ${err?.message ?? err}`)
    }
    manualCheck = false
  })

  // 启动后延迟静默检查一次（失败按 RETRY_DELAYS 递增重试）
  scheduleAutoCheck(RETRY_DELAYS[0])

  ipcMain.handle('update:check', async () => {
    manualCheck = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      manualCheck = false
      send({ state: 'error', message: e instanceof Error ? e.message : '检查失败' })
    }
    return lastStatus
  })
  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      // 下载失败必须让渲染层知道（否则用户点「立即下载」无反馈）
      send({ state: 'error', message: e instanceof Error ? e.message : '下载失败' })
      throw e
    }
  })
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
  ipcMain.handle('update:getState', () => lastStatus)
}
