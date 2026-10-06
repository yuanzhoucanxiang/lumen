/**
 * 找图助手（里程碑 161）：对话式自然语言检索。
 *
 * 与 aiSearch（单轮「语义扩展 → SQL → 视觉精排」）的分工：
 * 本模块是**多轮对话 + 结构化条件**——把自然语言映射到 queryAssets 的完整条件面
 * （时间/尺寸/构图/星级/未标注/来源），支持追问收窄。协议用「让模型返回 JSON 指令」
 * 而非 function calling：兼容各家 OpenAI 兼容模型，容错解析复用 aiSearch 的 extractJson。
 * 只读——本模块不写库，写操作（打标签/存智能文件夹）留待后续版本。
 */
import { listTags, libraryStats, queryAssets, getAssetById, addTagToAssets } from './repository'
import { logger } from './logger'
import { chat } from './aiClient'
import { extractJson, rankByVision } from './aiSearch'
import type { AiConfig, ChatTurn } from './aiClient'
import type {
  AgentAssetBrief,
  AgentConditions,
  AgentReply,
  AgentSearchResult,
  Asset,
  AssetQuery,
  SmartConditions
} from '../shared/types'

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

/** 消毒后的条件 → AssetQuery（标签名解析为 id；供检索/全量/智能文件夹三条路径共用） */
function buildAgentQuery(raw: unknown): { query: AssetQuery; matchedTags: string[] } | null {
  const c = sanitizeConditions(raw)
  if (!c) return null

  const { ids: tagIds, matched } = c.tags ? resolveTagIds(c.tags) : { ids: [], matched: [] }
  // 条件写了标签但一个都没匹配上：直接回空（否则会退化成"无标签筛选"返回全库）
  if (c.tags && c.tags.length > 0 && tagIds.length === 0) return null

  const query: AssetQuery = {
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
  return { query, matchedTags: matched }
}

/**
 * 执行结构化条件检索（纯读库，不依赖 AI）——找图助手的执行层（窄列预览）。
 * 也供渲染层/后续版本直接调用（把一组条件应用到图库）。
 */
export function executeAgentConditions(raw: unknown): AgentSearchResult {
  const built = buildAgentQuery(raw)
  if (!built) return { assets: [], total: 0, truncated: false, matchedTags: [] }

  const rows = queryAssets(built.query)
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
  logger.info('[aiAgent]', `条件检索命中 ${total} 个（标签命中: ${built.matchedTags.join(',') || '无'}）`)
  return { assets, total, truncated: total >= COUNT_CAP, matchedTags: built.matchedTags }
}

/** 全量结果（完整 Asset，供「在素材库中查看」把结果铺进图库） */
export function agentSearchFull(raw: unknown): Asset[] {
  const built = buildAgentQuery(raw)
  if (!built) return []
  return queryAssets(built.query)
}

/**
 * 按条件给全部命中素材打标签（里程碑 166）——助手的可撤销写操作（标签可随时移除）。
 * 与检索同一条 buildAgentQuery 路径（含标签名→tagId、未命中标签回空等全部守卫）。
 * 返回实际打上标签的素材数（INSERT OR IGNORE 幂等，重复打不产生脏数据）。
 */
export function agentTagByConditions(raw: unknown, tag: string): { tagged: number } {
  const name = String(tag ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 40)
  if (!name) return { tagged: 0 }
  const built = buildAgentQuery(raw)
  if (!built) return { tagged: 0 }
  const rows = queryAssets(built.query)
  if (rows.length === 0) return { tagged: 0 }
  addTagToAssets(
    rows.map((a) => a.id),
    name
  )
  logger.info('[aiAgent]', `按条件打标签「${name}」: ${rows.length} 个素材`)
  return { tagged: rows.length }
}

/**
 * 条件 → 智能文件夹条件（供「存为智能文件夹」持久化）。
 * 仅映射 SmartConditions 支持的字段：sortBy/sortDesc 不持久化（图库排序由视图决定，集合相同）。
 * 标签名 → tagId；一个都没匹配上时返回 null（存下去会变成无标签条件，语义错误）。
 */
export function agentConditionsToSmart(raw: unknown): SmartConditions | null {
  const c = sanitizeConditions(raw)
  if (!c) return null
  const smart: SmartConditions = {}
  if (c.keyword) smart.keyword = c.keyword
  if (c.tags && c.tags.length > 0) {
    const { ids } = resolveTagIds(c.tags)
    if (ids.length === 0) return null
    smart.tagIds = ids
  }
  if (c.exts) smart.exts = c.exts
  if (c.starMin) smart.starMin = c.starMin
  if (c.minW) smart.minW = c.minW
  if (c.maxW) smart.maxW = c.maxW
  if (c.withinDays) smart.withinDays = c.withinDays
  if (c.untagged) smart.untagged = true
  if (c.shape) smart.shape = c.shape
  if (c.source !== undefined) smart.source = c.source === 'manual' ? '' : c.source
  return Object.keys(smart).length > 0 ? smart : null
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
    `素材库现状: 共 ${stats.total} 个素材(其中 AI 助手导入 ${stats.agent} 个,回收站 ${stats.deleted} 个)\n\n` +
    `要求:\n` +
    `1. 只返回 JSON,不要任何解释文字:{"reply":"给用户的简短中文回复(一句话)","conditions":{...}}\n` +
    `2. 用户只是闲聊/提问、无法转成检索条件时,conditions 返回 null——如果是问库的统计(如"库里有多少张"),直接在 reply 里用上面的现状数据回答\n` +
    `3. 多轮对话要结合上文:用户说"再暗一点""换成竖图"等,必须在上轮条件基础上调整后输出完整条件\n` +
    `4. 不要编造标签库里没有的标签;拿不准的字段宁可省略\n\n` +
    `用户本轮:${message}\n\n` +
    `只返回 JSON。`
  )
}

