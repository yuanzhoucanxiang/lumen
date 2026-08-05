import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

let lastStatus: UpdateStatus = { state: 'idle' }
let manualCheck = false

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
    console.log('[updater]', status.state, status.version ?? '', status.percent ?? '', status.message ?? '')
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

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    send({ state: 'available', version: info.version, notes: releaseNotesOf(info) })
  )
  autoUpdater.on('update-not-available', () => {
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
      console.log('[updater] silent error:', err?.message)
    }
    manualCheck = false
  })

  // 启动后延迟静默检查一次
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }, 8000)

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
