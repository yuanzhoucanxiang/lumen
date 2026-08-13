import { readFileSync } from 'fs'
import { assetPaths, listTags, searchAssets } from './repository'
import { logger } from './logger'
import type { Asset, Tag } from '../shared/types'

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** 从 AI 返回文本中提取 JSON（容错：去 ```json 包裹、找第一个 {...}） */
function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 调 OpenAI 兼容 API（text-only 或含图片），带超时保护（网络抖动时挂起不阻塞 UI） */
async function chat(
  cfg: AiConfig,
  text: string,
  images?: { base64: string }[],
  maxTokens = 300,
  timeoutMs = 60_000
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`
  const content: Record<string, unknown>[] = [{ type: 'text', text }]
  for (const img of images ?? []) {
    content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img.base64}` } })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content }],
        temperature: 0.2,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`API ${resp.status}: ${errText.slice(0, 120)}`)
    }
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

/* ================ 阶段 1：语义 -> 检索条件 ================ */

interface ExpandedQuery {
  keywords: string[]
  tagNames: string[]
}

/**
 * 把自然语言搜索词转成检索条件：keywords（SQL LIKE）+ tagNames（标签库中选）。
 * 纯文本调用，便宜。
 */
async function expandQuery(query: string, cfg: AiConfig, allTags: Tag[]): Promise<ExpandedQuery> {
  // 标签库全量传入会超 token(标签多时),截取前 200 个(按素材数降序保留常用标签)
  const tagLib = [...allTags]
    .sort((a, b) => b.count - a.count)
    .slice(0, 200)
    .map((t) => t.name)
    .join(',')
  const prompt =
    `把用户的素材搜索意图转成检索条件,返回 JSON:\n` +
    `{"keywords":["画面内容关键词"],"tags":["标签"]}\n\n` +
    `规则:\n` +
    `- tags 只能从下方标签库中挑选语义匹配的(没有匹配就不写 tags,返回空数组)\n` +
    `- 若查询与标签库完全无关,tags 必须为空数组,不要强行匹配不相关的标签\n` +
    `- keywords 是描述画面内容的词(1-5 个,不含已选标签,不要超过 6 个字)\n\n` +
    `标签库:${tagLib}\n\n` +
    `用户搜索:${query}\n\n` +
    `只返回 JSON。`

  const content = await chat(cfg, prompt, undefined, 200)
  const obj = extractJson(content)
  if (!obj) {
    logger.warn('[aiSearch]', `阶段1解析失败: ${content.slice(0, 100)}`)
    return { keywords: [query], tagNames: [] }
  }
  const keywords = Array.isArray(obj.keywords)
    ? (obj.keywords as unknown[]).filter((k): k is string => typeof k === 'string' && !!k.trim()).slice(0, 5)
    : []
  const tagNames = Array.isArray(obj.tags)
    ? (obj.tags as unknown[]).filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, 8)
    : []
  if (keywords.length === 0 && tagNames.length === 0) {
    return { keywords: [query], tagNames: [] }
  }
  return { keywords, tagNames }
}

/* ================ 阶段 3：AI 视觉精排 ================ */

const VISION_BATCH = 6 // 每批图片数(单请求多图耗时超线性,小批量更快)
const VISION_MAX_CANDIDATES = 36 // 精排上限(超出按标签命中数取前 N)
const VISION_CONCURRENCY = 3 // 并发批次数

/** 并发池(与 aiRename 同思路) */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 视觉精排：把候选缩略图分批(并发)发给视觉模型打分（0-10 相关性）。
 * 返回 assetId -> score 映射；任一批次失败不影响其他批次。
 */
async function rankByVision(
  query: string,
  candidates: Asset[],
  cfg: AiConfig,
  onProgress: (phase: string, done: number, total: number) => void
): Promise<Map<string, number>> {
  const scores = new Map<string, number>()
  const batches: Asset[][] = []
  for (let b = 0; b < candidates.length; b += VISION_BATCH) {
    batches.push(candidates.slice(b, b + VISION_BATCH))
  }
  let done = 0
  const total = batches.length
  onProgress(`AI 视觉匹配 0/${total}…`, 0, total)

  await mapWithConcurrency(batches, VISION_CONCURRENCY, async (batch) => {
    const images: { base64: string }[] = []
    const ids: string[] = []
    for (const a of batch) {
      try {
        const paths = assetPaths(a.id)
        if (!paths || !paths.thumbnail) continue
        images.push({ base64: readFileSync(paths.thumbnail).toString('base64') })
        ids.push(a.id)
      } catch {
        /* 缩略图读取失败跳过该候选 */
      }
    }
    if (images.length === 0) {
      done++
      onProgress(`AI 视觉匹配 ${done}/${total}…`, done, total)
      return
    }
    const prompt =
      `你是素材检索助手。用户在找素材,查询意图:「${query}」\n` +
      `下面按顺序是 ${images.length} 张图(编号 1-${images.length}),评估每张与查询意图的视觉相关性,返回 JSON:\n` +
      `{"matches":[{"idx":1,"score":8},{"idx":3,"score":2}]}\n` +
      `score 为 0-10 整数(10=高度相关,0=无关),只返回 JSON。`

    const t0 = Date.now()
    try {
      const content = await chat(cfg, prompt, images, 300)
      const obj = extractJson(content)
      const matches = obj?.matches
      if (Array.isArray(matches)) {
        for (const m of matches) {
          const idx = (m as { idx?: unknown }).idx
          const score = (m as { score?: unknown }).score
          if (typeof idx !== 'number' || typeof score !== 'number') continue
          const id = ids[idx - 1]
          if (id) scores.set(id, score)
        }
      } else {
        logger.warn('[aiSearch]', `视觉批次解析失败: ${content.slice(0, 80)}`)
      }
    } catch (e) {
      logger.warn('[aiSearch]', `视觉批次失败: ${(e as Error).message}`)
    }
    logger.debug('[aiSearch]', `视觉批次完成: ${images.length} 图 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    done++
    onProgress(`AI 视觉匹配 ${done}/${total}…`, done, total)
  })

  return scores
}

