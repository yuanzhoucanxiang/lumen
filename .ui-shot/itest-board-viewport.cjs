/* 白板视口持久化专项验证（里程碑 115）
   前置：npm run dev -- --remote-debugging-port=9333
   验证：缩放/平移落库(boards.viewport) → 切板再切回,恢复与上次完全一致的缩放与位置。
   独立测试白板,结束删除。 */
const WebSocket = require('ws')
const http = require('http')

function getJson(url) {
  return new Promise((res, rej) =>
    http.get(url, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => res(JSON.parse(d)))
    }).on('error', rej)
  )
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false })
  await new Promise((r, j) => {
    ws.on('open', r)
    ws.on('error', j)
  })
  let id = 0
  const pending = new Map()
  ws.on('message', (m) => {
    const msg = JSON.parse(m.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const evalJs = (expression) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, (msg) => {
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      })
      ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
  const run = async (expr) => {
    const r = await evalJs(`(async () => { ${expr} })()`)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }
  return { run, close: () => ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 读取画布 surface 的 transform(缩放+平移) */
const SURFACE = `document.querySelector('[data-board-frame] div.absolute.left-0.top-0')?.style.transform ?? ''`

async function main() {
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- 0. 主窗口准备 ---------- */
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面')
  const main = await connect(page.webSocketDebuggerUrl)
  const mainRun = main.run

  const prefix = `itest-视口-${Date.now()}`
  await mainRun(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name.startsWith('itest-视口-')) await window.api.deleteBoard(b.id)
  })()`)
  const boardA = await mainRun(`return window.api.createBoard('${prefix}-A')`)
  const boardB = await mainRun(`return window.api.createBoard('${prefix}-B')`)
  const [aId, bId] = [boardA.id, boardB.id]

  /* ---------- 1. 进入白板模式,选中 A,放一个元素 ---------- */
  await mainRun(`location.reload()`)
  let ready = false
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    ready = await mainRun(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (ready) break
  }
  check('主窗口就绪', ready, `A=${aId} B=${bId}`)
  await mainRun(`(() => {
    const btn = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]')
    btn.click()
  })()`)
  await sleep(500)
  const selectBoard = (id) => `(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${id}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`
  await mainRun(selectBoard(aId))
  await sleep(600)
  await mainRun(`await window.api.addBoardItem(${aId}, { type: 'note', x: 200, y: 200, width: 160, height: 80, text: '锚点' })`)
  await sleep(400)

  /* ---------- 2. 新板首次进入:默认视口(无保存) ---------- */
  const initT = await mainRun(`return ${SURFACE}`)
  check('新板首次进入默认视口(scale(1))', initT.includes('scale(1)') && initT.includes('translate3d(0px, 0px'), initT)

  /* ---------- 3. 缩放后落库 ---------- */
  await mainRun(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))`)
  await sleep(900) // 防抖 600ms
  const tZoom = await mainRun(`return ${SURFACE}`)
  const saved = await mainRun(`return (async () => {
    const bs = await window.api.listBoards()
    return (bs.find((x) => x.id === ${aId}) ?? {}).viewport ?? ''
  })()`)
  let parsed = null
  try {
    parsed = JSON.parse(saved)
  } catch {
    parsed = null
  }
  check('缩放后视口落库(s≈1.25)', parsed && parsed.s > 1.2 && parsed.s < 1.3, JSON.stringify(parsed))

  /* ---------- 4. 空格平移画布后,切到 B 再切回 A:恢复与上次完全一致 ---------- */
  await mainRun(`(() => {
    const frame = document.querySelector('[data-board-frame]')
    const rect = frame.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
    frame.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 99, isPrimary: true }))
    frame.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: cx + 120, clientY: cy + 80, button: 0, buttons: 1, pointerId: 99, isPrimary: true }))
    frame.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx + 120, clientY: cy + 80, button: 0, buttons: 0, pointerId: 99, isPrimary: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }))
  })()`)
  await sleep(900)
  const tBefore = await mainRun(`return ${SURFACE}`)
  check('平移改变了视口(缩放基础上位移)', tBefore !== tZoom, `${tZoom} → ${tBefore}`)

  await mainRun(selectBoard(bId))
  await sleep(600)
  const tB = await mainRun(`return ${SURFACE}`)
  check('切到 B 重置为默认视口(B 无保存)', tB.includes('scale(1)'), tB)

  await mainRun(selectBoard(aId))
  await sleep(800)
  const tAfter = await mainRun(`return ${SURFACE}`)
  check('切回 A 恢复上次视口(缩放+位置逐像素一致)', tAfter === tBefore, `${tBefore} → ${tAfter}`)

  /* ---------- 清理 ---------- */
  await mainRun(`(async () => { await window.api.deleteBoard(${aId}); await window.api.deleteBoard(${bId}) })()`)
  check('清理测试白板', true, `A=${aId} B=${bId} 已删除`)
  main.close()

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
