/**
 * AI API 客户端（共享模块）。
 * - chat():OpenAI 兼容 chat/completions 调用,带 AbortController 超时保护。
 *   网络挂起时强制中止,避免调用方无限等待(updater / aiSearch 均踩过同类坑)。
 * - mapWithConcurrency():通用并发池(限流防 API 限流)。
 */

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/**
 * 调 OpenAI 兼容 API(纯文本或含图)。
 * @param images 图片 base64 列表(多模态视觉输入,可选)
 * @param timeoutMs 超时毫秒数,超时后 Abort 并抛错
 */
export async function chat(
  cfg: AiConfig,
  text: string,
  images?: { base64: string }[],
  maxTokens = 300,
  timeoutMs = 60_000,
  temperature = 0.3
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
        temperature,
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

/** 并发池:同时最多 limit 个任务在飞,结果按原始顺序返回 */
export async function mapWithConcurrency<T, R>(
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
