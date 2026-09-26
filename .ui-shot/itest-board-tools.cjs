/* 白板标注工具专项验证：绘图工具(手绘/矩形/箭头)/撤销重做/复制粘贴/方向键微调/
   视图控制(适配/复位/缩放快捷键/双击适配)/画布外观(背景色/网格开关,持久化)/note 拖动手柄
   前置：npm run dev -- --remote-debugging-port=9333
   运行：node .ui-shot/itest-board-tools.cjs
   说明：新建独立测试白板「itest-工具」操作,结束时删除,不污染用户白板 */
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
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面')
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

  // 画布 frame
  const FRAME = `(() => {
    const f = document.querySelector('[data-board-frame]')
    return f || null
  })()`
  // 帧内拖拽（画布坐标 → client 坐标）
  const dragExpr = (x1, y1, x2, y2, pointerId) => `(() => {
    const frame = ${FRAME}
    const rect = frame.getBoundingClientRect()
    const mk = (x, y, type) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + x, clientY: rect.top + y, button: 0, pointerId: ${pointerId}, isPrimary: true })
    frame.dispatchEvent(mk(${x1}, ${y1}, 'pointerdown'))
    frame.dispatchEvent(mk(${x2}, ${y2}, 'pointermove'))
    frame.dispatchEvent(mk(${x2}, ${y2}, 'pointerup'))
  })()`
  const toolBtn = (label) => `document.querySelector('button[aria-label="工具 ${label}"]')`
  const surfaceTransform = `(() => {
    const frame = ${FRAME}
    if (!frame) return ''
    return frame.querySelector('div.absolute.left-0.top-0').style.transform
  })()`
  const zoomScale = `(() => {
    const m = /scale\\(([\\d.]+)\\)/.exec(${surfaceTransform})
    return m ? Number(m[1]) : -1
  })()`

  /* ---------- 0. 准备：清理旧测试白板 → 新建 → 重载 → 进入白板并切换 ---------- */
  await run(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name.startsWith('itest-工具')) await window.api.deleteBoard(b.id)
  })()`)
  const board = await run(`return window.api.createBoard('itest-工具-${Date.now()}')`)
  const boardId = board.id
  await run(`location.reload()`)
  let ready = false
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    ready = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (ready) break
  }
  check('应用重载后就绪', ready, `boardId=${boardId}`)
  await run(`(() => {
    const btn = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]')
    btn.click()
  })()`)
  await sleep(500)
  const switchBoard = `(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`
  await run(switchBoard)
  await sleep(400)

  /* ---------- 1. 工具行存在 ---------- */
  const tools = await run(`return (() => {
    const ids = ['选择', '手绘', '箭头', '直线', '矩形', '椭圆', '文字']
    const ok = ids.every((l) => !!document.querySelector('button[aria-label="工具 ' + l + '"]'))
    return { ok, undo: !!document.querySelector('button[aria-label="撤销"]'), redo: !!document.querySelector('button[aria-label="重做"]'), fit: !!document.querySelector('button[aria-label="适配全部内容"]'), palette: !!document.querySelector('button[aria-label="画布外观"]') }
  })()`)
  check('绘图工具行齐全(7 工具+撤销重做+适配+外观)', tools.ok && tools.undo && tools.redo && tools.fit && tools.palette, JSON.stringify(tools))

  /* ---------- 2. 手绘：切工具 → 拖拽绘制 → 形状元素出现 ---------- */
  await run(`(${toolBtn('手绘')}).click()`)
  await sleep(200)
  await run(dragExpr(200, 200, 320, 300, 11))
  await sleep(400)
  const pen = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    const s = items.filter((i) => i.type === 'shape').map((i) => { try { return JSON.parse(i.shape).kind } catch { return '?' } })
    return { shapes: items.filter((i) => i.type === 'shape').length, kinds: s, svg: document.querySelectorAll('svg[data-shape]').length }
  })()`)
  check('手绘笔绘制出 pen 形状', pen.shapes >= 1 && pen.kinds.includes('pen') && pen.svg === pen.shapes, `kinds=${pen.kinds} svg=${pen.svg}`)
  /* ---------- 2b. 手绘 V 形回笔：包围盒必须覆盖全部采样点(回归:旧算法用首尾算 h≈0 笔画丢失) ---------- */
  await run(`(() => {
    const frame = ${FRAME}
    const rect = frame.getBoundingClientRect()
    const mk = (x, y, type) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + x, clientY: rect.top + y, button: 0, pointerId: 31, isPrimary: true })
    frame.dispatchEvent(mk(400, 180, 'pointerdown'))
    frame.dispatchEvent(mk(440, 300, 'pointermove'))
    frame.dispatchEvent(mk(480, 320, 'pointermove'))
    frame.dispatchEvent(mk(540, 220, 'pointermove'))
    frame.dispatchEvent(mk(560, 180, 'pointermove'))
    frame.dispatchEvent(mk(560, 180, 'pointerup'))
  })()`)
  await sleep(400)
  const penV = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    const pens = items.filter((i) => i.type === 'shape' && (() => { try { return JSON.parse(i.shape).kind === 'pen' } catch { return false } })())
    const v = pens[pens.length - 1]
    if (!v) return { ok: false }
    let spec = null
    try { spec = JSON.parse(v.shape) } catch { spec = null }
    const xs = (spec?.points ?? []).map((p) => p[0])
    const ys = (spec?.points ?? []).map((p) => p[1])
    return { ok: true, w: v.width, h: v.height, normOk: xs.every((n) => n >= -0.01 && n <= 1.01) && ys.every((n) => n >= -0.01 && n <= 1.01) }
  })()`)
  check(
    '手绘 V 形回笔包围盒完整(宽>80 高>80 归一化有效)',
    penV.ok && penV.w > 80 && penV.h > 80 && penV.normOk,
    JSON.stringify(penV)
  )


  /* ---------- 3. 矩形：拖拽绘制 ---------- */
  await run(`(${toolBtn('矩形')}).click()`)
  await sleep(200)
  await run(dragExpr(120, 120, 320, 240, 12))
  await sleep(400)
  const rect = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    const r = items.find((i) => i.type === 'shape' && (() => { try { return JSON.parse(i.shape).kind === 'rect' } catch { return false } })())
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
  })()`)
  check('矩形工具绘制 200x120@(120,120)', rect && rect.x === 120 && rect.y === 120 && rect.w === 200 && rect.h === 120, JSON.stringify(rect))

  /* ---------- 4. 箭头：拖拽绘制 ---------- */
  await run(`(${toolBtn('箭头')}).click()`)
  await sleep(200)
  await run(dragExpr(100, 400, 260, 480, 13))
  await sleep(400)
  const arrow = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    return items.some((i) => i.type === 'shape' && (() => { try { return JSON.parse(i.shape).kind === 'arrow' } catch { return false } })())
  })()`)
  check('箭头工具绘制出 arrow 形状', arrow, '')

  /* ---------- 5. 撤销/重做：Ctrl+Z 移除箭头,Ctrl+Shift+Z 恢复 ---------- */
  const shapesBefore = await run(`return (async () => (await window.api.listBoardItems(${boardId})).filter((i) => i.type === 'shape').length)()`)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`)
  await sleep(400)
  const shapesUndo = await run(`return (async () => (await window.api.listBoardItems(${boardId})).filter((i) => i.type === 'shape').length)()`)
  check('Ctrl+Z 撤销最近一次绘制', shapesUndo === shapesBefore - 1, `before=${shapesBefore} after=${shapesUndo}`)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))`)
  await sleep(400)
  const shapesRedo = await run(`return (async () => (await window.api.listBoardItems(${boardId})).filter((i) => i.type === 'shape').length)()`)
  check('Ctrl+Shift+Z 重做恢复', shapesRedo === shapesBefore, `after=${shapesRedo}`)

  /* ---------- 6. 复制粘贴：点击选中矩形 → Ctrl+C/V/D ---------- */
  await run(`(async () => {
    const items = await window.api.listBoardItems(${boardId})
    const r = items.find((i) => i.type === 'shape' && (() => { try { return JSON.parse(i.shape).kind === 'rect' } catch { return false } })())
    const el = document.querySelector('[data-board-item="' + r.id + '"]')
    const b = el.getBoundingClientRect()
    const mk = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, pointerId: 21, isPrimary: true })
    el.dispatchEvent(mk('pointerdown'))
    el.dispatchEvent(mk('pointerup'))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }))
    return true
  })()`)
  await sleep(300)
  const totalBefore = await run(`return (async () => (await window.api.listBoardItems(${boardId})).length)()`)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))`)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }))`)
  await sleep(500)
  const totalPaste = await run(`return (async () => (await window.api.listBoardItems(${boardId})).length)()`)
  check('Ctrl+C/V 粘贴副本(+1)', totalPaste === totalBefore + 1, `before=${totalBefore} after=${totalPaste}`)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }))`)
  await sleep(500)
  const totalDup = await run(`return (async () => (await window.api.listBoardItems(${boardId})).length)()`)
  check('Ctrl+D 原地复制(+1)', totalDup === totalPaste + 1, `after=${totalDup}`)

  /* ---------- 7. 方向键微调：选中矩形 → ArrowRight x+1 ---------- */
  const rectSel = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    const r = items.find((i) => i.type === 'shape' && (() => { try { return JSON.parse(i.shape).kind === 'rect' } catch { return false } })())
    return r
  })()`)
  // 重新点击选中（上一次点击后 selection 可能已被后续操作清掉）
  await run(`(() => {
    const el = document.querySelector('[data-board-item="' + '${rectSel.id}' + '"]')
    const b = el.getBoundingClientRect()
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 10, button: 0, pointerId: 22, isPrimary: true }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 10, button: 0, pointerId: 22, isPrimary: true }))
  })()`)
  await sleep(200)
  const xBefore = rectSel.x
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  await run(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))`)
  await sleep(500)
  const rectAfter = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    const r = items.find((i) => i.id === '${rectSel.id}')
    return r ? { x: r.x, y: r.y } : null
  })()`)
  check('方向键微调 x+1 落库', rectAfter && rectAfter.x === xBefore + 1 && rectAfter.y === rectSel.y, `x ${xBefore}→${rectAfter?.x}`)

  /* ---------- 8. 视图控制：+ 放大 → 滑块同步 → F 适配 → 0 复位 ---------- */
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))`)
  await sleep(200)
  const zIn = await run(`return ${zoomScale}`)
  await sleep(200)
  const sliderAfterZoom = await run(`return Number(document.querySelector('input[aria-label="白板缩放"]').value)`)
  check('+ 键放大且滑块同步', zIn > 1.1 && Math.abs(sliderAfterZoom - zIn) < 0.01, `scale=${zIn} slider=${sliderAfterZoom}`)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))`)
  await sleep(300)
  const zFit = await run(`return ${zoomScale}`)
  check('F 键适配全部内容(缩放回落)', zFit < zIn && zFit <= 1.0001, `scale ${zIn}→${zFit}`)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
  await sleep(300)
  const zZero = await run(`return ${zoomScale}`)
  const sliderZero = await run(`return Number(document.querySelector('input[aria-label="白板缩放"]').value)`)
  check('0 键复位 100%', Math.abs(zZero - 1) < 0.001 && Math.abs(sliderZero - 1) < 0.001, `scale=${zZero} slider=${sliderZero}`)

  /* ---------- 9. 双击空白 → 适配全部内容 ---------- */
  await run(`(${toolBtn('选择')}).click()`)
  await sleep(200)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))`)
  await sleep(200)
  const zBeforeDbl = await run(`return ${zoomScale}`)
  await run(`(() => {
    const frame = ${FRAME}
    const rect = frame.getBoundingClientRect()
    const mk = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + 900, clientY: rect.top + 500, button: 0, pointerId: 23, isPrimary: true })
    for (let i = 0; i < 2; i++) {
      frame.dispatchEvent(mk('pointerdown'))
      frame.dispatchEvent(mk('pointerup'))
    }
  })()`)
  await sleep(400)
  const zAfterDbl = await run(`return ${zoomScale}`)
  check('双击空白适配内容(缩放回落)', zAfterDbl < zBeforeDbl, `scale ${zBeforeDbl}→${zAfterDbl}`)

  /* ---------- 10. 画布外观：白色背景 + 关网格 → 持久化 ---------- */
  await run(`document.querySelector('button[aria-label="画布外观"]').click()`)
  await sleep(200)
  const popover = await run(`return !!document.querySelector('button[aria-label="背景色 白色"]')`)
  check('外观面板弹出', popover, '')
  await run(`document.querySelector('button[aria-label="背景色 白色"]').click()`)
  await sleep(400)
  const bgWhite = await run(`return (() => {
    const frame = ${FRAME}
    return getComputedStyle(frame).backgroundColor
  })()`)
  check('背景切换白色生效', bgWhite === 'rgb(255, 255, 255)', bgWhite)
  await run(`(() => {
    const cb = document.querySelector('input[aria-label="网格开关"]')
    if (cb && cb.checked) cb.click()
  })()`)
  await sleep(400)
  const gridGone = await run(`return !document.querySelector('[data-grid]')`)
  check('网格开关关闭(点阵消失)', gridGone, '')
  // 重载验证持久化（按白板存储）
  await run(`location.reload()`)
  ready = false
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    ready = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (ready) break
  }
  await run(`(() => {
    const btn = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]')
    btn.click()
  })()`)
  await sleep(500)
  await run(switchBoard)
  await sleep(400)
  const persisted = await run(`return (() => {
    const frame = ${FRAME}
    return { bg: getComputedStyle(frame).backgroundColor, grid: !!document.querySelector('[data-grid]') }
  })()`)
  check('外观持久化(重载后仍白色/无网格)', persisted.bg === 'rgb(255, 255, 255)' && !persisted.grid, JSON.stringify(persisted))
  // 恢复默认外观,避免影响其它测试观感
  await run(`document.querySelector('button[aria-label="画布外观"]').click()`)
  await sleep(150)
  await run(`document.querySelector('button[aria-label="背景色 深色"]').click()`)
  await sleep(200)
  await run(`(() => {
    const cb = document.querySelector('input[aria-label="网格开关"]')
    if (cb && !cb.checked) cb.click()
  })()`)
  await sleep(300)

  /* ---------- 11. 文字对象：单次放置 / 编辑成品分离 / 样式 / 拖动 ---------- */
  await run(`(${toolBtn('文字')}).click()`)
  await sleep(200)
  await run(`(() => {
    const frame = ${FRAME}
    const rect = frame.getBoundingClientRect()
    const mk = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + 500, clientY: rect.top + 260, button: 0, pointerId: 31, isPrimary: true })
    frame.dispatchEvent(mk('pointerdown'))
    frame.dispatchEvent(mk('pointerup'))
  })()`)
  await sleep(400)
  const note = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    const n = items.filter((i) => i.type === 'note').sort((a, b) => b.createdAt - a.createdAt)[0]
    return n ? { id: n.id, x: n.x, y: n.y } : null
  })()`)
  check('文字工具落点创建文字对象', !!note, JSON.stringify(note))
  const enteredEditing = await run(`return (() => {
    const editor = document.querySelector('[data-board-text-editor]')
    const select = document.querySelector('button[aria-label="工具 选择"]')
    return { editor: !!editor, focused: document.activeElement === editor, selectActive: select?.className.includes('accent-soft') }
  })()`)
  check('新建文字立即聚焦并自动回到选择工具', enteredEditing.editor && enteredEditing.focused && enteredEditing.selectActive, JSON.stringify(enteredEditing))
  await run(`(() => {
    const editor = document.querySelector('[data-board-text-editor]')
    editor.value = '白板文字测试\\n第二行\\n第三行\\n第四行'
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })()`)
  await sleep(500)
  const textCommitted = await run(`return (async () => {
    const item = (await window.api.listBoardItems(${boardId})).find((i) => i.id === '${note.id}')
    const el = document.querySelector('[data-board-item="${note.id}"]')
    return { text: item?.text, height: item?.height, display: !!el?.querySelector('[data-board-text-display]'), editor: !!el?.querySelector('textarea'), background: getComputedStyle(el).backgroundColor }
  })()`)
  check('完成输入后呈现无底色且长文本自动长高', textCommitted.text.includes('第四行') && textCommitted.height > 64 && textCommitted.display && !textCommitted.editor && textCommitted.background === 'rgba(0, 0, 0, 0)', JSON.stringify(textCommitted))
  const beforeSecondClick = await run(`return (await window.api.listBoardItems(${boardId})).filter((i) => i.type === 'note').length`)
  await run(`(() => {
    const frame = ${FRAME}; const rect = frame.getBoundingClientRect()
    frame.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 760, clientY: rect.top + 420, button: 0, pointerId: 35 }))
    frame.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: rect.left + 760, clientY: rect.top + 420, button: 0, pointerId: 35 }))
  })()`)
  await sleep(250)
  const afterSecondClick = await run(`return (await window.api.listBoardItems(${boardId})).filter((i) => i.type === 'note').length`)
  check('完成后再点白板不会连续生成文字框', afterSecondClick === beforeSecondClick, `${beforeSecondClick}→${afterSecondClick}`)
  await run(`(() => {
    const el = document.querySelector('[data-board-item="${note.id}"]'); const b = el.getBoundingClientRect()
    const mk = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + 20, button: 0, pointerId: 36, isPrimary: true })
    el.dispatchEvent(mk('pointerdown')); el.dispatchEvent(mk('pointerup')); el.click()
  })()`)
  await sleep(150)
  const styleBar = await run(`return !!document.querySelector('[data-board-text-stylebar] select[aria-label="文字字号"]')`)
  check('选中文字显示字体/字号/颜色属性栏', styleBar, '')
  await run(`(() => {
    const s = document.querySelector('select[aria-label="文字字号"]')
    s.value = '28'; s.dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('button[aria-label="文字颜色 #ffd9a0"]').click()
  })()`)
  await sleep(500)
  const styled = await run(`return (async () => {
    const item = (await window.api.listBoardItems(${boardId})).find((i) => i.id === '${note.id}')
    return { size: item?.noteFontSize, color: item?.noteColor }
  })()`)
  check('字号与颜色持久化', styled.size === 28 && styled.color === '#ffd9a0', JSON.stringify(styled))
  await run(`document.querySelector('[data-board-text-display]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(150)
  check('双击成品文字重新进入编辑态', await run(`return !!document.querySelector('[data-board-text-editor]')`), '')
  await run(`document.querySelector('[data-board-text-editor]').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
  await sleep(250)
  await run(`(() => {
    const el = document.querySelector('[data-board-item="' + '${note.id}' + '"]')
    const b = el.getBoundingClientRect()
    // Alt 关闭智能吸附：本用例断言的是「精确位移」，吸附会把元素吸到邻近边线上(实测差 1px)
    const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 32, isPrimary: true, altKey: true })
    el.dispatchEvent(mk('pointerdown', b.left + 40, b.top + 20))
    el.dispatchEvent(mk('pointermove', b.left + 90, b.top + 50))
    el.dispatchEvent(mk('pointerup', b.left + 90, b.top + 50))
  })()`)
  await sleep(500)
  const noteAfter = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    const n = items.find((i) => i.id === '${note.id}')
    return n ? { x: n.x, y: n.y } : null
  })()`)
  check('文字对象拖动生效(+50,+30)', noteAfter && noteAfter.x === note.x + 50 && noteAfter.y === note.y + 30, `(${note.x},${note.y})→(${noteAfter?.x},${noteAfter?.y})`)

  /* ---------- 12. .lumenboard 形状元素往返（导出→导入→形状还原） ---------- */
  const os = require('os')
  const path = require('path')
  const fs = require('fs')
  const roundPath = path.join(os.tmpdir(), `lumen-tools-${Date.now()}.lumenboard`)
  const exp = await run(`return window.api.exportBoardToPath(${boardId}, '${roundPath.replace(/\\/g, '\\\\')}')`)
  check('.lumenboard 导出成功', exp && exp.count > 0, `count=${exp?.count}`)
  const imp = await run(`return window.api.importBoardFromPath('${roundPath.replace(/\\/g, '\\\\')}')`)
  check('.lumenboard 导入成功', !!imp && imp.imported > 0, `imported=${imp?.imported}`)
  const shapeRound = await run(`return (async () => {
    const items = await window.api.listBoardItems(${imp.boardId})
    const kinds = items.filter((i) => i.type === 'shape').map((i) => { try { return JSON.parse(i.shape).kind } catch { return '?' } })
    const text = items.find((i) => i.type === 'note')
    return { shapes: kinds.length, kinds, textSize: text?.noteFontSize, textColor: text?.noteColor }
  })()`)
  check('形状元素往返还原(pen/rect/arrow)', shapeRound.shapes >= 3 && ['pen', 'rect', 'arrow'].every((k) => shapeRound.kinds.includes(k)), JSON.stringify(shapeRound))
  check('文字字号与颜色随 .lumenboard 往返', shapeRound.textSize === 28 && shapeRound.textColor === '#ffd9a0', JSON.stringify(shapeRound))
  await run(`await window.api.deleteBoard(${imp.boardId})`)

  /* ---------- 12.5 素材翻转（对标 PureRef,右键菜单 + DB + 渲染变换 + .lumenboard 往返） ---------- */
  const flipAssetId = await run(`return (async () => {
    const a = (await window.api.queryAssets({ limit: 20 })).find((x) => ['jpg','jpeg','png','gif','webp'].includes(x.ext))
    return a ? a.id : null
  })()`)
  if (flipAssetId) {
    // 放到画布可见区(其他小节的元素在 120~420 范围内均可见)。
    // 直接 IPC 加料不触发应用刷新,重载后进白板让画布从 DB 重建元素
    await run(`return window.api.addBoardItem(${boardId}, { type: 'asset', assetId: ${JSON.stringify(flipAssetId)}, x: 250, y: 180, width: 160, height: 120 })`)
    await run(`setTimeout(() => location.reload(), 0)`)
    await sleep(1500)
    let flipReady = false
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      flipReady = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`).catch(() => false)
      if (flipReady) break
    }
    await run(`(() => {
      document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]').click()
    })()`)
    await sleep(500)
    await run(switchBoard)
    await sleep(600)
    const flipItem = await run(`return (async () => {
      const items = await window.api.listBoardItems(${boardId})
      return items.find((i) => i.assetId === ${JSON.stringify(flipAssetId)}) ?? null
    })()`)
    check('素材元素默认未翻转', !!flipItem && flipItem.flipX === false && flipItem.flipY === false, JSON.stringify({ flipX: flipItem?.flipX, flipY: flipItem?.flipY }))
    /** 右键元素 → 点击指定菜单项 → 返回 {db 态, DOM transform} */
    const flipViaMenu = (label) => run(`return (async () => {
      const el = document.querySelector('[data-board-item="${flipItem.id}"]')
      const b = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 40, clientY: b.top + 40, button: 2 }))
      await new Promise((r) => setTimeout(r, 300))
      const btn = [...document.querySelectorAll('.menu button')].find((x) => x.textContent.includes('${label}'))
      if (!btn) return { db: null, transform: 'menu-missing' }
      btn.click()
      await new Promise((r) => setTimeout(r, 500))
      const item = (await window.api.listBoardItems(${boardId})).find((i) => i.id === '${flipItem.id}')
      const img = document.querySelector('[data-board-item="${flipItem.id}"] img')
      return { db: item ? { fx: item.flipX, fy: item.flipY } : null, transform: img?.style.transform ?? '' }
    })()`)
    const fx = await flipViaMenu('水平翻转')
    check('右键水平翻转:落库且渲染镜像', fx.db?.fx === true && fx.transform.includes('scale(-1, 1)'), JSON.stringify(fx))
    const fy = await flipViaMenu('垂直翻转')
    check('右键垂直翻转叠加(scale(-1,-1))', fy.db?.fx === true && fy.db?.fy === true && fy.transform.includes('scale(-1, -1)'), JSON.stringify(fy))
    // .lumenboard 往返还原翻转态
    const flipRoundPath = path.join(os.tmpdir(), `lumen-flip-${Date.now()}.lumenboard`)
    const flipExp = await run(`return window.api.exportBoardToPath(${boardId}, '${flipRoundPath.replace(/\\/g, '\\\\')}')`)
    const flipImp = flipExp && (await run(`return window.api.importBoardFromPath('${flipRoundPath.replace(/\\/g, '\\\\')}')`))
    const flipRound = flipImp
      ? await run(`return (async () => {
          const items = await window.api.listBoardItems(${flipImp.boardId})
          const f = items.find((i) => i.assetId === ${JSON.stringify(flipAssetId)})
          await window.api.deleteBoard(${flipImp.boardId})
          return f ? { fx: f.flipX, fy: f.flipY } : null
        })()`)
      : null
    check('翻转态随 .lumenboard 往返还原', flipRound && flipRound.fx === true && flipRound.fy === true, JSON.stringify(flipRound))

    /* ---------- 12.6 导出画布 PNG（渲染层光栅化 + 主进程落盘） ---------- */
    const pngBtn = await run(`return !!document.querySelector('button[aria-label="导出画布 PNG"]')`)
    check('工具栏含导出 PNG 按钮', pngBtn, '')
    // 光栅化管线探针:含 <text>/<image data:/> 的 SVG(无 foreignObject)经 blob 绘入 canvas 不污染
    // (foreignObject 会使 toDataURL 抛 SecurityError,PNG 导出走 <text> 路径)
    const rasterOk = await run(`return (async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#123456"/><text x="4" y="20" font-size="12" fill="#fff" font-family="sans-serif">T</text><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" width="8" height="8"/></svg>'
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      try {
        const img = new Image()
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load fail')); img.src = url })
        const c = document.createElement('canvas'); c.width = 128; c.height = 128
        const ctx = c.getContext('2d'); ctx.scale(2, 2); ctx.drawImage(img, 0, 0, 64, 64)
        const d = c.toDataURL('image/png')
        return d.startsWith('data:image/png;base64,') && d.length > 200
      } finally { URL.revokeObjectURL(url) }
    })()`)
    check('SVG→PNG 光栅化管线可用(text+data: 图元不污染画布)', rasterOk === true, `raster=${rasterOk}`)
    // 主进程落盘通道:写出合法 PNG(文件头 89 50 4E 47)
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const osPng = path.join(os.tmpdir(), `lumen-png-${Date.now()}.png`)
    await run(`return window.api.saveBoardPngToPath('${tinyPng}', '${osPng.replace(/\\/g, '\\\\')}')`)
    const pngHead = fs.readFileSync(osPng).subarray(0, 4)
    check('savePngToPath 落盘为合法 PNG', pngHead[0] === 0x89 && pngHead[1] === 0x50 && pngHead[2] === 0x4e && pngHead[3] === 0x47, `head=${pngHead.toString('hex')}`)
    fs.rmSync(osPng, { force: true })
    // asset:// fetch 可用性(corsEnabled 修复验证,里程碑 133)
    const fetchProbe = await run(`try {
      const a = (await window.api.queryAssets({ limit: 100 })).find((x) => ['jpg','png'].includes(x.ext))
      const resp = await Promise.race([ fetch(window.api.thumbnailUrl(a.id)), new Promise((res) => setTimeout(() => res('T-5s'), 5000)) ])
      return resp === 'T-5s' ? resp : 'status=' + resp.status
    } catch (e) { return 'ERR ' + e.message }`).catch((e) => 'ERR ' + e.message)
    check('asset:// fetch 可用(corsEnabled 修复验证)', String(fetchProbe).startsWith('status=200'), String(fetchProbe))
  } else {
  }

  /* ---------- 13. 清理：删除测试白板 ---------- */
  await run(`await window.api.deleteBoard(${boardId})`)
  await sleep(300)

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
