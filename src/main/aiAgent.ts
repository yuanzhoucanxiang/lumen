/**
 * 找图助手（里程碑 161）：对话式自然语言检索。
 *
 * 与 aiSearch（单轮「语义扩展 → SQL → 视觉精排」）的分工：
 * 本模块是**多轮对话 + 结构化条件**——把自然语言映射到 queryAssets 的完整条件面
 * （时间/尺寸/构图/星级/未标注/来源），支持追问收窄。协议用「让模型返回 JSON 指令」
 * 而非 function calling：兼容各家 OpenAI 兼容模型，容错解析复用 aiSearch 的 extractJson。
 * 只读——本模块不写库，写操作（打标签/存智能文件夹）留待后续版本。
 */
import { listTags, libraryStats, queryAssets } from './repository'
import { logger } from './logger'
import { chat } from './aiClient'
import { extractJson } from './aiSearch'
import type { AiConfig, ChatTurn } from './aiClient'
import type {
  AgentAssetBrief,
  AgentConditions,
  AgentReply,
  AgentSearchResult
} from '../shared/types'
import type { AssetQuery } from '../shared/types'

/** 计数上限：命中很多时不必全量拉取，total 为下限（truncated 标记） */
const COUNT_CAP = 2000
/** 单轮返回给渲染层的素材数（面板展示前 9 个，其余靠 total 表达规模） */
const PREVIEW_LIMIT = 60
/** 标签库注入上限（按素材数降序截取，与 aiSearch 同策略防 token 超限） */
const TAG_LIB_LIMIT = 200
/** 条件字段消毒上限 */
const MAX_TAGS = 8
const SHAPES = new Set(['landscape', 'portrait', 'square'])
const SOURCES = new Set(['manual', 'agent', 'clip', 'watcher', 'screenshot', 'startup'])
const SORTS = new Set(['imported', 'name', 'size', 'star'])

/** 模型输出是不可信 JSON：逐字段消毒/范围钳制，非法值一律丢弃（宁可少筛不可错筛） */
export function sanitizeConditions(raw: unknown): AgentConditions | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const c: AgentConditions = {}

  if (typeof o.keyword === 'string' && o.keyword.trim()) c.keyword = o.keyword.trim().slice(0, 100)
  if (Array.isArray(o.tags)) {
    const tags = (o.tags as unknown[])
      .filter((t): t is string => typeof t === 'string' && !!t.trim())
      .map((t) => t.trim().slice(0, 40))
      .slice(0, MAX_TAGS)
    if (tags.length > 0) c.tags = tags
  }
  if (typeof o.shape === 'string' && SHAPES.has(o.shape)) c.shape = o.shape as AgentConditions['shape']
  if (typeof o.withinDays === 'number' && Number.isFinite(o.withinDays) && o.withinDays >= 1) {
    c.withinDays = Math.min(Math.round(o.withinDays), 3650)
  }
  if (typeof o.starMin === 'number' && Number.isFinite(o.starMin) && o.starMin >= 1 && o.starMin <= 5) {
    // 越界值(如 999)直接丢弃而非钳制——"只要有 999 星"钳成"只要 5 星"是错误解读
    c.starMin = Math.round(o.starMin)
  }
  if (o.untagged === true) c.untagged = true
  if (typeof o.source === 'string' && SOURCES.has(o.source)) c.source = o.source as AgentConditions['source']
  if (Array.isArray(o.exts)) {
    const exts = (o.exts as unknown[])
      .filter((e): e is string => typeof e === 'string' && /^[a-z0-9]{1,8}$/i.test(e.trim()))
      .map((e) => e.trim().toLowerCase())
      .slice(0, 10)
    if (exts.length > 0) c.exts = exts
  }
  for (const k of ['minW', 'maxW'] as const) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1) c[k] = Math.min(Math.round(v), 100000)
  }
  if (typeof o.sortBy === 'string' && SORTS.has(o.sortBy)) c.sortBy = o.sortBy as AgentConditions['sortBy']
  if (typeof o.sortDesc === 'boolean') c.sortDesc = o.sortDesc

  return Object.keys(c).length > 0 ? c : null
}

/** 标签名 → 库内 tagId（精确 → 忽略大小写 → 包含匹配；与 aiSearch 同策略） */
function resolveTagIds(names: string[]): { ids: number[]; matched: string[] } {
  const all = listTags()
  const ids: number[] = []
  const matched: string[] = []
  for (const tn of names) {
    let hit = all.find((t) => t.name === tn)
    if (!hit) hit = all.find((t) => t.name.toLowerCase() === tn.toLowerCase())
    if (!hit) hit = all.find((t) => t.name.includes(tn) || tn.includes(t.name))
    if (hit && !ids.includes(hit.id)) {
      ids.push(hit.id)
      matched.push(hit.name)
    }
  }
  return { ids, matched }
}

/**
 * 执行结构化条件检索（纯读库，不依赖 AI）——找图助手的执行层。
 * 也供渲染层/后续版本直接调用（把一组条件应用到图库）。
 */
