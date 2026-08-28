import { isIP } from 'net'
import { lookup } from 'dns/promises'

/**
 * URL 导入/剪藏抓图的出网防护：
 * - 协议仅放行 http(s)，重定向逐跳复检（fetch redirect:'manual' 手动跟随）
 * - 默认拒绝回环/链路本地/CGNAT 地址（防探测本机服务与云元数据端点）
 * - allowLocal=true 放行本机/私网（import:urls 用户主动粘贴，响应只进本机素材库无外泄通道；
 *   本地图源/局域网图床/NAS 是合理使用场景）
 */

const MAX_REDIRECTS = 5

function isBlockedIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }
  if (v === 6) {
    const s = ip.toLowerCase()
    return s === '::1' || s === '::' || s.startsWith('fe80')
  }
  return true
}

/** 校验 URL 可出网：协议 http(s) 且（字面量 IP 或 DNS 解析后的所有地址）均不在封锁段 */
export async function assertPublicHttpUrl(raw: string, allowLocal = false): Promise<URL> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('invalid url')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) allowed')
  if (allowLocal) return u
  const hostname = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error('blocked address')
  } else {
    const addrs = await lookup(hostname, { all: true }).catch(() => {
      throw new Error('dns lookup failed')
    })
    if (addrs.length === 0) throw new Error('dns lookup failed')
    if (addrs.some((a) => isBlockedIp(a.address))) throw new Error('blocked address')
  }
  return u
}

/** 手动跟随重定向的受限 fetch：每一跳都重新过 assertPublicHttpUrl */
export async function guardedFetch(
  raw: string,
  timeoutMs = 30000,
  opts: { allowLocal?: boolean } = {}
): Promise<Response> {
  let url = raw
  for (let i = 0; ; i++) {
    await assertPublicHttpUrl(url, opts.allowLocal ?? false)
    if (i > MAX_REDIRECTS) throw new Error('too many redirects')
    const resp = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location')
      void resp.body?.cancel().catch(() => undefined)
      if (!loc) throw new Error(`bad redirect: ${resp.status}`)
      url = new URL(loc, url).toString()
      continue
    }
    return resp
  }
}

/** 流式读取响应体，累计超过 cap 字节即中止（防超大响应吃满内存） */
export async function readBodyCapped(resp: Response, cap: number): Promise<Buffer> {
  const reader = resp.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      void reader.cancel().catch(() => undefined)
      throw new Error('response too large')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}
