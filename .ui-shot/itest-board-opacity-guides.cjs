/* 白板透明度 + 参考线专项验证
   前置：npm run dev -- --remote-debugging-port=9333
   运行：node .ui-shot/itest-board-opacity-guides.cjs
   说明：独立测试白板,结束删除,不污染用户白板 */
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

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) throw new Error('找不到渲染进程页面（先启动 dev）')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
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

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  /* ---------- 0. 准备 ---------- */
  await run(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name.startsWith('itest-透明')) await window.api.deleteBoard(b.id)
  })()`)
  const board = await run(`return window.api.createBoard('itest-透明-${Date.now()}')`)
  const boardId = board.id
  await run(`location.reload()`)
  let ready = false
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    ready = await run(`return (() => {
      const sel = document.querySelector('select[aria-label="切换白板"]')
      return !!sel && [...sel.options].some((o) => o.value === '${boardId}')
    })()`)
    if (ready) break
  }
  check('白板工具栏就绪', ready, `boardId=${boardId}`)
  await run(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)

  /* ---------- 1. 加入 2 个元素 ---------- */
  await run(`await window.api.addBoardItem(${boardId}, { type: 'note', x: 100, y: 100, width: 120, height: 80, text: 'A' })`)
  await run(`await window.api.addBoardItem(${boardId}, { type: 'note', x: 300, y: 100, width: 120, height: 80, text: 'B' })`)
  await run(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)

  /* ---------- 2. 透明度：右键 A → 点 50% 预设 ---------- */
  const op1 = await run(`
    const el = document.querySelector('[data-board-item]')
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 30 }))
    await new Promise((res) => setTimeout(res, 150))
    const btn = document.querySelector('button[aria-label="透明度 50%"]')
    if (!btn) return { ok: false, reason: 'no opacity btn' }
    btn.click()
    await new Promise((res) => setTimeout(res, 300))
    const list = await window.api.listBoardItems(${boardId})
    const a = list.find((i) => i.text === 'A')
    return { ok: true, opacity: a.opacity }
  `)
  check('右键预设 透明度 50% 生效', op1.ok && op1.opacity === 50, `A opacity=${op1.opacity}`)

  /* ---------- 3. 透明度：滑块拖到 75 ---------- */
  const op2 = await run(`
    const slider = document.querySelector('input[aria-label="透明度滑块"]')
    if (!slider) return { ok: false, reason: 'no slider' }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(slider, '75')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((res) => setTimeout(res, 300))
    const list = await window.api.listBoardItems(${boardId})
    return { ok: true, opacity: list.find((i) => i.text === 'A').opacity }
  `)
  check('透明度滑块 75% 生效', op2.ok && op2.opacity === 75, `A opacity=${op2.opacity}`)

  /* ---------- 4. 多选批量：框选 A+B → 右键 A → 25% ---------- */
  const op3 = await run(`
    const frame = (() => {
      const first = document.querySelector('[data-board-item]')
      let f = first.parentElement
      return f.parentElement
    })()
    const fr = frame.getBoundingClientRect()
    frame.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: fr.left + 60, clientY: fr.top + 60, button: 0, pointerId: 1, isPrimary: true }))
    frame.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: fr.left + 480, clientY: fr.top + 220, button: 0, pointerId: 1, isPrimary: true }))
    frame.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: fr.left + 480, clientY: fr.top + 220, button: 0, pointerId: 1, isPrimary: true }))
    await new Promise((res) => setTimeout(res, 200))
    const el = document.querySelector('[data-board-item]')
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 30 }))
    await new Promise((res) => setTimeout(res, 150))
    const btn = document.querySelector('button[aria-label="透明度 25%"]')
    if (!btn) return { ok: false, reason: 'no 25% btn' }
    btn.click()
    await new Promise((res) => setTimeout(res, 300))
    const list = await window.api.listBoardItems(${boardId})
    return { ok: true, a: list.find((i) => i.text === 'A').opacity, b: list.find((i) => i.text === 'B').opacity }
  `)
  check('多选批量透明度 25% 同时生效', op3.ok && op3.a === 25 && op3.b === 25, `A=${op3.a} B=${op3.b}`)

  /* ---------- 5. 参考线：空白右键 → 添加水平+垂直 ---------- */
  const g1 = await run(`
    const frame = (() => {
      const first = document.querySelector('[data-board-item]')
      let f = first.parentElement
      return f.parentElement
    })()
    const fr = frame.getBoundingClientRect()
    // 右键空白处（远离元素）
    frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: fr.left + 700, clientY: fr.top + 500 }))
    await new Promise((res) => setTimeout(res, 150))
    const btns = [...document.querySelectorAll('.menu button')]
    const hBtn = btns.find((b) => b.textContent.includes('添加水平参考线'))
    if (!hBtn) return { ok: false, reason: 'no horizontal btn' }
    hBtn.click()
    await new Promise((res) => setTimeout(res, 250))
    frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: fr.left + 700, clientY: fr.top + 500 }))
    await new Promise((res) => setTimeout(res, 150))
    const vBtn = [...document.querySelectorAll('.menu button')].find((b) => b.textContent.includes('添加垂直参考线'))
    if (!vBtn) return { ok: false, reason: 'no vertical btn' }
    vBtn.click()
    await new Promise((res) => setTimeout(res, 250))
    const domH = !!document.querySelector('[data-guide="h"]')
    const domV = !!document.querySelector('[data-guide="v"]')
    const bs = await window.api.listBoards()
    const guides = JSON.parse(bs.find((b) => b.id === ${boardId}).guides)
    return { ok: true, domH, domV, count: guides.length, types: guides.map((g) => (g.horizontal ? 'h' : 'v')) }
  `)
  check('添加水平+垂直参考线', g1.ok && g1.domH && g1.domV && g1.count === 2, `DOM h=${g1.domH} v=${g1.domV} db=${g1.types.join(',')}`)

  /* ---------- 6. 拖动水平参考线 (+100,+50) ---------- */
  const g2 = await run(`
    const el = document.querySelector('[data-guide="h"]')
    if (!el) return { ok: false, reason: 'no h guide' }
    const r = el.getBoundingClientRect()
    const before = JSON.parse((await window.api.listBoards()).find((b) => b.id === ${boardId}).guides)
    const origY = before.find((g) => g.horizontal).y
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top, button: 0, pointerId: 2, isPrimary: true }))
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: r.left + 300, clientY: r.top + 50, button: 0, pointerId: 2, isPrimary: true }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: r.left + 300, clientY: r.top + 50, button: 0, pointerId: 2, isPrimary: true }))
    await new Promise((res) => setTimeout(res, 300))
    const after = JSON.parse((await window.api.listBoards()).find((b) => b.id === ${boardId}).guides)
    const newY = after.find((g) => g.horizontal).y
    return { ok: true, origY, newY }
  `)
  check('水平参考线拖动持久化', g2.ok && g2.newY === g2.origY + 50, `y ${g2.origY}→${g2.newY}`)

  /* ---------- 7. 右键参考线 → 删除 ---------- */
  const g3 = await run(`
    const el = document.querySelector('[data-guide="h"]')
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top }))
    await new Promise((res) => setTimeout(res, 150))
    const del = [...document.querySelectorAll('.menu button')].find((b) => b.textContent.includes('删除参考线'))
    if (!del) return { ok: false, reason: 'no delete btn' }
    del.click()
    await new Promise((res) => setTimeout(res, 300))
    const guides = JSON.parse((await window.api.listBoards()).find((b) => b.id === ${boardId}).guides)
    return { ok: true, count: guides.length, domH: !!document.querySelector('[data-guide="h"]') }
  `)
  check('删除参考线', g3.ok && g3.count === 1 && !g3.domH, `剩余 ${g3.count} 条`)

  /* ---------- 清理 ---------- */
  await run(`await window.api.deleteBoard(${boardId})`)
  check('清理测试白板', true, `board ${boardId} 已删除`)

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
