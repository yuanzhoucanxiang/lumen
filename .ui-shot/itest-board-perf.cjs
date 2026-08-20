/* 白板超大规模性能专项验证(里程碑 97):
   ①80 元素宽幅网格(横跨 3800×3000):视口裁剪——DOM 元素数远小于总数,视口外不渲染、视口内渲染;
   ②空格平移 3400×2800:裁剪随平移更新(原区域卸载、新区域挂载),元素坐标不被改写;
   ③缩放滑块降到 10%:小尺寸 asset 元素降级为色块占位(data-degraded,无 img),恢复 100% 后 img 回归;
   ④Ctrl+A 全选 81 元素:组包围盒正常出现(选中 Set 化后功能不回归);
   ⑤清理:删除测试白板 + 软删测试素材 + 清临时目录,不污染用户库。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-board-perf.cjs */
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

function rmTempDir(dir) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    } catch {
      /* Windows Defender 可能短暂锁定,重试 */
    }
  }
  return false
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面(先启动 dev)')
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
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- 0. 准备:清理旧测试白板 → 新建 → 重载 → 进入白板模式 ---------- */
  await run(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name.startsWith('itest-性能')) await window.api.deleteBoard(b.id)
  })()`)
  const board = await run(`return window.api.createBoard('itest-性能-${Date.now()}')`)
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
  await run(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)

  /* ---------- 1. 铺 80 个文字元素:10 列 × 8 行,间距 400px(总范围 200..3920 × 200..3080) ---------- */
  // 注意:run 的外层 async IIFE 会 await 顶层 await;不能再用内层 (async()=>{})() 包裹,否则循环在后台跑
  await run(`
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 10; c++) {
        await window.api.addBoardItem(${boardId}, {
          type: 'note',
          x: 200 + c * 400,
          y: 200 + r * 400,
          width: 120,
          height: 80,
          text: 'N' + r + '-' + c
        })
      }
    }
    return 'done'
  `)
  // 重新打开白板刷新 store
  await run(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)
  const items1 = await run(`return window.api.listBoardItems(${boardId})`)
  check('测试白板 80 个元素就位', items1.length === 80, `${items1.length} items`)

  /* ---------- 2. 视口裁剪:初始视口(0,0)只渲染近处元素 ---------- */
  const cullInitial = await run(`return (() => {
    const all = [...document.querySelectorAll('[data-board-item]')]
    const ids = new Set(all.map((el) => el.getAttribute('data-board-item')))
    return { rendered: all.length }
  })()`)
  const nearRendered = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    const near = items.find((i) => i.text === 'N0-0')
    const far = items.find((i) => i.text === 'N7-9')
    return {
      near: !!document.querySelector('[data-board-item="' + near.id + '"]'),
      far: !!document.querySelector('[data-board-item="' + far.id + '"]')
    }
  })()`)
  check('①视口裁剪生效(DOM 元素数远小于总数)', cullInitial.rendered >= 4 && cullInitial.rendered < 60, `DOM=${cullInitial.rendered}/80`)
  check('②视口内元素(N0-0, 200,200)已渲染', nearRendered.near === true, '')
  check('③视口外元素(N7-9, 3800,3000)未渲染', nearRendered.far === false, '')

  /* ---------- 3. 空格平移(-3400,-2800):裁剪跟随,坐标不改写 ---------- */
  const positionBeforePan = await run(`return (await window.api.listBoardItems(${boardId})).map((i) => ({ id: i.id, x: i.x, y: i.y }))`)
  const panResult = await run(`return (() => {
    const frame = document.querySelector('[data-board-frame]')
    const rect = frame.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
    frame.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 88, isPrimary: true }))
    frame.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: cx - 3400, clientY: cy - 2800, button: 0, buttons: 1, pointerId: 88, isPrimary: true }))
    frame.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx - 3400, clientY: cy - 2800, button: 0, buttons: 0, pointerId: 88, isPrimary: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }))
    return { ok: true }
  })()`)
  await sleep(300)
  const afterPan = await run(`return (async () => {
    const items = await window.api.listBoardItems(${boardId})
    const near = items.find((i) => i.text === 'N0-0')
    const far = items.find((i) => i.text === 'N7-9')
    const surface = document.querySelector('[data-board-frame] div.absolute.left-0.top-0')
    return {
      transform: surface ? surface.style.transform : '',
      nearRendered: !!document.querySelector('[data-board-item="' + near.id + '"]'),
      farRendered: !!document.querySelector('[data-board-item="' + far.id + '"]'),
      rendered: document.querySelectorAll('[data-board-item]').length
    }
  })()`)
  const positionAfterPan = await run(`return (await window.api.listBoardItems(${boardId})).map((i) => ({ id: i.id, x: i.x, y: i.y }))`)
  check('④平移落位(transform -3400/-2800)', panResult.ok && afterPan.transform.includes('-3400px') && afterPan.transform.includes('-2800px'), afterPan.transform)
  check('⑤平移不改写任何元素坐标', JSON.stringify(positionBeforePan) === JSON.stringify(positionAfterPan), '80 项坐标一致')
  check('⑥裁剪随平移更新(远元素挂载/近元素卸载)', afterPan.farRendered === true && afterPan.nearRendered === false, `DOM=${afterPan.rendered}/80`)
  check('⑦平移后 DOM 元素数仍受限', afterPan.rendered >= 4 && afterPan.rendered < 60, `DOM=${afterPan.rendered}/80`)

  /* ---------- 4. 真实图片上板 + 缩放降级(缩小到 10% 色块占位,恢复 100% img 回归) ---------- */
  // 复位视口:平移把视口带到了 (-3400,-2800),asset 加在 (200,200) 会被裁掉,先回原点
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
  await sleep(300)
  const dataUrl = await run(`return (() => {
    const c = document.createElement('canvas')
    c.width = 400; c.height = 300
    const g = c.getContext('2d')
    g.fillStyle = '#b33'
    g.fillRect(0, 0, 400, 300)
    return c.toDataURL('image/png')
  })()`)
  const stamp = Date.now()
  const tmpDir = path.join(os.tmpdir(), 'lumen-itest-perf-' + stamp)
  fs.mkdirSync(tmpDir, { recursive: true })
  const imgFile = path.join(tmpDir, `lumen-perf-${stamp}.png`)
  fs.writeFileSync(imgFile, Buffer.from(dataUrl.split(',')[1], 'base64'))
  const imported = await run(`return window.api.importFromPaths(${JSON.stringify([imgFile])})`)
  check('⑧测试图片真实导入', imported.imported === 1 && imported.importedIds.length === 1, `imported=${imported.imported}`)
  const assetId = imported.importedIds[0]
  // 宽 100 的 asset 元素:100% 时 100px 正常渲染;10% 时 10px < 阈值 → 降级
  const assetItem = await run(`return window.api.addBoardItem(${boardId}, { type: 'asset', assetId: '${assetId}', x: 200, y: 200, width: 100, height: 0 })`)
  await run(`(() => {
    const sel = document.querySelector('select[aria-label="切换白板"]')
    sel.value = ${boardId}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)
  const beforeZoom = await run(`return {
    img: !!document.querySelector('[data-board-item="${assetItem.id}"] img'),
    degraded: !!document.querySelector('[data-board-item="${assetItem.id}"] [data-degraded]')
  }`)
  check('⑨100% 时正常渲染缩略图', beforeZoom.img && !beforeZoom.degraded, JSON.stringify(beforeZoom))
  const setZoom = (v) => `
    const slider = document.querySelector('input[aria-label="白板缩放"]')
    const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setVal.call(slider, '${v}')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  `
  await run(`(() => { ${setZoom('0.1')} })()`)
  await sleep(500)
  const zoomedOut = await run(`return {
    img: !!document.querySelector('[data-board-item="${assetItem.id}"] img'),
    degraded: !!document.querySelector('[data-board-item="${assetItem.id}"] [data-degraded]'),
    scale: (() => { const m = /scale\\(([\\d.]+)\\)/.exec(document.querySelector('[data-board-frame] div.absolute.left-0.top-0')?.style.transform ?? ''); return m ? Number(m[1]) : 1 })()
  }`)
  check('⑩缩小到 10%:asset 元素降级为色块占位(无 img)', zoomedOut.scale <= 0.11 && zoomedOut.degraded && !zoomedOut.img, JSON.stringify(zoomedOut))
  // 用 0 复位回 100% + 原点(滑块的 zoomTo 以中心锚点缩放,不会回到原点)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
  await sleep(500)
  const zoomedBack = await run(`return {
    img: !!document.querySelector('[data-board-item="${assetItem.id}"] img'),
    degraded: !!document.querySelector('[data-board-item="${assetItem.id}"] [data-degraded]')
  }`)
  check('⑪恢复 100%:降级解除、img 回归', zoomedBack.img && !zoomedBack.degraded, JSON.stringify(zoomedBack))

  /* ---------- 5. Ctrl+A 全选 81 元素 → 组包围盒 ---------- */
  const ctrlA = await run(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    return !!document.querySelector('[data-group-box]')
  `)
  check('⑫Ctrl+A 全选 81 元素出现组包围盒', ctrlA, '')

  /* ---------- 6. 清理:删白板 + 软删测试素材 + 清临时目录 ---------- */
  await run(`await window.api.deleteBoard(${boardId})`)
  const cleaned = await run(`return (async () => {
    const assets = await window.api.queryAssets({ limit: 2000 })
    const mine = assets.filter((a) => a.name.startsWith('lumen-perf-${stamp}'))
    const ids = mine.map((a) => a.id)
    if (ids.length > 0) await window.api.deleteAssets(ids, false)
    return { found: mine.length, deleted: ids.length }
  })()`)
  const rmOk = rmTempDir(tmpDir)
  check('⑬清理(白板删除+素材软删+临时目录)', cleaned.deleted === cleaned.found && rmOk, `软删 ${cleaned.deleted} 条; tmp=${rmOk}`)

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
