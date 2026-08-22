import { readFileSync } from 'fs'
import {
  assetPaths,
  getAssetById,
  listTags,
  updateAsset,
  createTag,
  createTagGroup,
  assignTagToGroup
} from './repository'
import { getDb } from './db'
import { logger } from './logger'
import { chat, mapWithConcurrency } from './aiClient'
import type { AiConfig } from './aiClient'
import type {
  AiApplyRequest,
  AiProcessItem,
  AiProcessOptions,
  AiProcessResult,
  AiSuggestionItem,
  AiTagCategory,
  AiTagSuggestion,
  Tag
} from '../shared/types'

export type { AiConfig }

/** AI 原始返回（extractJson 解析后） */
interface AiRawSuggestion {
  name: string
  tags: AiTagSuggestion[]
}

/** 分类 -> 侧栏标签组名映射 */
const CATEGORY_GROUPS: Record<AiTagCategory, string> = {
  scene: 'AI-场景',
  style: 'AI-风格',
  subject: 'AI-主体',
  color: 'AI-色调',
  other: 'AI 标签'
}

/** 合法的分类值集合（校验 AI 返回的 cat 字段） */
const VALID_CATEGORIES = new Set<AiTagCategory>(['scene', 'style', 'subject', 'color', 'other'])

/** 从 AI 返回文本中提取 JSON（容错：去 ```json 包裹、找第一个 {...}） */
function extractJson(text: string, wantName: boolean): AiRawSuggestion | null {
  // 去掉 markdown 代码块包裹
  const cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim()
  // 找第一个 { 到最后一个 } 的范围
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
      name?: unknown
      tags?: unknown
    }
    const name = typeof obj.name === 'string' ? obj.name.trim() : ''
    // tags 支持两种格式：[{name,cat}]（新）或 ["a","b"]（旧/兼容）
    let tags: AiTagSuggestion[] = []
    if (Array.isArray(obj.tags)) {
      tags = obj.tags
        .map((t): AiTagSuggestion | null => {
          if (typeof t === 'string') return { name: t, category: 'other' }
          if (t && typeof t === 'object') {
            const name = typeof (t as { name?: unknown }).name === 'string' ? ((t as { name: string }).name).trim() : ''
            const rawCat = (t as { cat?: unknown }).cat
            const category: AiTagCategory =
              typeof rawCat === 'string' && VALID_CATEGORIES.has(rawCat as AiTagCategory)
                ? (rawCat as AiTagCategory)
                : 'other'
            if (!name) return null
            return { name, category }
          }
          return null
        })
        .filter((t): t is AiTagSuggestion => t !== null)
    }
    if (!name && tags.length === 0) return null
    return { name: wantName ? name.slice(0, 60) : '', tags }
  } catch {
    return null
  }
}

/**
 * 清洗 + 归并标签：
 * - 去空格/括号/引号、全角转半角
 * - 过滤过短/无意义词
 * - 同义词归并：先匹配优先标签（用户标记 priority=1，强制归并到优先标签），
 *   未命中再匹配常规标签库（大小写不敏感 + 去空格后比对），用已有标签的规范写法
 * - 去重（同 name 只保留第一个）
 */
function cleanTags(raw: AiTagSuggestion[], existingTags: Tag[]): AiTagSuggestion[] {
  const seen = new Set<string>()
  const out: AiTagSuggestion[] = []
  // 预处理：优先标签（priority=1）优先匹配；排除标签（excluded=1）直接丢弃；去空格 + 小写 -> 规范写法
  const priorityMap = new Map<string, string>()
  const existingMap = new Map<string, string>()
  const excludedKeys = new Set<string>()
  for (const t of existingTags) {
    const key = t.name.replace(/\s+/g, '').toLowerCase()
    if (t.excluded === 1) {
      excludedKeys.add(key)
      continue
    }
    if (!existingMap.has(key)) existingMap.set(key, t.name)
    if (t.priority === 1 && !priorityMap.has(key)) priorityMap.set(key, t.name)
  }
  for (const t of raw) {
    let name = t.name
      .trim()
      .replace(/\s+/g, '') // 去所有空格
      .replace(/[（）()【】\[\]「」]/g, '') // 去括号
      .replace(/[""'']/g, '') // 去引号
    // 全角字母数字转半角
    name = name.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // 过滤过短/无意义
    if (name.length < 1 || name.length > 20) continue
    if (/^(无|未知|图片|image|photo|截图|screenshot|未分类|其他)$/i.test(name)) continue
    const key = name.toLowerCase()
    // 排除标签：用户明确不要的，直接丢弃
    if (excludedKeys.has(key)) continue
    // 同义词归并：优先标签最优先，其次常规标签库
    const matchedPriority = priorityMap.get(key)
    const matched = matchedPriority ?? existingMap.get(key)
    if (matched) name = matched
    // 去重
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, category: t.category || 'other' })
  }
  return out
}

