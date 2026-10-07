import { BrowserWindow, ipcMain } from 'electron'
import { aiApplySuggestions, aiProcessBatch, aiSuggestBatch, testAiConnection } from '../aiRename'
import { aiSearch } from '../aiSearch'
import { agentChatTurn, agentSearchFull, agentRerank, agentTagByConditions, executeAgentConditions } from '../aiAgent'
import { listAgentOps, undoAgentOp } from '../agentOps'
import { normalizeAiBaseUrl } from '../aiClient'
import { loadConfig } from '../library'
import { isUnnamedName, queryAssets } from '../repository'
import type { AgentChatTurn, AiApplyRequest, AiProcessOptions, AiProcessResult, AiScope } from '../../shared/types'

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

  // 测试连通性：用户在设置页填完 key 后点「测试连接」。
  // baseUrl 与 settings:update 同一校验：主进程不向任意地址携带凭据发请求
  ipcMain.handle('ai:testKey', async (_e, cfg: { baseUrl: string; apiKey: string; model: string }) => {
    return testAiConnection({ ...cfg, baseUrl: normalizeAiBaseUrl(String(cfg?.baseUrl ?? '')) })
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

  /* ---------------- 找图助手（对话式检索，里程碑 161） ---------------- */
  // 一轮对话：模型 -> JSON 指令 -> 条件检索。history 由渲染层持有并回传（含上轮原始 JSON，保条件连续性）；
  // 模型增量经 ai:agentDelta 实时推送(流式);imageIds 非空时附带当前结果缩略图(看图追问,多模态)
  ipcMain.handle('ai:agentChat', async (_e, history: AgentChatTurn[], message: string, imageIds?: string[]) => {
    const cfg = loadConfig()
    if (!cfg.aiApiKey) throw new Error('未配置 AI API Key，请在设置页填写')
    const safeHistory = Array.isArray(history)
      ? history
          .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
          .slice(-20)
      : []
    const safeImageIds = Array.isArray(imageIds) ? imageIds.filter((x) => typeof x === 'string').slice(0, 6) : []
    return agentChatTurn(
      String(message ?? ''),
      safeHistory,
      { baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4', apiKey: cfg.aiApiKey, model: cfg.aiModel ?? 'glm-4v' },
      (acc) => getWindow()?.webContents.send('ai:agentDelta', { text: acc }),
      safeImageIds.length > 0 ? safeImageIds : undefined
    )
  })

  // 直接执行一组结构化条件（不经过模型；测试与后续"把条件应用到图库"复用）
  ipcMain.handle('ai:agentSearch', (_e, conditions: unknown) => executeAgentConditions(conditions))

  // 全量结果（完整 Asset）：「在素材库中查看」把助手结果铺进图库视图
  ipcMain.handle('ai:agentSearchFull', (_e, conditions: unknown) => agentSearchFull(conditions))

  // 按条件给全部命中素材打标签（助手的可撤销写操作；打标签本身确定性执行，不需要 AI）
  ipcMain.handle('ai:agentTag', (_e, conditions: unknown, tag: string) => agentTagByConditions(conditions, tag))

  // Agent 操作记录与回退（里程碑 171）
  ipcMain.handle('ai:agentOps', (_e, limit?: number) => listAgentOps(typeof limit === 'number' ? limit : 30))
  ipcMain.handle('ai:agentUndo', (_e, id: number) => undoAgentOp(id))

  // AI 视觉重排：对助手已检索到的素材按查询意图做视觉相关性重排（复用 aiSearch 的视觉精排管线）
  ipcMain.handle(
    'ai:agentRerank',
    async (_e, query: string, ids: string[]) => {
      const cfg = loadConfig()
      if (!cfg.aiApiKey) throw new Error('未配置 AI API Key，请在设置页填写')
      const safeIds = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice(0, 60) : []
      if (!query?.trim() || safeIds.length === 0) return []
      return agentRerank(
        query.trim(),
        safeIds,
        { baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4', apiKey: cfg.aiApiKey, model: cfg.aiModel ?? 'glm-4v' },
        (phase, done, total) => getWindow()?.webContents.send('ai:searchProgress', { phase, done, total })
      )
    }
  )
}
