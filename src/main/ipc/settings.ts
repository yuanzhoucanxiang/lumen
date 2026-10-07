import { BrowserWindow, dialog, ipcMain } from 'electron'
import { isAbsolute } from 'path'
import { loadConfig, saveConfig } from '../library'
import { normalizeAiBaseUrl } from '../aiClient'
import { syncWatchers } from '../watcher'

/** 返回给渲染层的设置（AI Key 只给 hasKey + 末 4 位，完整 Key 永不进渲染进程） */
function maskedSettings(): Record<string, unknown> {
  const cfg = loadConfig()
  return {
    watchDirs: cfg.watchDirs,
    importMode: cfg.importMode,
    aiBaseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
    aiModel: cfg.aiModel ?? 'glm-4v',
    aiHasKey: !!cfg.aiApiKey,
    aiKeyTail: cfg.aiApiKey ? cfg.aiApiKey.slice(-4) : '',
    aiAutoOnImport: cfg.aiAutoOnImport ?? false,
    aiProfiles: (cfg.aiProfiles ?? []).map((p) => ({
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      hasKey: !!p.apiKey,
      keyTail: p.apiKey ? p.apiKey.slice(-4) : ''
    }))
  }
}

export function registerSettingsIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 设置 ---------------- */
  // settings:get 返回 AI key 脱敏（只返回 hasKey + 末 4 位，完整 key 不进渲染进程）
  ipcMain.handle('settings:get', () => maskedSettings())

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
      return maskedSettings()
    }
  )

  /* ---------------- 服务商档案（里程碑 179）：多套配置一键互切，Key 永不出主进程 ---------------- */
  // 保存当前配置为档案（同名则更新）；name 未传时按 Base URL 推断
  ipcMain.handle('ai:profileSave', (_e, name: string) => {
    const cfg = loadConfig()
    const guess =
      (cfg.aiBaseUrl ?? '').includes('opencode.ai/zen/go')
        ? 'OpenCode Go'
        : (cfg.aiBaseUrl ?? '').includes('opencode.ai/zen')
          ? 'OpenCode Zen'
          : (cfg.aiBaseUrl ?? '').includes('deepseek')
            ? 'DeepSeek'
            : (cfg.aiBaseUrl ?? '').includes('bigmodel')
              ? '智谱 GLM'
              : (cfg.aiBaseUrl ?? '').includes('dashscope')
                ? '通义千问'
                : (cfg.aiBaseUrl ?? '').includes('127.0.0.1')
                  ? '本地 Ollama'
                  : (cfg.aiBaseUrl ?? '').replace(/^https?:\/\//, '').split('/')[0] || '我的服务商'
    const trimmed = String(name ?? '').trim().slice(0, 60) || guess
    const profiles = cfg.aiProfiles ?? []
    const next = {
      name: trimmed,
      baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: cfg.aiApiKey ?? '',
      model: cfg.aiModel ?? 'glm-4v'
    }
    const idx = profiles.findIndex((p) => p.name === trimmed)
    if (idx >= 0) profiles[idx] = next
    else profiles.unshift(next)
    cfg.aiProfiles = profiles.slice(0, 20)
    saveConfig(cfg)
    return maskedSettings()
  })

  // 切换到某个档案（把档案的 baseUrl/key/model 写为当前生效配置）
  ipcMain.handle('ai:profileActivate', (_e, name: string) => {
    const cfg = loadConfig()
    const p = (cfg.aiProfiles ?? []).find((x) => x.name === String(name ?? ''))
    if (!p) throw new Error('服务商档案不存在')
    cfg.aiBaseUrl = p.baseUrl
    cfg.aiApiKey = p.apiKey
    cfg.aiModel = p.model
    saveConfig(cfg)
    return maskedSettings()
  })

  // 删除档案（仅删档案本身，不动当前生效配置）
  ipcMain.handle('ai:profileDelete', (_e, name: string) => {
    const cfg = loadConfig()
    cfg.aiProfiles = (cfg.aiProfiles ?? []).filter((x) => x.name !== String(name ?? ''))
    saveConfig(cfg)
    return maskedSettings()
  })

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
