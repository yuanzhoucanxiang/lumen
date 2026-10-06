/* 区域截图 验证(裁剪管线 + 真实捕获链路):
   ① 纯裁剪管线:commit 直传合成整屏 dataUrl(source 参数,无头 CI 也可跑),dpr=1 / dpr=2
      两种缩放下断言入库素材尺寸 = rect×dpr;
   ② 真实捕获链路:screenshot:start(隐藏主窗捕获真屏)→ commit 不带 dpr(用会话 dpr)→
      尺寸 = rect×devicePixelRatio;本地有显示器的环境才执行(CI 冒烟不跑本文件);
   ③ cancel 幂等;④ 测试素材软删除清理,不污染用户库。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-screenshot.cjs */
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
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating') && !t.url.includes('screenshot'))
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

  /* ---------- 0. 就绪 + 清理上轮残留 ---------- */
  let ready = false
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    ready = await run(`return !!document.querySelector('.archive-shell')`)
    if (ready) break
  }
  check('主界面就绪', ready)

  const cleanupByPrefix = async () => {
    const ids = await run(`return (async () => {
      const all = await window.api.queryAssets({ keyword: 'screenshot_', limit: 200 })
      return (all || []).filter((a) => a.name.startsWith('screenshot_')).map((a) => a.id)
    })()`)
    if ((ids || []).length > 0) await run(`return window.api.deleteAssets(${JSON.stringify(ids)}, true)`)
    return (ids || []).length
  }
  const stale = await cleanupByPrefix()
  if (stale > 0) console.log('  (清理上轮残留', stale, '条)')

  /* ---------- 1. 纯裁剪管线:合成整屏图直传 source ---------- */
  const png = fs.readFileSync(path.join(__dirname, '..', 'test-fixtures', 'sample.png'))
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const srcDim = await run(`return (async () => {
    const img = new Image(); img.src = ${JSON.stringify(dataUrl)}
    await img.decode()
    return { w: img.naturalWidth, h: img.naturalHeight }
  })()`)
  check('合成整屏图可解码', srcDim.w >= 120 && srcDim.h >= 80, JSON.stringify(srcDim))

  // dpr=1:rect 原样裁剪
  const r1 = await run(`return window.api.screenshotCommit({ x: 10, y: 10, width: 100, height: 60 }, 1, ${JSON.stringify(dataUrl)})`)
  const a1 = (r1.importedIds || [])[0] ? await run(`return (async () => window.api.getAsset(${JSON.stringify((r1.importedIds || [])[0])}))()`) : null
  check('dpr=1 裁剪入库尺寸=rect', r1.imported === 1 && a1?.width === 100 && a1?.height === 60, JSON.stringify({ imported: r1.imported, w: a1?.width, h: a1?.height }))

  // dpr=2:逻辑像素×2 → 物理像素
  const r2 = await run(`return window.api.screenshotCommit({ x: 0, y: 0, width: 50, height: 40 }, 2, ${JSON.stringify(dataUrl)})`)
  const a2 = (r2.importedIds || [])[0] ? await run(`return (async () => window.api.getAsset(${JSON.stringify((r2.importedIds || [])[0])}))()`) : null
  check('dpr=2 裁剪尺寸=rect×2', r2.imported === 1 && a2?.width === 100 && a2?.height === 80, JSON.stringify({ imported: r2.imported, w: a2?.width, h: a2?.height }))

  // sourceUrl 来源落库
  check('sourceUrl=屏幕截图 落库', a1?.url === '屏幕截图', a1?.url)

  /* ---------- 2. 真实捕获链路(本地有显示器环境) ---------- */
  let started = false
  try {
    started = await run(`return window.api.screenshotStart()`)
  } catch {
    console.log('  (捕获不可用,跳过真实链路用例)')
  }
  if (started) {
    const dpr = await run(`return window.devicePixelRatio`)
    const r3 = await run(`return window.api.screenshotCommit({ x: 10, y: 10, width: 120, height: 90 })`)
    const a3 = (r3.importedIds || [])[0] ? await run(`return (async () => window.api.getAsset(${JSON.stringify((r3.importedIds || [])[0])}))()`) : null
    // 整数缩放下捕获分辨率=逻辑×scaleFactor,可精确断言;
    // Windows 自定义分数缩放(如 273%)下 desktopCapturer 返回原生分辨率,捕获 scale ≠ devicePixelRatio,
    // 而裁剪 scale 以实际捕获图为准(captureDisplay: size.width/display.size.width),此时按宽高比+下限断言
    const exact = a3?.width === Math.round(120 * dpr) && a3?.height === Math.round(90 * dpr)
    const fracOk = Math.abs((a3?.width ?? 0) / (a3?.height ?? 1) - 120 / 90) < 0.02 && a3?.width >= 120 && a3?.height >= 90
    check(
      '真实捕获尺寸=rect×captureScale',
      r3.imported === 1 && (exact || fracOk),
      JSON.stringify({ dpr, imported: r3.imported, w: a3?.width, h: a3?.height, mode: exact ? 'exact' : 'fractional-dpi' })
    )
  } else {
    console.log('  (screenshot:start 未启动,跳过真实链路用例)')
  }

  /* ---------- 3. cancel 幂等(无会话调用不报错) ---------- */
  let cancelOk = false
  try {
    await run(`return window.api.screenshotCancel()`)
    cancelOk = true
  } catch {
    cancelOk = false
  }
  check('cancel 无会话幂等', cancelOk)

  /* ---------- 4. 清理 ---------- */
  const cleaned = await cleanupByPrefix()
  check('测试素材软删除清理', cleaned >= 2, `cleaned=${cleaned}`)

  ws.close()
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
