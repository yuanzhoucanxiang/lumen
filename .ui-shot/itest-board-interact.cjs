/* 白板交互基本盘补齐的专项验证(里程碑 146-147):
   ①多选对齐六向(UserGuide 早已写「多选后可对齐」而代码里没有,这里把它做成真的);
   ②拖动智能吸附 + Alt 临时关闭;③Shift 等比缩放;
   ④锁定:不可拖动/不可删除/可解锁;⑤成组:点一个选一组、拖动整组一起动;
   ⑥图层置顶/置底;⑦滚轮缩放合帧后仍生效 + 双击空白 fit + 1:1 复位按钮。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-board-interact.cjs */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面')
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
  const evalJs = (expression) =>
    new Promise((resolve, reject) => {
      const mid = ++msgId
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
    console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
    ok ? pass++ : fail++
  }

  /* ---------- 0. 建测试白板并进入 ---------- */
  await run(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name.startsWith('itest-交互')) await window.api.deleteBoard(b.id)
  })()`)
  const board = await run(`return window.api.createBoard('itest-交互-${Date.now()}')`)
  const boardId = board.id
  await run(`location.reload()`)
  let ready = false
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    ready = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`).catch(() => false)
    if (ready) break
  }
  check('应用重载后就绪', ready, `boardId=${boardId}`)
  let boardBtn = false
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    boardBtn = await run(`return !!document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]')`).catch(() => false)
    if (boardBtn) break
  }
  await run(`document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]').click()`)
  let boardSel = false
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    boardSel = await run(`return !!document.querySelector('select[aria-label="切换白板"]')`).catch(() => false)
    if (boardSel) break
  }
  const openBoard = async () => {
    await run(`(() => { const s = document.querySelector('select[aria-label="切换白板"]'); s.value = ${boardId}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await sleep(450)
  }
  check('白板切换下拉就绪', boardSel, '')
  await openBoard()

  /* ---------- 1. 四个已知坐标的元素 ---------- */
  const LAYOUT = [
    { text: 'A', x: 100, y: 100, w: 120, h: 80 },
    { text: 'B', x: 300, y: 140, w: 120, h: 80 },
    { text: 'C', x: 520, y: 300, w: 120, h: 80 },
    { text: 'D', x: 700, y: 500, w: 120, h: 80 }
  ]
  await run(`await window.api.addBoardItems(${boardId}, ${JSON.stringify(LAYOUT.map((l) => ({ type: 'note', x: l.x, y: l.y, width: l.w, height: l.h, text: l.text })))})`)
  await openBoard()
  const items0 = await run(`return window.api.listBoardItems(${boardId})`)
  check('测试白板 4 个元素就位', items0.length === 4, `${items0.length} items`)
  const byText = Object.fromEntries(items0.map((i) => [i.text, i]))

  /* 通用:单选某个元素后拖动它(合成 pointer 事件链)。
     必须先 Escape 清掉残留选中——否则 pointerdown 会走「组拖动」把四个元素一起移动,
     整组一起动时不存在外部吸附对象,吸附用例就测不出东西。 */
  const dragItem = async (id, dx, dy, mods = {}) =>
    run(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise((r) => setTimeout(r, 150))
      const target = document.querySelector('[data-board-item="${id}"]')
      if (!target) return { err: '元素未渲染' }
      target.click()
      await new Promise((r) => setTimeout(r, 200))
      const el = document.querySelector('[data-board-item="${id}"]')
      const r = el.getBoundingClientRect()
      const px = r.left + r.width / 2
      const py = r.top + r.height / 2
      const mk = (type, x, y, extra) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7, isPrimary: true, ...extra }))
      mk('pointerdown', px, py, {})
      mk('pointermove', px + ${dx}, py + ${dy}, ${JSON.stringify(mods)})
      mk('pointerup', px + ${dx}, py + ${dy}, ${JSON.stringify(mods)})
      await new Promise((r2) => setTimeout(r2, 350))
      const list = await window.api.listBoardItems(${boardId})
      const it = list.find((i) => i.id === "${id}")
      return { x: it.x, y: it.y, width: it.width, height: it.height }
    `)
  const resetAll = async () => {
    const updates = items0.map((i) => {
      const l = LAYOUT.find((x) => x.text === i.text)
      return { id: i.id, patch: { locked: false, groupId: '', x: l.x, y: l.y, width: l.w, height: l.h } }
    })
    await run(`await window.api.updateBoardItems(${JSON.stringify(updates)})`)
    await openBoard()
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(150)
  }

  /* ---------- ① 多选对齐(UserGuide 承诺过、此前代码里没有) ---------- */
  await resetAll()
  const aligned = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 250))
    const first = document.querySelector('[data-board-item]')
    first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 260, clientY: 260 }))
    await new Promise((r) => setTimeout(r, 250))
    const btn = [...document.querySelectorAll('button[aria-label="左对齐"]')]
    if (btn.length === 0) return { err: '右键菜单里没有对齐项', labels: [...document.querySelectorAll('[role="menu"] button, .menu button')].map((b) => b.getAttribute('aria-label')) }
    btn[0].click()
    await new Promise((r) => setTimeout(r, 450))
    const list = await window.api.listBoardItems(${boardId})
    return { xs: list.map((i) => i.x) }
  `)
  check('多选左对齐后四个元素 x 相同', Array.isArray(aligned.xs) && aligned.xs.every((x) => x === aligned.xs[0]), JSON.stringify(aligned))
  const alignedTop = await run(`
    const first = document.querySelector('[data-board-item]')
    first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 260, clientY: 260 }))
    await new Promise((r) => setTimeout(r, 250))
    const btn = [...document.querySelectorAll('button[aria-label="顶对齐"]')]
    if (btn.length === 0) return { err: '没有顶对齐项' }
    btn[0].click()
    await new Promise((r) => setTimeout(r, 450))
    const list = await window.api.listBoardItems(${boardId})
    return { ys: list.map((i) => i.y) }
  `)
  check('多选顶对齐后四个元素 y 相同', Array.isArray(alignedTop.ys) && alignedTop.ys.every((y) => y === alignedTop.ys[0]), JSON.stringify(alignedTop))
  await resetAll()

  /* ---------- ② 智能吸附与 Alt 关闭 ---------- */
  await resetAll()
  const altDrag = await dragItem(byText.D.id, -597, 0, { altKey: true })
  check('Alt 拖动临时关闭吸附(落回原始位移)', altDrag.x === 103, JSON.stringify(altDrag))
  const snapDrag = await dragItem(byText.D.id, 2, 0)
  check('拖动左边缘吸附到 A 的左边缘(105 吸成 100)', snapDrag.x === 100, JSON.stringify(snapDrag))
  const snapLine = await run(`return [...document.querySelectorAll('[data-snap-line]')].filter((e) => e.style.display !== 'none').length`)
  check('松手后吸附线已隐藏', snapLine === 0, `visible=${snapLine}`)

  /* ---------- ④ Shift 等比缩放 ---------- */
  await resetAll()
  const ratio = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 150))
    const a = document.querySelector('[data-board-item="${byText.A.id}"]')
    const g0 = a.getBoundingClientRect()
    a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: g0.left + 20, clientY: g0.top + 20, button: 0, pointerId: 6, isPrimary: true }))
    a.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: g0.left + 20, clientY: g0.top + 20, button: 0, pointerId: 6, isPrimary: true }))
    await new Promise((r) => setTimeout(r, 250))
    const se = a.querySelector('[data-resize-handle="se"]')
    if (!se) return { err: '无缩放手柄' }
    const r0 = se.getBoundingClientRect()
    const mk = (type, x, y, extra) => se.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 8, isPrimary: true, ...extra }))
    mk('pointerdown', r0.left + 3, r0.top + 3, {})
    mk('pointermove', r0.left + 63, r0.top + 13, { shiftKey: true })
    mk('pointerup', r0.left + 63, r0.top + 13, { shiftKey: true })
    await new Promise((r) => setTimeout(r, 350))
    const list = await window.api.listBoardItems(${boardId})
    const it = list.find((i) => i.id === '${byText.A.id}')
    return { w: it.width, h: it.height }
  `)
  check(
    'Shift 拖角等比缩放(120x80 拉成 180x120,比例守住 1.5)',
    Math.abs(ratio.w / ratio.h - 1.5) < 0.02 && ratio.w > 120 && ratio.h > 80,
    JSON.stringify(ratio)
  )

  /* ---------- ⑤ 锁定 ---------- */
  await resetAll()
  // 先直连 API 证明 locked 写得进读得出(排除后端),再测菜单接线
  const lockApi = await run(`
    try {
      await window.api.updateBoardItems([{ id: '${byText.D.id}', patch: { locked: true } }])
      const list = await window.api.listBoardItems(${boardId})
      const got = list.find((i) => i.id === '${byText.D.id}').locked
      await window.api.updateBoardItems([{ id: '${byText.D.id}', patch: { locked: false } }])
      return { ok: got === true }
    } catch (e) { return { err: String(e && e.message ? e.message : e) } }
  `)
  check('locked 字段后端可写可读', lockApi.ok === true, JSON.stringify(lockApi))
  const locked = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 150))
    const el = document.querySelector('[data-board-item="${byText.D.id}"]')
    el.click()
    await new Promise((r) => setTimeout(r, 250))
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))
    await new Promise((r) => setTimeout(r, 200))
    const btn = [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === '锁定选中元素')
    if (!btn) return { err: '菜单里没有锁定项' }
    const menuBtns = [...document.querySelectorAll('.menu button[aria-label]')].map((b) => b.getAttribute('aria-label'))
    btn.click()
    await new Promise((r) => setTimeout(r, 400))
    const stillOpen = !!document.querySelector('.menu')
    // 轮询而不是定长等待:落库 + refreshBoardItems + React 重渲染是异步链,定长 300ms 会假失败
    let locked = false
    let badge = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100))
      const list = await window.api.listBoardItems(${boardId})
      locked = list.find((i) => i.id === '${byText.D.id}').locked === true
      badge = !!document.querySelector('[data-board-item="${byText.D.id}"] [aria-label="已锁定"]')
      if (locked && badge) break
    }
    return { locked, badge, menuBtns, stillOpen }
  `)
  check('右键锁定生效且画布上有锁标记', locked.locked === true && locked.badge === true, JSON.stringify(locked))
  const lockedDrag = await dragItem(byText.D.id, 40, 40)
  check('锁定元素拖动无效(位置不变)', lockedDrag.x === 700 && lockedDrag.y === 500, JSON.stringify(lockedDrag))
  const lockedDel = await run(`
    document.querySelector('[data-board-item="${byText.D.id}"]').click()
    await new Promise((r) => setTimeout(r, 200))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    const list = await window.api.listBoardItems(${boardId})
    return list.some((i) => i.id === '${byText.D.id}')
  `)
  check('锁定元素 Delete 删不掉', lockedDel === true, `仍存在=${lockedDel}`)
  const unlocked = await run(`
    const el = document.querySelector('[data-board-item="${byText.D.id}"]')
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))
    await new Promise((r) => setTimeout(r, 200))
    const btn = [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === '解锁选中元素')
    if (!btn) return { err: '菜单里没有解锁项' }
    btn.click()
    await new Promise((r) => setTimeout(r, 300))
    const list = await window.api.listBoardItems(${boardId})
    return { locked: list.find((i) => i.id === '${byText.D.id}').locked }
  `)
  check('可解锁', unlocked.locked === false, JSON.stringify(unlocked))
  const afterUnlock = await dragItem(byText.D.id, 30, 0, { altKey: true })
  check('解锁后恢复可拖动', afterUnlock.x === 730, JSON.stringify(afterUnlock))

  /* ---------- ⑥ 成组 ---------- */
  await resetAll()
  const grouped = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 450))
    const list = await window.api.listBoardItems(${boardId})
    const gids = [...new Set(list.map((i) => i.groupId))]
    return { gids, n: list.length }
  `)
  check('Ctrl+G 成组:四个元素同一个 groupId', grouped.gids.length === 1 && grouped.gids[0] !== '', JSON.stringify(grouped))
  const clickOne = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 150))
    const el = document.querySelector('[data-board-item="${byText.A.id}"]')
    const r0 = el.getBoundingClientRect()
    const mk = (type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r0.left + 20, clientY: r0.top + 20, button: 0, pointerId: 9, isPrimary: true }))
    mk('pointerdown')
    mk('pointerup')
    await new Promise((r) => setTimeout(r, 350))
    return { groupBox: !!document.querySelector('[data-group-box]') }
  `)
  check('点击组内任一元素 = 整组选中(出现组包围盒)', clickOne.groupBox === true, JSON.stringify(clickOne))
  const groupDrag = await dragItem(byText.B.id, 15, 15, { altKey: true })
  const allMoved = await run(`
    const list = await window.api.listBoardItems(${boardId})
    return Object.fromEntries(list.map((i) => [i.text, [i.x, i.y]]))
  `)
  check('拖动组内一个元素 = 整组一起位移', allMoved.A[0] === 115 && allMoved.C[0] === 535 && allMoved.D[0] === 715, JSON.stringify(allMoved))
  const ungrouped = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, shiftKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 450))
    const list = await window.api.listBoardItems(${boardId})
    return [...new Set(list.map((i) => i.groupId))]
  `)
  check('Ctrl+Shift+G 解组', ungrouped.length === 1 && ungrouped[0] === '', JSON.stringify(ungrouped))

  /* ---------- ⑦ 图层顺序 ---------- */
  const zOrder = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 150))
    const el = document.querySelector('[data-board-item="${byText.C.id}"]')
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }))
    await new Promise((r) => setTimeout(r, 200))
    const btn = [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === '图层置底')
    if (!btn) return { err: '没有图层置底按钮' }
    btn.click()
    await new Promise((r) => setTimeout(r, 400))
    const list = await window.api.listBoardItems(${boardId})
    return { first: list[0].text, zs: list.map((i) => i.z) }
  `)
  check('图层置底后 C 在最底(z 最小且列表首位)', zOrder.first === 'C' && zOrder.zs[0] === 0, JSON.stringify(zOrder))
  const zUp = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', ctrlKey: true, shiftKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    const list = await window.api.listBoardItems(${boardId})
    return list[list.length - 1].text
  `)
  check('Ctrl+Shift+] 置顶回到最上', zUp === 'C', `top=${zUp}`)
  check('z 值被压实为 0..n-1 无空洞', (await run(`const l = await window.api.listBoardItems(${boardId}); return l.every((i, k) => i.z === k)`)) === true, '')

  /* ---------- ⑧⑨ 滚轮缩放 / 双击 fit / 1:1 ---------- */
  const zoomSeq = await run(`
    const first = document.querySelector('[data-board-item]')
    const surface = first.parentElement
    const frame = surface.parentElement
    const scale = () => { const t = surface.style.transform; const m = t.match(/scale\\(([-\\d.]+)\\)/); return m ? Number(m[1]) : 1 }
    const before = scale()
    for (let i = 0; i < 4; i++) frame.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 400, clientY: 400 }))
    await new Promise((r) => setTimeout(r, 250))
    const zoomed = scale()
    frame.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 300))
    const fitted = scale()
    const btn = [...document.querySelectorAll('button[aria-label="回到实际大小"]')]
    if (btn[0]) btn[0].click()
    await new Promise((r) => setTimeout(r, 300))
    return { before, zoomed, fitted, reset: scale(), hasBtn: btn.length }
  `)
  check('滚轮放大生效(合帧后仍能变焦)', zoomSeq.zoomed > zoomSeq.before, JSON.stringify(zoomSeq))
  check('双击空白 = 适配全部内容(缩放被收回)', zoomSeq.fitted < zoomSeq.zoomed, `zoomed=${zoomSeq.zoomed} fitted=${zoomSeq.fitted}`)
  check('工具栏 1:1 按钮复位缩放', zoomSeq.hasBtn === 1 && Math.abs(zoomSeq.reset - 1) < 0.001, `reset=${zoomSeq.reset}`)

  await run(`await window.api.deleteBoard(${boardId}); return 1`)
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常:', e.message)
  process.exit(1)
})
