import { readFileSync } from 'fs'
import { assetPaths, getAssetById, updateAsset, addTagToAssets } from './repository'
import { logger } from './logger'
import type { AiProcessResult } from '../shared/types'

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

interface AiSuggestion {
  name: string
  tags: string[]
}

/** 并发池（与 importer 的 mapWithConcurrency 同思路，AI 请求限 3 并发防限流） */
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

/** 从 AI 返回文本中提取 JSON（容错：去 ```json 包裹、找第一个 {...}） */
function extractJson(text: string): AiSuggestion | null {
  // 去掉 markdown 代码块包裹
  const cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim()
  // 找第一个 { 到最后一个 } 的范围
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as { name?: unknown; tags?: unknown }
    const name = typeof obj.name === 'string' ? obj.name.trim() : ''
    const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : []
    if (!name && tags.length === 0) return null
    return { name: name.slice(0, 60), tags: tags.slice(0, 8).map((t) => t.slice(0, 20)) }
  } catch {
    return null
  }
}

/** 单张：读缩略图 base64 + 元数据 -> 调 OpenAI 兼容 API -> 返回建议 */
async function suggestForAsset(id: string, cfg: AiConfig): Promise<AiSuggestion> {
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

  const prompt =
    `看这张图，返回 JSON：{"name":"简短中文文件名(8-20字，不含扩展名，用下划线或短横连接)","tags":["标签1","标签2","标签3"]}。` +
    `参考信息：${meta}。生成 2-5 个描述性标签。只返回 JSON，不要其他文字。`

  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            { type: 'text', text: prompt }
          ]
        }
      ],
      temperature: 0.7,
      max_tokens: 200
    })
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`API ${resp.status}: ${errText.slice(0, 120)}`)
  }

  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content ?? ''
  const suggestion = extractJson(content)
  if (!suggestion) {
    logger.warn('[ai]', `无法解析 AI 返回: ${content.slice(0, 100)}`)
    throw new Error('AI 返回格式无法解析')
  }
  return suggestion
}

/**
 * 批量 AI 处理：并发调 API + 直接应用（改名 + 追加标签）。
 * 对标 Eagle：无预览，直接应用（标签追加式，改名可撤销）。
 */
export async function aiProcessBatch(
  ids: string[],
  cfg: AiConfig,
  onProgress: (done: number, total: number, failed: number) => void
): Promise<AiProcessResult> {
  const total = ids.length
  let done = 0
  let failed = 0
  const failedIds: string[] = []

  await mapWithConcurrency(ids, 3, async (id) => {
    try {
      const suggestion = await suggestForAsset(id, cfg)
      const asset = getAssetById(id)
      if (!asset) throw new Error('素材不存在')

      // 改名（保留扩展名）
      if (suggestion.name) {
        const newName = `${suggestion.name}.${asset.ext}`
        if (newName !== asset.name) {
          updateAsset(id, { name: newName })
        }
      }
      // 追加标签（addTagToAssets 自动创建不存在的标签）
      if (suggestion.tags.length > 0) {
        for (const tag of suggestion.tags) {
          addTagToAssets([id], tag)
        }
      }
    } catch (e) {
      failed++
      failedIds.push(id)
      logger.warn('[ai]', `处理失败 ${id}: ${(e as Error).message}`)
    } finally {
      done++
      onProgress(done, total, failed)
    }
  })

  const processed = total - failed
  logger.info('[ai]', `批量处理完成：${processed}/${total} 成功，${failed} 失败`)
  return { processed, failed, failedIds }
}

/** 测试 API 连通性（发一个最小文本请求） */
export async function testAiConnection(cfg: AiConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5
      })
    })
    if (resp.ok) return { ok: true, message: '连接成功' }
    const errText = await resp.text().catch(() => '')
    return { ok: false, message: `API 返回 ${resp.status}: ${errText.slice(0, 80)}` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