/** 单张：读缩略图 base64 + 元数据 -> 调 OpenAI 兼容 API -> 返回原始建议 */
async function suggestForAsset(
  id: string,
  cfg: AiConfig,
  options: AiProcessOptions,
  allTags: Tag[]
): Promise<AiRawSuggestion> {
  const paths = assetPaths(id)
  if (!paths || !paths.thumbnail) throw new Error('素材文件不存在')

  // 读缩略图（512px JPEG，省 token）
  const imgBuf = readFileSync(paths.thumbnail)
  const base64 = imgBuf.toString('base64')

  // 元数据辅助
  const asset = getAssetById(id)
  const meta = asset
    ? `原名=${asset.name},尺寸=${asset.width}x${asset.height},已有标签=${asset.tagNames.join('/')}`
    : `id=${id}`

  // 用户标记的优先标签单独列出（最高优先级，只要内容匹配就强制选用）
  const priorityTags = allTags.filter((t) => t.priority === 1)
  const priorityHint =
    priorityTags.length > 0
      ? `优先标签：${priorityTags.map((t) => t.name).join(',')}。这些是用户最常用的标签，只要内容匹配就优先选用它们。\n`
      : ''

  // 用户排除的标签（AI 绝不使用）
  const excludedTags = allTags.filter((t) => t.excluded === 1)
  const excludedHint =
    excludedTags.length > 0
      ? `排除标签：${excludedTags.map((t) => t.name).join(',')}。绝对不要使用这些标签。\n`
      : ''

  // 取已有标签库，让 AI 优先复用（避免同义标签泛滥）
  const tagNames = allTags.map((t) => t.name)
  const tagLibHint =
    tagNames.length > 0
      ? `已有标签库：${tagNames.slice(0, 100).join(',')}。优先从中选用匹配的标签，不足时再新建（避免同义重复）。\n`
      : ''

  const maxTags = options.maxTags ?? 5
  const wantName = options.rename !== false

  const prompt =
    `分析这张图片,返回 JSON:\n` +
    `{"name":"${wantName ? '简短中文文件名(8-20字,不含扩展名,用下划线或短横连接)' : ''}","tags":[{"name":"标签","cat":"分类"}]}\n\n` +
    `标签规范:\n` +
    `- 生成 2-${maxTags} 个标签,每个标签 2-8 字\n` +
    `- cat 分类:scene(场景/环境)、style(风格/画风)、subject(主体/对象)、color(色调/氛围)\n` +
    `- 优先复用已有标签库中的标签\n` +
    `- 标签简洁,避免同义重复\n\n` +
    `${priorityHint}` +
    `${excludedHint}` +
    `${tagLibHint}` +
    `参考信息:${meta}\n\n` +
    `示例:\n` +
    `{"name":"奇幻洞穴场景","tags":[{"name":"洞穴","cat":"scene"},{"name":"岩石地貌","cat":"subject"},{"name":"奇幻","cat":"style"},{"name":"暗黑氛围","cat":"color"}]}\n\n` +
    `只返回 JSON。`

  // max_tokens 须给足:推理型模型(如 deepseek-v4-flash)的思考链与正文共享该预算,
  // 250 会被思考吃光 → content 为空或 JSON 截断(日志 16:42-17:06 批量失败实证)
  const content = await chat(cfg, prompt, [{ base64 }], 2000, 90_000, 0.3)
  const suggestion = extractJson(content, wantName)
  if (!suggestion) {
    logger.warn('[ai]', `无法解析 AI 返回: ${content.slice(0, 100)}`)
    throw new Error('AI 返回格式无法解析')
  }
  return suggestion
}

/* ================ 阶段一：生成建议（不写 DB） ================ */

/**
 * 批量生成 AI 建议：并发调 API，返回可编辑的建议列表。
 * 标签经 cleanTags 清洗归并，不写数据库。
 */
