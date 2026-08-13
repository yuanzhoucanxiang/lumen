import { app } from 'electron'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { importFiles } from './importer'

const PORT = 45678
const MAX_BODY = 80 * 1024 * 1024 // 80MB

/**
 * 鉴权头:只接受 LUMEN Clip 扩展发来的请求。
 * 网页 JS 跨域 fetch 无法携带自定义头(预检会被拒绝),而 MV3 扩展持有 host_permissions
 * 可绕过 CORS 携带该头,从而阻止任意本地网页向素材库注入图片(本机原生程序不在威胁模型内)。
 */
const CLIENT_HEADER = 'x-lumen-client'
const CLIENT_TOKEN = 'lumen-clip/1'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg'
}

/** 校验请求来源:必须携带合法客户端头,否则拒绝(403) */
function isAuthorized(req: IncomingMessage): boolean {
  return req.headers[CLIENT_HEADER] === CLIENT_TOKEN
}

function json(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

interface ClipPayload {
  dataUrl?: string
  imageUrl?: string
  filename?: string
  pageUrl?: string
  title?: string
}

async function saveClip(payload: ClipPayload): Promise<number> {
  let buffer: Buffer | null = null
  let ext = 'jpg'

  if (payload.dataUrl) {
    const m = payload.dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
    if (!m) throw new Error('invalid dataUrl')
    ext = MIME_EXT[m[1]] ?? 'jpg'
    buffer = Buffer.from(m[2], 'base64')
  } else if (payload.imageUrl) {
    const resp = await fetch(payload.imageUrl)
    if (!resp.ok) throw new Error(`download failed: ${resp.status}`)
    const contentType = resp.headers.get('content-type')?.split(';')[0] ?? ''
    if (MIME_EXT[contentType]) ext = MIME_EXT[contentType]
    buffer = Buffer.from(await resp.arrayBuffer())
  }
  if (!buffer || buffer.length === 0) throw new Error('empty image')

  const name =
    payload.filename?.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) ||
    `clip_${new Date().toISOString().replace(/[:.]/g, '-')}`
  const tmpFile = join(app.getPath('temp'), `${name.replace(/\.[^.]+$/, '')}_${Date.now()}.${ext}`)
  writeFileSync(tmpFile, buffer)
  const result = await importFiles([tmpFile], { sourceUrl: payload.pageUrl ?? payload.imageUrl })
  rmSync(tmpFile, { force: true }) // 剪藏临时文件入库后清理
  return result.imported
}

/** 启动浏览器剪藏接收服务（仅监听本机回环地址，需携带客户端鉴权头） */
export function startClipServer(onImported?: (count: number) => void): void {
  const server = createServer((req, res) => {
    // 未携带鉴权头的请求直接拒绝(含网页跨域预检 OPTIONS:浏览器不会放行自定义头)
    if (!isAuthorized(req)) {
      json(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

    if (req.method === 'GET' && url.pathname === '/status') {
      json(res, 200, { ok: true, name: 'LUMEN' })
      return
    }

    if (req.method === 'POST' && url.pathname === '/clip') {
      readBody(req)
        .then(async (body) => {
          const payload = JSON.parse(body) as ClipPayload
          const n = await saveClip(payload)
          if (n > 0) onImported?.(n)
          json(res, 200, { ok: true, imported: n })
        })
        .catch((err: Error) => json(res, 400, { ok: false, error: err.message }))
      return
    }

    json(res, 404, { ok: false, error: 'not found' })
  })

  server.on('error', (err) => console.error('[clip-server]', err.message))
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[clip-server] listening on http://127.0.0.1:${PORT}`)
  })
}
