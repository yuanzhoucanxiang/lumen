import { BrowserWindow, ipcMain } from 'electron'
import { aiApplySuggestions, aiProcessBatch, aiSuggestBatch, testAiConnection } from '../aiRename'
import { aiSearch } from '../aiSearch'
import { loadConfig } from '../library'
import { isUnnamedName, queryAssets } from '../repository'
import type { AiApplyRequest, AiProcessOptions, AiProcessResult, AiScope } from '../../shared/types'

export function registerAiIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- AI 智能处理（改名+打标签）---------------- */
  // 批量处理：主进程读 key 发请求，key 不进渲染进程；进度通过 webContents.send 推送
  ipcMain.handle('ai:process', async (_e, ids: string[], options: AiProcessOptions): Promise<AiProcessResult> => {
    const cfg = loadConfig()
    if (!cfg.aiApiKey) throw new Error('未配置 AI API Key，请在设置页填写')
    return aiProcessBatch(
      ids,
      { baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4', apiKey: cfg.aiApiKey, model: cfg.aiModel ?? 'glm-4v' },
      options ?? { rename: true, tag: true },
      (done, total, failed) => getWindow()?.webContents.send('ai:progress', { done, total, failed })
    )
  })

  // 阶段一：只生成建议（不写 DB），供预览审核模式用
  ipcMain.handle('ai:suggest', async (_e, ids: string[], options: AiProcessOptions) => {
    const cfg = loadConfig()
    if (!cfg.aiApiKey) throw new Error('未配置 AI API Key，请在设置页填写')
    return aiSuggestBatch(
      ids,
      { baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4', apiKey: cfg.aiApiKey, model: cfg.aiModel ?? 'glm-4v' },
      options ?? { rename: true, tag: true },
      (done, total, failed) => getWindow()?.webContents.send('ai:progress', { done, total, failed })
    )
  })

  // 阶段二：应用用户审核后的建议（改名 + 打标签 + 分类归组）
  ipcMain.handle('ai:apply', (_e, request: AiApplyRequest): Promise<AiProcessResult> => {
    return aiApplySuggestions(request.items, request.options)
  })

  // 统计 AI 候选素材数（对话框显示"将处理 N 个素材"）
  ipcMain.handle('ai:countCandidates', (_e, scope: AiScope): number => {
    if (scope.type === 'selection') return scope.ids.length
    if (scope.type === 'all') {
      return queryAssets({ limit: 100000 }).length
    }
    if (scope.type === 'untagged') {
      return queryAssets({ untagged: true, limit: 100000 }).length
    }
    // unnamed：全部素材里过滤未命名
    const all = queryAssets({ limit: 100000 })
    return all.filter((a) => isUnnamedName(a.name)).length
  })

  // 展开范围为具体 id 列表（供 AI 处理用；未命名判定与 count 一致）
  ipcMain.handle('ai:resolveScope', (_e, scope: AiScope): string[] => {
    if (scope.type === 'selection') return scope.ids
    const all = queryAssets({ limit: 100000 })
    if (scope.type === 'untagged') {
      return queryAssets({ untagged: true, limit: 100000 }).map((a) => a.id)
    }
    if (scope.type === 'unnamed') {
      return all.filter((a) => isUnnamedName(a.name)).map((a) => a.id)
    }
    return all.map((a) => a.id)
  })

  // 测试连通性：用户在设置页填完 key 后点「测试连接」
  ipcMain.handle('ai:testKey', async (_e, cfg: { baseUrl: string; apiKey: string; model: string }) => {
    return testAiConnection(cfg)
  })

  // AI 智能搜索：自然语言找图（语义扩展 -> SQL 候选 -> 视觉精排）
  ipcMain.handle('ai:search', async (_e, query: string) => {
    const cfg = loadConfig()
    if (!cfg.aiApiKey) throw new Error('未配置 AI API Key，请在设置页填写')
    if (!query?.trim()) return []
    return aiSearch(
      query,
      { baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4', apiKey: cfg.aiApiKey, model: cfg.aiModel ?? 'glm-4v' },
      (phase, done, total) => getWindow()?.webContents.send('ai:searchProgress', { phase, done, total })
    )
  })
}
