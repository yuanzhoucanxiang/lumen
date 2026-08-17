/* 阶段 5 专项验证(watcher 批量合并 + clipServer 413):
   ① CDP:临时监控目录批量落 3 张图 -> 断言仅收到 1 次 clip:imported(批量合并生效)
     且库统计 +3(真实导入);结束后恢复原 watchDirs 配置并清理临时目录。
   ② node http:直连剪藏服务 POST >80MB body(带鉴权头) -> 断言收到 413
     而非连接重置;再发一个非法 1 字节 body 断言 400 正常。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-stage5.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const os = require('os')
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

/** node 直发 HTTP(绕开 CORS,直接验证剪藏服务状态码) */
function rawPost(port, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/clip', method: 'POST', agent: false, headers: { 'Content-Length': Buffer.byteLength(body), ...headers } }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function main() {
  const CLIP_PORT = 45678
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- 1. clipServer 413:80MB 上限 ---------- */
  const big = 'x'.repeat(81 * 1024 * 1024)
  const r413 = await rawPost(CLIP_PORT, big, { 'x-lumen-client': 'lumen-clip/1', 'content-type': 'application/json' })
  check('超限 body 返回 413(而非连接重置)', r413.status === 413, `status=${r413.status} body=${r413.body.slice(0, 60)}`)
  const rBad = await rawPost(CLIP_PORT, 'this is not json at all', { 'x-lumen-client': 'lumen-clip/1', 'content-type': 'application/json' })
  check('非法小 body 仍走 400(服务未因 413 挂掉)', rBad.status === 400, `status=${rBad.status} body=${rBad.body.slice(0, 60)}`)

  /* ---------- 2. CDP:watcher 批量合并 ---------- */
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
  const evalJs = (expression) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)))
      ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
  const run = async (expr) => {
    const r = await evalJs(`(async () => { ${expr} })()`)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }

  // 唯一前缀:历史测试垃圾已入过库的同名文件会被查重正确跳过,导致断言失真
  const tag = 'st5-' + Date.now().toString(36)
  const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-watch-'))
  const before = await run(`return { stats: await window.api.getLibraryStats(), cfg: await window.api.getSettings() }`)
  // 渲染层注册事件计数器(剪藏导入通知 = watcher notify 通道)
  await run(`(() => { window.__itestClipEvents = 0; window.api.onClipImported(() => window.__itestClipEvents++) })()`)
  // 设置临时监控目录(替换全部 watchDirs,结束恢复)
  await run(`window.api.updateSettings({ watchDirs: [${JSON.stringify(watchDir)}] })`)
  // Windows fs.watch 注册后的短暂窗口可能漏事件,给足时间再写文件
  await sleep(1800)
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(watchDir, `${tag}-${i}.png`), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i, i + 1, i + 2]))
  await sleep(4000)
  const after = await run(`return { stats: await window.api.getLibraryStats(), events: window.__itestClipEvents }`)
  const delta = after.stats.total - before.stats.total
  check('3 张图批量落库(统计 +3)', delta === 3, `before=${before.stats.total} after=${after.stats.total}`)
  // 清理本测试导入的素材(软删除,不留垃圾)
  await run(`(async () => {
    const all = await window.api.queryAssets({ limit: 5000 })
    const ids = all.filter((a) => a.name.startsWith(${JSON.stringify(tag + '-')})).map((a) => a.id)
    if (ids.length > 0) await window.api.deleteAssets(ids, false)
  })()`)
  check('仅 1 次导入通知(500ms 窗口批量合并生效)', after.events === 1, `events=${after.events}`)
  // 恢复原配置 + 清理
  await run(`window.api.updateSettings({ watchDirs: ${JSON.stringify(before.cfg.watchDirs)} })`)
  fs.rmSync(watchDir, { recursive: true, force: true })
  await sleep(500)
  const restored = await run(`return (await window.api.getSettings()).watchDirs.length`)
  check('原 watchDirs 配置已恢复', restored === before.cfg.watchDirs.length, `restored=${restored}`)

  console.log('')
  console.log(pass + ' PASS / ' + fail + ' FAIL')
  ws.close()
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
