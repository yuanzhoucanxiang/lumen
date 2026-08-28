import { BrowserWindow, dialog, ipcMain } from 'electron'
import { isAbsolute } from 'path'
import { loadConfig, saveConfig } from '../library'
import { normalizeAiBaseUrl } from '../aiClient'
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
      // 参数全部收敛：watchDirs 仅收绝对路径（防渲染层失陷后注入垃圾值），importMode 限枚举，
      // aiBaseUrl 过 normalizeAiBaseUrl（否则主进程会带着真实 Key 向任意地址发请求）
      if (Array.isArray(patch.watchDirs)) {
        cfg.watchDirs = [...new Set(patch.watchDirs.filter((d): d is string => typeof d === 'string' && isAbsolute(d)))].slice(0, 20)
      }
      if (patch.importMode === 'copy' || patch.importMode === 'move') cfg.importMode = patch.importMode
      if (patch.aiBaseUrl !== undefined) {
        const raw = String(patch.aiBaseUrl).trim()
        if (raw === '') delete cfg.aiBaseUrl
        else cfg.aiBaseUrl = normalizeAiBaseUrl(raw)
      }
      if (patch.aiApiKey !== undefined) cfg.aiApiKey = String(patch.aiApiKey).trim()
      if (patch.aiModel !== undefined) cfg.aiModel = String(patch.aiModel).trim().slice(0, 100)
      if (patch.aiAutoOnImport !== undefined) cfg.aiAutoOnImport = !!patch.aiAutoOnImport
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
