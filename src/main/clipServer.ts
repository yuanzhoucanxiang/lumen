import { app } from 'electron'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { importFiles } from './importer'

const PORT = 45678
const MAX_BODY = 80 * 1024 * 1024 // 80MB

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg'
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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

/** 启动浏览器剪藏接收服务（仅监听本机回环地址） */
export function startClipServer(onImported?: (count: number) => void): void {
  const server = createServer((req, res) => {
    cors(res)
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