export async function aiSuggestBatch(
  ids: string[],
  cfg: AiConfig,
  options: AiProcessOptions,
  onProgress: (done: number, total: number, failed: number) => void
): Promise<{ items: AiSuggestionItem[]; failed: number; failedIds: string[] }> {
  const total = ids.length
  let done = 0
  let failed = 0
  const failedIds: string[] = []
  const items: AiSuggestionItem[] = []
  const maxTags = options.maxTags ?? 5
  const rename = options.rename !== false
  const tag = options.tag !== false

  // 已有标签库：一次查询复用（含 priority，供 cleanTags 优先归并 + prompt 优先标签 hint）
  const existingTags = listTags()

  await mapWithConcurrency(ids, 3, async (id) => {
    try {
      const raw = await suggestForAsset(id, cfg, options, existingTags)
      const asset = getAssetById(id)
      if (!asset) throw new Error('素材不存在')

      // 清洗标签
      const cleanedTags = tag ? cleanTags(raw.tags, existingTags).slice(0, maxTags) : []

      // 过滤掉素材已有的标签
      const newTags = cleanedTags.filter((t) => !asset.tagNames.includes(t.name))

      items.push({
        id,
        oldName: asset.name,
        suggestedName: rename && raw.name ? `${raw.name}.${asset.ext}` : '',
        tags: newTags
      })
    } catch (e) {
      failed++
      failedIds.push(id)
      logger.warn('[ai]', `生成建议失败 ${id}: ${(e as Error).message}`)
    } finally {
      done++
      onProgress(done, total, failed)
    }
  })

  logger.info('[ai]', `建议生成完成：${items.length}/${total} 成功，${failed} 失败`)
  return { items, failed, failedIds }
}

/* ================ 阶段二：应用建议（写 DB） ================ */

/**
 * 应用用户审核后的建议：改名 + 打标签 + 按分类归组。
 * 只处理 items 中用户保留的建议（可能已删标签/改过名）。
 */
export async function aiApplySuggestions(
  items: AiSuggestionItem[],
  options: AiProcessOptions
): Promise<AiProcessResult> {
  const rename = options.rename !== false
  const tag = options.tag !== false
  const resultItems: AiProcessItem[] = []
  const failedIds: string[] = []
  let failed = 0

  // 标签聚合：tagName -> { assetIds, category }（一次收集，最后统一批量打标）
  const tagMap = new Map<string, { assetIds: string[]; category: AiTagCategory }>()

  for (const item of items) {
    try {
      const asset = getAssetById(item.id)
      if (!asset) throw new Error('素材不存在')

      const result: AiProcessItem = {
        id: item.id,
        oldName: asset.name,
        newName: asset.name,
        addedTags: []
      }

      // 改名（保留扩展名）
      if (rename && item.suggestedName && item.suggestedName !== asset.name) {
        updateAsset(item.id, { name: item.suggestedName })
        result.newName = item.suggestedName
      }

      // 收集标签
      if (tag) {
        for (const t of item.tags) {
          if (!asset.tagNames.includes(t.name)) {
            const entry = tagMap.get(t.name)
            if (entry) {
              entry.assetIds.push(item.id)
            } else {
              tagMap.set(t.name, { assetIds: [item.id], category: t.category })
            }
            result.addedTags.push(t.name)
          }
        }
      }

      resultItems.push(result)
    } catch (e) {
      failed++
      failedIds.push(item.id)
      logger.warn('[ai]', `应用失败 ${item.id}: ${(e as Error).message}`)
    }
  }

  // 标签统一落库：按标签名聚合批量打给所有素材 + 按分类归入子组
  if (tag && tagMap.size > 0) {
    const ins = getDb().prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
    // 组缓存：分类 -> groupId
    const groupCache = new Map<AiTagCategory, number>()
    for (const [tagName, { assetIds, category }] of tagMap) {
      const tagRow = createTag(tagName)
      // 只对 group_id 为 null 的新标签归入 AI 分类组（不覆盖已有分组）
      if (tagRow.groupId === null) {
        let groupId = groupCache.get(category)
        if (groupId === undefined) {
          groupId = createTagGroup(CATEGORY_GROUPS[category]).id
          groupCache.set(category, groupId)
        }
        assignTagToGroup(tagRow.id, groupId)
      }
      for (const id of assetIds) ins.run(id, tagRow.id)
    }
  }

  const processed = resultItems.length
  logger.info('[ai]', `应用完成：${processed} 个素材，${tagMap.size} 个标签，${failed} 失败`)
  return { processed, failed, failedIds, items: resultItems }
}

/**
 * 一键处理（生成 + 应用，无预览）：供 autoAiAfterImport 等无感自动化场景使用。
 * 签名与原 aiProcessBatch 兼容。
 */
export async function aiProcessBatch(
  ids: string[],
  cfg: AiConfig,
  options: AiProcessOptions,
  onProgress: (done: number, total: number, failed: number) => void
): Promise<AiProcessResult> {
  const { items, failed, failedIds } = await aiSuggestBatch(ids, cfg, options, onProgress)
  if (items.length === 0) {
    return { processed: 0, failed, failedIds, items: [] }
  }
  return aiApplySuggestions(items, options)
}

/** 测试 API 连通性（发一个最小文本请求，20s 超时防挂起；maxTokens 给足防推理模型思考吃光预算返回空） */
export async function testAiConnection(cfg: AiConfig): Promise<{ ok: boolean; message: string }> {
  try {
    await chat(cfg, 'hi', undefined, 512, 20_000)
    return { ok: true, message: '连接成功' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
