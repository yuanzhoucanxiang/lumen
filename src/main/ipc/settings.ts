import { BrowserWindow, dialog, ipcMain } from 'electron'
import { loadConfig, saveConfig } from '../library'
import { syncWatchers } from '../watcher'

export function registerSettingsIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 设置 ---------------- */
  // settings:get 返回 AI key 脱敏（只返回 hasKey + 末 4 位，完整 key 不进渲染进程）
  ipcMain.handle('settings:get', () => {
    const cfg = loadConfig()
    return {
      watchDirs: cfg.watchDirs,
      importMode: cfg.importMode,
      aiBaseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
      aiModel: cfg.aiModel ?? 'glm-4v',
      aiHasKey: !!cfg.aiApiKey,
      aiKeyTail: cfg.aiApiKey ? cfg.aiApiKey.slice(-4) : '',
      aiAutoOnImport: cfg.aiAutoOnImport ?? false
    }
  })

  ipcMain.handle(
    'settings:update',
    (
      _e,
      patch: {
        watchDirs?: string[]
        importMode?: 'copy' | 'move'
        aiBaseUrl?: string
        aiApiKey?: string
        aiModel?: string
        aiAutoOnImport?: boolean
      }
    ) => {
      const cfg = loadConfig()
      if (patch.watchDirs) cfg.watchDirs = patch.watchDirs
      if (patch.importMode) cfg.importMode = patch.importMode
      if (patch.aiBaseUrl !== undefined) cfg.aiBaseUrl = patch.aiBaseUrl
      if (patch.aiApiKey !== undefined) cfg.aiApiKey = patch.aiApiKey
      if (patch.aiModel !== undefined) cfg.aiModel = patch.aiModel
      if (patch.aiAutoOnImport !== undefined) cfg.aiAutoOnImport = patch.aiAutoOnImport
      saveConfig(cfg)
      syncWatchers((count) => getWindow()?.webContents.send('clip:imported', count))
      return {
        watchDirs: cfg.watchDirs,
        importMode: cfg.importMode,
        aiBaseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
        aiModel: cfg.aiModel ?? 'glm-4v',
        aiHasKey: !!cfg.aiApiKey,
        aiKeyTail: cfg.aiApiKey ? cfg.aiApiKey.slice(-4) : '',
        aiAutoOnImport: cfg.aiAutoOnImport ?? false
      }
    }
  )

  ipcMain.handle('settings:chooseWatchDir', async (): Promise<string | null> => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '选择要监控的文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