/**
 * 一轮对话：模型 → JSON 指令 → 条件映射 → 查库 → 回复。
 * 失败兜底：模型输出无法解析为 JSON 时自动重试一次（附严格格式提醒）；仍失败则把原文当回复返回，不抛错打断对话。
 */
export async function agentChatTurn(
  message: string,
  history: ChatTurn[],
  cfg: AiConfig
): Promise<AgentReply> {
  const trimmed = message.trim()
  if (!trimmed) {
    return { reply: '想找什么素材？直接描述就行。', conditions: null, smart: null, assets: [], total: 0, truncated: false, matchedTags: [], raw: '' }
  }

  const prompt = buildPrompt(trimmed)
  // maxTokens 给足:推理型模型思考链与正文共享预算
  let content = await chat(cfg, prompt, undefined, 1500, 90_000, 0.2, history)
  let obj = extractJson(content)

  if (!obj) {
    // 重试一次:附严格格式提醒(推理型模型偶发把说明文字混进输出)
    logger.warn('[aiAgent]', `首轮输出无法解析,重试: ${content.slice(0, 120)}`)
    const retry = await chat(
      cfg,
      `${prompt}\n\n(重要:你上一次的回复无法解析。这次必须只输出一个 JSON 对象,以 { 开头以 } 结尾,不要任何其他文字。)`.trim(),
      undefined,
      1500,
      90_000,
      0.1,
      history
    )
    obj = extractJson(retry)
    if (obj) content = retry
  }

  if (!obj) {
    logger.warn('[aiAgent]', `重试后仍无法解析: ${content.slice(0, 120)}`)
    return {
      reply: content.trim().slice(0, 300) || '（AI 没有返回可用的结果，换个说法再试试）',
      conditions: null,
      smart: null,
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
    return { reply, conditions: null, smart: null, assets: [], total: 0, truncated: false, matchedTags: [], raw: content }
  }

  const result = executeAgentConditions(conditions)
  return { reply, conditions, smart: agentConditionsToSmart(conditions), raw: content, ...result }
}

/**
 * AI 视觉重排（里程碑 164）：对助手已检索到的一批素材按查询意图做视觉相关性重排。
 * 复用 aiSearch 的 rankByVision 管线（缩略图分批发视觉模型打分）。
 * 处理「感觉上像 XX」这类无法结构化表达的查询；scores 挂在 brief.score 上（未打分的排后面）。
 */
export async function agentRerank(
  query: string,
  ids: string[],
  cfg: AiConfig,
  onProgress: (phase: string, done: number, total: number) => void
): Promise<AgentAssetBrief[]> {
  // 过滤已删除素材(软删/永久删):检索与重排之间素材可能被删,不能让重排把它们重新带回面板
  const assets = ids
    .map((id) => getAssetById(id))
    .filter((a): a is NonNullable<typeof a> => !!a && a.deletedAt == null)
  if (assets.length === 0) return []
  const scores = await rankByVision(query, assets, cfg, onProgress)
  if (scores.size === 0) return [] // 全部批次失败:调用方保留原顺序并提示
  return assets
    .map((a) => ({
      id: a.id,
      name: a.name,
      ext: a.ext,
      width: a.width,
      height: a.height,
      star: a.star,
      source: a.source,
      tags: a.tagNames ?? [],
      score: scores.get(a.id)
    }))
    .sort((x, y) => (y.score ?? -1) - (x.score ?? -1))
}
