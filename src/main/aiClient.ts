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

/** 校验/归一 AI Base URL：仅 http(s)；远程必须 https，回环/局域网地址允许 http（Ollama/LM Studio 等本地推理）。
 *  防止渲染层把 baseUrl 改到任意地址后，主进程带着真实 Key 外发（settings:get 的脱敏会被此路径旁路）。 */
export function normalizeAiBaseUrl(raw: string): string {
  const base = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('AI 接口地址不能为空')
  let u: URL
  try {
    u = new URL(base)
  } catch {
    throw new Error('AI 接口地址必须是合法 URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('AI 接口地址仅支持 http(s)')
  if (u.protocol === 'http:') {
    const h = u.hostname
    const okHttp =
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      h === '::1' ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    if (!okHttp) throw new Error('远程 AI 接口地址必须使用 https（本地推理服务可用 http://127.0.0.1）')
  }
  return base
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

/** 多轮对话历史项(找图助手的上下文;content 对 chat() 不透明,原样回传) */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 调 OpenAI 兼容 API(纯文本或含图)。
 * @param images 图片 base64 列表(多模态视觉输入,可选)
 * @param timeoutMs 超时毫秒数,超时后 Abort 并抛错
 * @param history 可选多轮历史(找图助手用;置于本轮消息之前)
 */
export async function chat(
  cfg: AiConfig,
  text: string,
  images?: { base64: string }[],
  maxTokens = 300,
  timeoutMs = 60_000,
  temperature = 0.3,
  history?: ChatTurn[]
): Promise<string> {
  const url = `${normalizeAiBaseUrl(cfg.baseUrl)}/chat/completions`
  const content: Record<string, unknown>[] = [{ type: 'text', text }]
  for (const img of images ?? []) {
    content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img.base64}` } })
  }
  const messages: Record<string, unknown>[] = (history ?? []).map((h) => ({
    role: h.role,
    content: h.content
  }))
  messages.push({ role: 'user', content })
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
        messages,
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

/**
 * 流式版 chat(SSE):边生成边经 onDelta 回调吐出增量(找图助手用,让等待可感知)。
 * - 解析 OpenAI 兼容 SSE(data: {...choices[].delta.content});reasoning_content 增量忽略
 * - 流式不可用(无 body)或整条流未产出任何 content 时,回退非流式 chat 重发一次
 * - 超时语义与 chat 一致:整个流式过程共享一个计时器
 */
export async function chatStream(
  cfg: AiConfig,
  text: string,
  onDelta: (delta: string, accumulated: string) => void,
  maxTokens = 300,
  timeoutMs = 60_000,
  temperature = 0.3,
  history?: ChatTurn[]
): Promise<string> {
  const url = `${normalizeAiBaseUrl(cfg.baseUrl)}/chat/completions`
  const messages: Record<string, unknown>[] = (history ?? []).map((h) => ({
    role: h.role,
    content: h.content
  }))
  messages.push({ role: 'user', content: text })
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
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true
      }),
      signal: controller.signal
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(friendlyApiError(resp.status, errText))
    }
    if (!resp.body) {
      // 极端环境无流式 body:回退非流式
      return await chat(cfg, text, undefined, maxTokens, timeoutMs, temperature, history)
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let acc = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
          const delta = j.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) {
            acc += delta
            onDelta(delta, acc)
          }
        } catch {
          /* 心跳/注释行等无法解析的 SSE 数据:忽略 */
        }
      }
    }
    if (!acc) {
      // 整条流没吐出任何 content(推理型模型可能只流 reasoning):回退非流式重发
      return await chat(cfg, text, undefined, maxTokens, timeoutMs, temperature, history)
    }
    return acc
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`请求超时(${Math.round(timeoutMs / 1000)}s),请检查网络或稍后重试`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}
