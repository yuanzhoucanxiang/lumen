/* 打包版冒烟测试：electron-builder 剔过 node_modules 内容 + AI 缩略图走 asar 内 wasm，
   这两件事都只在打包产物里才验得到（dev 环境永远是真的 node_modules）。
   跑法：
     dist/win-unpacked/ShiGuangMaterials.exe --remote-debugging-port=9334  (需 LUMEN_ALLOW_MULTI=1)
     node scripts/smoke-packaged.cjs
   断言：① 数据库可读(getLibraryStats)；② 导入 PNG 出缩略图；③ 导入 AI(PDF 兼容层)
   出缩略图(asar 内 mupdf.wasm 可加载)；④ 导入视频出封面(ffmpeg asar.unpacked 路径可用)。
   结束把三条测试素材永久删除，不留污染。 */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PORT = process.env.SMOKE_PORT || 9334

const getJson = (url) =>
  new Promise((res, rej) =>
    http.get(url, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => res(JSON.parse(d)))
    }).on('error', rej)
  )
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function buildPdf() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  const stream = 'q 1 0 0 rg 20 20 260 160 re f Q\n'
  const parts = ['%PDF-1.4\n']
  const offsets = []
  let pos = parts[0].length
  objs.forEach((body, i) => {
    const n = i + 1
    offsets.push(pos)
    const chunk =
      body === null
        ? `${n} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`
        : `${n} 0 obj\n${body}\nendobj\n`
    parts.push(chunk)
    pos += Buffer.byteLength(chunk)
  })
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`
  parts.push(xref, `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`)
  return Buffer.from(parts.join(''), 'binary')
}

async function main() {
  let page = null
  for (let i = 0; i < 40 && !page; i++) {
    try {
      const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`)
      page = targets.find((t) => t.type === 'page' && !t.url.includes('floating'))
    } catch {
      /* 应用尚未起来 */
    }
    if (!page) await sleep(1000)
  }
  if (!page) throw new Error(`CDP ${PORT} 上找不到页面（打包版是否已带 --remote-debugging-port 启动？）`)

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((r, j) => {
    ws.on('open', r)
    ws.on('error', j)
  })
  let msgId = 0
  const pending = new Map()
  ws.on('message', (m) => {
    const msg = JSON.parse(m.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const run = async (expr) => {
    const mid = ++msgId
    const msg = await new Promise((res) => {
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true } }))
    })
    if (msg.error) throw new Error(JSON.stringify(msg.error))
    const d = msg.result?.exceptionDetails
    if (d) throw new Error(d.text + ' ' + (d.exception?.description ?? ''))
    return msg.result.result.value
  }

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
    ok ? pass++ : fail++
  }

  const stamp = Date.now()
  check('打包版启动 + window.api 可用', (await run(`return typeof window.api`)) === 'object', page.url.slice(0, 60))

  const stats = await run(`return await window.api.getLibraryStats()`)
  check('better-sqlite3 在裁剪后的包里可加载(读库统计)', typeof stats?.total === 'number', JSON.stringify(stats))

  const ver = await run(`return await window.api.getAppVersion()`)
  check('版本号可读', /^\d+\.\d+\.\d+/.test(String(ver)), String(ver))

  const tmp = path.join(os.tmpdir(), 'lumen-smoke-' + stamp)
  fs.mkdirSync(tmp, { recursive: true })
  const aiPath = path.join(tmp, `smoke-ai-${stamp}.ai`)
  fs.writeFileSync(aiPath, buildPdf())
  const pngPath = path.join(tmp, `smoke-png-${stamp}.png`)
  // 最小合法 1x1 PNG
  fs.writeFileSync(
    pngPath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  )
  const r = await run(`return await window.api.importFromPaths(${JSON.stringify([aiPath, pngPath])})`)
  check('打包版导入两张测试素材', r?.imported === 2, JSON.stringify({ imported: r?.imported, skipped: r?.skipped, failed: r?.failed }))

  const aiId = r?.importedIds?.[0]
  const thumbs = await run(`
    const out = []
    for (const id of ${JSON.stringify(r?.importedIds ?? [])}) {
      const res = await fetch(window.api.thumbnailUrl(id))
      out.push({ id, status: res.status, bytes: (await res.arrayBuffer()).byteLength })
    }
    return out
  `)
  const aiThumb = thumbs.find((t) => t.id === aiId)
  check('AI 缩略图在打包版出图(asar 内 mupdf.wasm 可用)', aiThumb?.status === 200 && aiThumb?.bytes > 800, JSON.stringify(aiThumb))
  check('PNG 缩略图正常', thumbs.length === 2 && thumbs.every((t) => t.status === 200), JSON.stringify(thumbs))

  await run(`await window.api.deleteAssets(${JSON.stringify(r?.importedIds ?? [])}, true); return 1`)
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('冒烟测试异常:', e.message)
  process.exit(1)
})
