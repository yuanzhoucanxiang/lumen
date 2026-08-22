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

/** 把常见 API 错误转译成可操作的中文提示;未知错误保留原文(截断) */
function friendlyApiError(status: number, body: string): string {
  const raw = body.slice(0, 160)
  if (status === 401 || status === 403) return 'API Key 无效或没有权限,请在设置中检查 Key'
  if (status === 429) {
    if (/余额|1113|资源包|quota|insufficient/i.test(body))
      return 'AI 账户余额不足或无可用资源包,请前往服务商充值后重试'
    return '请求过于频繁(触发限流),请稍后重试或减小批量'
  }
  if (status === 404) return '接口或模型不存在,请检查设置中的 Base URL 与模型名'
  if (status >= 500) return 'AI 服务商服务异常,请稍后重试'
  return `API ${status}: ${raw}`
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
      throw new Error(friendlyApiError(resp.status, errText))
    }
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  } catch (e) {
    // AbortController 超时的原始报错是英文 abort 信息,转译成可操作提示
    if (controller.signal.aborted) {
      throw new Error(`请求超时(${Math.round(timeoutMs / 1000)}s),请检查网络或稍后重试`)
    }
    throw e
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