export function executeAgentConditions(raw: unknown): AgentSearchResult {
  const c = sanitizeConditions(raw)
  if (!c) return { assets: [], total: 0, truncated: false, matchedTags: [] }

  const { ids: tagIds, matched } = c.tags ? resolveTagIds(c.tags) : { ids: [], matched: [] }
  // 条件写了标签但一个都没匹配上：直接回空（否则会退化成"无标签筛选"返回全库）
  if (c.tags && c.tags.length > 0 && tagIds.length === 0) {
    return { assets: [], total: 0, truncated: false, matchedTags: [] }
  }

  const q: AssetQuery = {
    keyword: c.keyword,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    shape: c.shape,
    withinDays: c.withinDays,
    starMin: c.starMin,
    untagged: c.untagged,
    // manual = 用户手动导入（source 列为 ''）
    source: c.source === undefined ? undefined : c.source === 'manual' ? '' : c.source,
    exts: c.exts,
    minW: c.minW,
    maxW: c.maxW,
    sortBy: c.sortBy,
    sortDesc: c.sortDesc,
    limit: COUNT_CAP
  }
  const rows = queryAssets(q)
  const total = rows.length
  const assets: AgentAssetBrief[] = rows.slice(0, PREVIEW_LIMIT).map((a) => ({
    id: a.id,
    name: a.name,
    ext: a.ext,
    width: a.width,
    height: a.height,
    star: a.star,
    source: a.source,
    tags: a.tagNames ?? []
  }))
  logger.info('[aiAgent]', `条件检索命中 ${total} 个（标签命中: ${matched.join(',') || '无'}）`)
  return { assets, total, truncated: total >= COUNT_CAP, matchedTags: matched }
}

/** 构造找图助手的提示词（含标签库与库规模上下文） */
function buildPrompt(message: string): string {
  const tags = listTags()
  const tagLib = [...tags]
    .sort((a, b) => b.count - a.count)
    .slice(0, TAG_LIB_LIMIT)
    .map((t) => t.name)
    .join(',')
  const stats = libraryStats()

  return (
    `你是 LUMEN 素材库的找图助手。用户用自然语言描述想找的素材,你把它转成结构化检索条件。\n\n` +
    `可用条件字段(全部可选,没涉及就不要输出该字段):\n` +
    `- keyword: 画面内容关键词(字符串,匹配文件名与备注)\n` +
    `- tags: 标签名数组,只能从下面标签库里挑语义匹配的\n` +
    `- shape: "landscape"横图 / "portrait"竖图 / "square"方图\n` +
    `- withinDays: 数字,最近 N 天导入(如"上个月"≈30、"这周"=7、"今天"=1)\n` +
    `- starMin: 1-5,最低星级\n` +
    `- untagged: true 表示只要没打过标签的\n` +
    `- source: "manual"手动导入 / "agent"AI助手导入 / "clip"浏览器剪藏 / "watcher"监控文件夹 / "screenshot"截图\n` +
    `- exts: 扩展名数组,如 ["png","jpg"]\n` +
    `- minW / maxW: 宽度像素(数字)\n` +
    `- sortBy: "imported"导入时间 / "name"名称 / "size"文件大小 / "star"星级;sortDesc: true 降序\n\n` +
    `标签库(只能从中挑选,没有匹配就省略 tags):${tagLib || '(空)'}\n` +
    `素材库现状: 共 ${stats.total} 个素材\n\n` +
    `要求:\n` +
    `1. 只返回 JSON,不要任何解释文字:{"reply":"给用户的简短中文回复(一句话)","conditions":{...}}\n` +
    `2. 用户只是闲聊/提问、无法转成检索条件时,conditions 返回 null\n` +
    `3. 多轮对话要结合上文:用户说"再暗一点""换成竖图"等,必须在上轮条件基础上调整后输出完整条件\n` +
    `4. 不要编造标签库里没有的标签;拿不准的字段宁可省略\n\n` +
    `用户本轮:${message}\n\n` +
    `只返回 JSON。`
  )
}

/**
 * 一轮对话：模型 → JSON 指令 → 条件映射 → 查库 → 回复。
 * 失败兜底：模型输出无法解析时，把原文当回复返回（conditions=null），不抛错打断对话。
 */
export async function agentChatTurn(
  message: string,
  history: ChatTurn[],
  cfg: AiConfig
): Promise<AgentReply> {
  const trimmed = message.trim()
  if (!trimmed) {
    return { reply: '想找什么素材？直接描述就行。', conditions: null, assets: [], total: 0, truncated: false, matchedTags: [], raw: '' }
  }

  const prompt = buildPrompt(trimmed)
  // maxTokens 给足:推理型模型思考链与正文共享预算
  const content = await chat(cfg, prompt, undefined, 1500, 90_000, 0.2, history)
  const obj = extractJson(content)

  if (!obj) {
    logger.warn('[aiAgent]', `模型输出无法解析为 JSON: ${content.slice(0, 120)}`)
    return {
      reply: content.trim().slice(0, 300) || '（AI 没有返回可用的结果，换个说法再试试）',
      conditions: null,
      assets: [],
      total: 0,
      truncated: false,
      matchedTags: [],
      raw: content
    }
  }

  const reply =
    typeof obj.reply === 'string' && obj.reply.trim()
      ? obj.reply.trim().slice(0, 500)
      : '已按条件检索完成。'
  const conditions = sanitizeConditions(obj.conditions)
  if (!conditions) {
    return { reply, conditions: null, assets: [], total: 0, truncated: false, matchedTags: [], raw: content }
  }

  const result = executeAgentConditions(conditions)
  return { reply, conditions, raw: content, ...result }
}
