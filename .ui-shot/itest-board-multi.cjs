/* 白板框选多选专项验证：框选/组移动/组缩放/组删除/Ctrl+A
   前置：npm run dev -- --remote-debugging-port=9333
   运行：node .ui-shot/itest-board-multi.cjs
   说明：新建独立测试白板「itest-多选」操作,结束时删除,不污染用户白板 */
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

  /* ---------- 0. 准备：清理旧测试白板 → 新建 → 重载页面刷新 store → 切换到测试白板 ---------- */
  await run(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name.startsWith('itest-多选')) await window.api.deleteBoard(b.id)
  })()`)
  const board = await run(`return window.api.createBoard('itest-多选-${Date.now()}')`)
  const boardId = board.id
  // createBoard 走 API 不会刷新 store 的 boards,重载页面让应用重新拉取（启动自动打开第一个白板）
  await run(`location.reload()`)
  let ready = false
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    // 就绪 = 应用已加载（白板默认关闭,需先点主导航「白板」进入）
    ready = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (ready) break
  }
  check('应用重载后就绪', ready, `boardId=${boardId}`)
  // 进入白板模式（viewMode 默认 off,白板面板不可见）
  await run(`(() => {
    const btn = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]')
    btn.click()
  })()`)
  await sleep(500)
  // 通过切换下拉触发 store 刷新（openBoard 会 refreshBoardItems + 重置视口）
  await run(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)

  /* ---------- 1. 加入 3 个元素（已知坐标） ---------- */
  await run(`await window.api.addBoardItem(${boardId}, { type: 'note', x: 100, y: 100, width: 120, height: 80, text: 'A' })`)
  await run(`await window.api.addBoardItem(${boardId}, { type: 'note', x: 280, y: 100, width: 120, height: 80, text: 'B' })`)
  await run(`await window.api.addBoardItem(${boardId}, { type: 'note', x: 100, y: 260, width: 120, height: 80, text: 'C' })`)
  // 重新打开白板刷新 store
  await run(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)
  const items1 = await run(`return window.api.listBoardItems(${boardId})`)
  check('测试白板 3 个元素就位', items1.length === 3, `${items1.length} items`)

  /* ---------- 2. 框选 A+B（覆盖 60,60 ~ 460,240 的矩形） ---------- */
  const frameExpr = `(() => {
    const first = document.querySelector('[data-board-item]')
    if (!first) return null
    let f = first.parentElement // surface
    return f ? f.parentElement : null // frame
  })()`
  const frameSel = await run(`return (${frameExpr}) !== null`)
  check('找到画布 frame 容器', frameSel, '')
  // 坐标换算：视口已重置 s=1,x=0,y=0,client = frameRect.left + board
  const marquee = await run(`
    const frame = ${frameExpr}
    const rect = frame.getBoundingClientRect()
    const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: rect.left + 60, clientY: rect.top + 60, button: 0, pointerId: 1, isPrimary: true })
    frame.dispatchEvent(down)
    const move = new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: rect.left + 460, clientY: rect.top + 240, button: 0, pointerId: 1, isPrimary: true })
    frame.dispatchEvent(move)
    const up = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: rect.left + 460, clientY: rect.top + 240, button: 0, pointerId: 1, isPrimary: true })
    frame.dispatchEvent(up)
    await new Promise((r) => setTimeout(r, 200))
    return {
      groupBox: !!document.querySelector('[data-group-box]'),
      selected: [...document.querySelectorAll('[data-board-item]')].filter((el) => el.style.outline.includes('var(--accent)')).length
    }
  `)
  check('框选后出现组包围盒(≥2 选中)', marquee.groupBox, `groupBox=${marquee.groupBox}`)

  /* ---------- 3. 组移动：拖动 A(+60,+40),B 应跟随 ---------- */
  const before = await run(`return window.api.listBoardItems(${boardId})`)
  const a = before.find((i) => i.text === 'A')
  const b = before.find((i) => i.text === 'B')
  const c = before.find((i) => i.text === 'C')
  const moved = await run(`
    const el = document.querySelector('[data-board-item]') // 元素顺序 = A 先
    const rect = el.getBoundingClientRect()
    const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: rect.left + 40, clientY: rect.top + 40, button: 0, pointerId: 2, isPrimary: true })
    el.dispatchEvent(down)
    const move = new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: rect.left + 100, clientY: rect.top + 80, button: 0, pointerId: 2, isPrimary: true })
    el.dispatchEvent(move)
    const up = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: rect.left + 100, clientY: rect.top + 80, button: 0, pointerId: 2, isPrimary: true })
    el.dispatchEvent(up)
    await new Promise((r) => setTimeout(r, 300))
    return window.api.listBoardItems(${boardId})
  `)
  const a2 = moved.find((i) => i.text === 'A')
  const b2 = moved.find((i) => i.text === 'B')
  const c2 = moved.find((i) => i.text === 'C')
  check('组移动 A+B 同步位移 +60/+40', a2.x === a.x + 60 && a2.y === a.y + 40 && b2.x === b.x + 60 && b2.y === b.y + 40,
    `A ${a.x},${a.y}→${a2.x},${a2.y}; B ${b.x},${b.y}→${b2.x},${b2.y}`)
  check('组外元素 C 不动', c2.x === c.x && c2.y === c.y, `C ${c.x},${c.y}→${c2.x},${c2.y}`)

  /* ---------- 4. 组缩放：拖 SE 手柄 (+100,+50) ---------- */
  const resized = await run(`
    // 重新框选 A+B（移动后坐标已变,按元素边框重新计算：框住 A 与 B 的并集外扩）
    const frame = ${frameExpr}
    const fr = frame.getBoundingClientRect()
    const items = await window.api.listBoardItems(${boardId})
    const sel = items.filter((i) => i.text === 'A' || i.text === 'B')
    const minX = Math.min(...sel.map((i) => i.x)) - 20
    const minY = Math.min(...sel.map((i) => i.y)) - 20
    const maxX = Math.max(...sel.map((i) => i.x + i.width)) + 20
    const maxY = Math.max(...sel.map((i) => i.y + i.height)) + 20
    frame.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: fr.left + minX, clientY: fr.top + minY, button: 0, pointerId: 3, isPrimary: true }))
    frame.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: fr.left + maxX, clientY: fr.top + maxY, button: 0, pointerId: 3, isPrimary: true }))
    frame.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: fr.left + maxX, clientY: fr.top + maxY, button: 0, pointerId: 3, isPrimary: true }))
    await new Promise((r) => setTimeout(r, 200))
    const gb = document.querySelector('[data-group-box]')
    const se = document.querySelector('[data-group-handle="se"]')
    if (!gb || !se) return { ok: false, reason: 'no group box' }
    const br = gb.getBoundingClientRect()
    se.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: br.left + br.width, clientY: br.top + br.height, button: 0, pointerId: 4, isPrimary: true }))
    se.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: br.left + br.width + 100, clientY: br.top + br.height + 50, button: 0, pointerId: 4, isPrimary: true }))
    se.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: br.left + br.width + 100, clientY: br.top + br.height + 50, button: 0, pointerId: 4, isPrimary: true }))
    await new Promise((r) => setTimeout(r, 300))
    return window.api.listBoardItems(${boardId})
  `)
  const a3 = resized.find((i) => i.text === 'A')
  const b3 = resized.find((i) => i.text === 'B')
  check('组缩放后 A/B 尺寸变大(等比)', a3.width > a.width && b3.width > b.width && a3.height > a.height,
    `A ${a.width}x${a.height}→${a3.width}x${a3.height}; B ${b.width}x${b.height}→${b3.width}x${b3.height}`)

  /* ---------- 5. Delete 删除选中组 ---------- */
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))`)
  await sleep(300)
  const afterDel = await run(`return window.api.listBoardItems(${boardId})`)
  check('Delete 删除选中组(A+B 没了,C 还在)', !afterDel.some((i) => i.text === 'A') && !afterDel.some((i) => i.text === 'B') && afterDel.some((i) => i.text === 'C'),
    `剩余 ${afterDel.length} 项`)

  /* ---------- 6. Ctrl+A 全选 → 组包围盒 ---------- */
  // Delete 后只剩 C,补一个 D 凑成多选
  await run(`await window.api.addBoardItem(${boardId}, { type: 'note', x: 400, y: 300, width: 120, height: 80, text: 'D' })`)
  await run(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(300)
  const ctrlA = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 150))
    return !!document.querySelector('[data-group-box]')
  `)
  check('Ctrl+A 全选出现组包围盒', ctrlA, '')

  /* ---------- 清理：删除测试白板 ---------- */
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