/* ================ 主入口 ================ */

/**
 * AI 智能搜索：三阶段
 * 1) 语义 -> keywords + 标签（1 次文本调用）
 * 2) searchAssets OR 语义筛选候选，按命中标签数预排
 * 3) 视觉精排前 60 候选（分批 GLM-4V 打分），失败降级回阶段 2 顺序
 */
export async function aiSearch(
  query: string,
  cfg: AiConfig,
  onProgress: (phase: string, done: number, total: number) => void
): Promise<Asset[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const allTags = listTags()

  // 阶段 1
  onProgress('分析搜索词…', 0, 1)
  const expanded = await expandQuery(trimmed, cfg, allTags)
  onProgress('分析搜索词…', 1, 1)

  // 标签名 -> tagId(先精确匹配,再模糊包含匹配)
  const tagNameSet = new Set(expanded.tagNames)
  const matchedTags: { name: string; id: number }[] = []
  for (const tn of expanded.tagNames) {
    let hit = allTags.find((t) => t.name === tn)
    if (!hit) hit = allTags.find((t) => t.name.toLowerCase() === tn.toLowerCase())
    if (!hit) hit = allTags.find((t) => t.name.includes(tn) || tn.includes(t.name))
    if (hit) matchedTags.push({ name: hit.name, id: hit.id })
  }
  const matchedTagIds = matchedTags.map((t) => t.id)
  const matchedTagNames = new Set(matchedTags.map((t) => t.name))

  logger.info(
    '[aiSearch]',
    `查询「${trimmed}」-> keywords=[${expanded.keywords.join(',')}] tags=[${matchedTags.map((t) => t.name).join(',')}]`
  )

  // 阶段 2
  onProgress('筛选候选素材…', 0, 1)
  const candidates = searchAssets(matchedTagIds, expanded.keywords, 500)
  onProgress('筛选候选素材…', 1, 1)
  if (candidates.length === 0) return []

  // 预排：命中扩展标签数降序，其次导入时间降序
  candidates.sort((a, b) => {
    const ca = a.tagNames.filter((t) => matchedTagNames.has(t)).length
    const cb = b.tagNames.filter((t) => matchedTagNames.has(t)).length
    if (ca !== cb) return cb - ca
    return b.importedAt - a.importedAt
  })

  // 阶段 3：视觉精排(前 60 候选)
  const toRank = candidates.slice(0, VISION_MAX_CANDIDATES)
  const scores = await rankByVision(trimmed, toRank, cfg, onProgress)

  if (scores.size === 0) {
    // 全部批次失败:降级为阶段 2 预排顺序
    logger.warn('[aiSearch]', '视觉精排失败,降级为关键词筛选顺序')
    return candidates.slice(0, VISION_MAX_CANDIDATES)
  }

  const scored = toRank
    .filter((a) => scores.has(a.id))
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
  const scoreValues = [...scores.values()]
  logger.info(
    '[aiSearch]',
    `搜索完成:候选 ${candidates.length},视觉评分 ${scored.length} 个 (min=${Math.min(...scoreValues)},max=${Math.max(...scoreValues)})`
  )
  // 阈值过滤:低于 4 分视为不相关,提高精度;若全被过滤(查询太主观),兜底返回评分最高的 5 个
  const SCORE_MIN = 4
  const kept = scored.filter((a) => (scores.get(a.id) ?? 0) >= SCORE_MIN)
  return kept.length > 0 ? kept : scored.slice(0, 5)
}
