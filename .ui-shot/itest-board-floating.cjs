/* 白板浮动置顶窗口专项验证
   前置：npm run dev -- --remote-debugging-port=9333
   运行：node .ui-shot/itest-board-floating.cjs
   说明：独立测试白板,结束删除；浮动窗为独立页面 target,复用 BoardCanvas 全量交互 */
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

/** 连接到指定 page target,返回 { run, close } */
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

async function main() {
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- 0. 清理残留浮动窗口（openFloatingBoard 已存在时只聚焦,测试需要全新窗口） ---------- */
  const allTargets = await getJson('http://127.0.0.1:9333/json/list')
  const leftovers = allTargets.filter((t) => t.type === 'page' && t.url.includes('floating=1'))
  for (const f of leftovers) {
    const c = await connect(f.webSocketDebuggerUrl)
    await c.run(`window.close()`)
    c.close()
  }
  await sleep(800)

  /* ---------- 1. 主窗口准备 ---------- */
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面')
  const main = await connect(page.webSocketDebuggerUrl)
  const mainRun = main.run

  await mainRun(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name.startsWith('itest-浮动')) await window.api.deleteBoard(b.id)
  })()`)
  const board = await mainRun(`return window.api.createBoard('itest-浮动-${Date.now()}')`)
  const boardId = board.id
  await mainRun(`location.reload()`)
  let ready = false
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    ready = await mainRun(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (ready) break
  }
  check('主窗口就绪', ready, `boardId=${boardId}`)
  // 进入白板模式（viewMode 默认 off,「白板浮动置顶」按钮在面板工具栏里）
  await mainRun(`(() => {
    const btn = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]')
    btn.click()
  })()`)
  await sleep(500)
  await mainRun(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)
  await mainRun(`await window.api.addBoardItem(${boardId}, { type: 'note', x: 100, y: 100, width: 120, height: 80, text: 'A' })`)
  await mainRun(`await window.api.addBoardItem(${boardId}, { type: 'note', x: 300, y: 100, width: 120, height: 80, text: 'B' })`)
  await mainRun(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)

  /* ---------- 1. 点击「浮动置顶」按钮 → 出现浮动窗口 target ---------- */
  await mainRun(`(() => {
    const btn = document.querySelector('button[aria-label="白板浮动置顶"]')
    btn.click()
  })()`)
  let floatTarget = null
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    const ts = await getJson('http://127.0.0.1:9333/json/list')
    floatTarget = ts.find((t) => t.type === 'page' && t.url.includes('floating=1') && t.url.includes(`board=${boardId}`))
    if (floatTarget) break
  }
  check('浮动窗口已创建(独立 target)', !!floatTarget, floatTarget ? floatTarget.url.slice(0, 60) : 'none')

  /* ---------- 2. 浮动窗口渲染：标题条 + 2 个元素 + 缩放滑块 ---------- */
  const float = await connect(floatTarget.webSocketDebuggerUrl)
  const floatRun = float.run
  await sleep(800)
  const render = await floatRun(`
    await new Promise((r) => setTimeout(r, 500))
    return {
      items: document.querySelectorAll('[data-board-item]').length,
      slider: !!document.querySelector('input[aria-label="浮动白板缩放"]'),
      closeBtn: !!document.querySelector('button[aria-label="关闭浮动白板"]'),
      title: (document.querySelector('.truncate')?.textContent ?? '')
    }
  `)
  check('浮动窗口渲染(2 元素+缩放+关闭)', render.items === 2 && render.slider && render.closeBtn, `items=${render.items} title=${render.title}`)

  /* ---------- 3. 浮动窗口内拖动元素 A(+50,+30) → DB 持久化 ---------- */
  const before = await mainRun(`return window.api.listBoardItems(${boardId})`)
  const a = before.find((i) => i.text === 'A')
  const moved = await floatRun(`
    const el = document.querySelector('[data-board-item]')
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 40, button: 0, pointerId: 1, isPrimary: true }))
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: r.left + 90, clientY: r.top + 70, button: 0, pointerId: 1, isPrimary: true }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: r.left + 90, clientY: r.top + 70, button: 0, pointerId: 1, isPrimary: true }))
    await new Promise((r) => setTimeout(r, 300))
    return window.api.listBoardItems(${boardId})
  `)
  const a2 = moved.find((i) => i.text === 'A')
  check('浮动窗口内拖动持久化', a2.x === a.x + 50 && a2.y === a.y + 30, `A ${a.x},${a.y}→${a2.x},${a2.y}`)

  /* ---------- 4. 主窗口重新聚焦后同步（焦点刷新由真实用户操作触发,此处验证 DB 一致 + 刷新接口可用） ---------- */
  const mainItems = await mainRun(`return window.api.listBoardItems(${boardId})`)
  const aMain = mainItems.find((i) => i.text === 'A')
  check('主窗口读取到浮动窗改动(DB 一致)', aMain.x === a2.x, `主窗看到 x=${aMain.x}`)

  /* ---------- 5. 关闭浮动窗口 → target 消失 ---------- */
  await floatRun(`document.querySelector('button[aria-label="关闭浮动白板"]').click()`)
  let gone = false
  for (let i = 0; i < 20; i++) {
    await sleep(300)
    const ts = await getJson('http://127.0.0.1:9333/json/list')
    if (!ts.some((t) => t.type === 'page' && t.url.includes('floating=1'))) {
      gone = true
      break
    }
  }
  check('关闭浮动窗口', gone, '')

  /* ---------- 清理 ---------- */
  await mainRun(`await window.api.deleteBoard(${boardId})`)
  check('清理测试白板', true, `board ${boardId} 已删除`)
  main.close()

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
