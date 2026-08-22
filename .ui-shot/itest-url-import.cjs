/* URL 粘贴抓图导入 端到端验证(里程碑 108):
   脚本内起本地 HTTP 图片源,通过真实 IPC(window.api.importFromUrls)验证:
   下载导入成功 + assets.url 来源落库 + 重复导入查重跳过 + file:// 协议拒绝 + 404 失败。
   结束软删除清理,不污染用户库。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-url-import.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const path = require('path')

function getJson(url) {
  return new Promise((res, rej) =>
    http.get(url, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => res(JSON.parse(d)))
    }).on('error', rej)
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  /* ---------- 本地图片源 ---------- */
  const png = fs.readFileSync(path.join(__dirname, '..', 'test-fixtures', 'sample.png'))
  const hits = { ok: 0 }
  const server = http.createServer((req, res) => {
    const u = req.url || ''
    if (u === '/ok.png' || u === '/again.png') {
      hits.ok++
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(png)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`

  try {
    /* ---------- CDP 封装 ---------- */
    const targets = await getJson('http://127.0.0.1:9333/json/list')
    const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
    if (!page) throw new Error('找不到主窗口页面')
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
    let id = 0
    const pending = new Map()
    ws.on('message', (m) => {
      const msg = JSON.parse(m.toString())
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    })
    const run = async (expr) => {
      const r = await new Promise((resolve, reject) => {
        const mid = ++id
        pending.set(mid, (msg) => {
          if (msg.error) reject(new Error(JSON.stringify(msg.error)))
          else resolve(msg.result)
        })
        ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true } }))
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      return r.result.value
    }

    let pass = 0
    let fail = 0
    const check = (name, ok, detail) => {
      console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
      if (ok) pass++
      else fail++
    }

    /* ---------- 0. 就绪 ---------- */
    let ready = false
    for (let i = 0; i < 60; i++) {
      await sleep(500)
      ready = await run(`return !!document.querySelector('.archive-shell')`)
      if (ready) break
    }
    check('主界面就绪', ready)

    // 清理上轮残留:崩溃时未软删的 ok.png 会让本轮被查重跳过
    const staleIds = await run(`return (async () => {
      const all = await window.api.queryAssets({ keyword: 'ok.png' })
      return (all || []).filter((a) => a.name === 'ok.png').map((a) => a.id)
    })()`)
    if ((staleIds || []).length > 0) {
      await run(`return window.api.deleteAssets(${JSON.stringify(staleIds)}, true)`)
      console.log('  (清理上轮残留', staleIds.length, '条)')
    }

    /* ---------- 1. 导入成功 + url 来源落库 ---------- */
    const okUrl = `${base}/ok.png`
    const r1 = await run(`return window.api.importFromUrls([${JSON.stringify(okUrl)}])`)
    check('导入成功 imported=1', r1.imported === 1 && (r1.importedIds || []).length === 1, JSON.stringify({ imported: r1.imported, failed: r1.failed }))
    const assetId = (r1.importedIds || [])[0]
    const savedUrl = assetId
      ? await run(`return (async () => { const a = await window.api.getAsset(${JSON.stringify(assetId)}); return a?.url ?? '' })()`)
      : ''
    check('assets.url 来源落库', savedUrl === okUrl, savedUrl)

    /* ---------- 2. 重复导入同一内容 → 查重跳过 ---------- */
    const r2 = await run(`return window.api.importFromUrls([${JSON.stringify(`${base}/again.png`)}])`)
    check('重复内容查重跳过 skipped=1', r2.skipped === 1 && r2.imported === 0, JSON.stringify({ imported: r2.imported, skipped: r2.skipped }))

    /* ---------- 3. 非法协议拒绝 ---------- */
    const r3 = await run(`return window.api.importFromUrls(['file:///C:/Windows/win.ini'])`)
    check('file:// 协议被拒', (r3.failedUrls || []).length === 1 && r3.imported === 0, JSON.stringify(r3.failedUrls))

    /* ---------- 4. 404 进失败清单 ---------- */
    const r4 = await run(`return window.api.importFromUrls([${JSON.stringify(`${base}/missing.png`)}])`)
    check('404 计入失败清单', (r4.failedUrls || []).length === 1 && /404/.test((r4.failedUrls || [])[0] || ''), JSON.stringify(r4.failedUrls))

    /* ---------- 5. 清理(软删) ---------- */
    if (assetId) {
      await run(`return window.api.deleteAssets([${JSON.stringify(assetId)}], false)`)
      const clean = await run(`return (async () => {
        const a = await window.api.getAsset(${JSON.stringify(assetId)})
        return { gone: !a || a.deleted_at !== null }
      })()`)
      check('测试素材软删除清理', clean.gone)
    } else {
      check('测试素材软删除清理', false, '无 assetId')
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`)
    ws.close()
    process.exit(fail ? 1 : 0)
  } finally {
    server.close()
  }
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
