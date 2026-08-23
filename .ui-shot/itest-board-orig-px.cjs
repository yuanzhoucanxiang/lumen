/* 白板原图切换像素判据专项验证（里程碑 113 方案改进）
   前置：npm run dev -- --remote-debugging-port=9333
   运行：node .ui-shot/itest-board-orig-px.cjs
   背景：原图切换原按整体缩放阈值（≥1.25 才换原图），100% 缩放下渲染超 512px 的素材
   仍是放大的缩略图（模糊），必须放大才清晰。改为逐项像素判据：渲染长边 >512px
   （缩略图长边上限）即切原图。本测试独立白板,结束删除。 */
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

  // 找库内可被浏览器解码且带尺寸的素材（原图叠加依赖 asset.width>0 与扩展名白名单）
  const asset = await mainRun(`return (async () => {
    const all = await window.api.queryAssets({ limit: 1000 })
    const whitelist = ['jpg','jpeg','png','webp','bmp','avif','tiff','tif','svg']
    return all.find((a) => a.width > 0 && whitelist.includes(a.ext) && !a.deletedAt) ?? null
  })()`)
  if (!asset) throw new Error('库内没有可用素材（需要任一有尺寸的图片素材）')

  /* ---------- 1. 建板并放入一大一小两个素材 ---------- */
  await mainRun(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name === 'itest-原图像素') await window.api.deleteBoard(b.id)
  })()`)
  const board = await mainRun(`return window.api.createBoard('itest-原图像素')`)
  const boardId = board.id
  // 大素材:900px 宽 → 100% 缩放下渲染 900 > 512(缩略图长边),应切原图
  await mainRun(`window.api.addBoardItem(${boardId}, { assetId: ${JSON.stringify(asset.id)}, type: 'asset', x: 100, y: 100, width: 900, height: 600 })`)
  // 小素材:200px 宽 → 渲染 200 < 512,缩略图足够,不应切原图
  await mainRun(`window.api.addBoardItem(${boardId}, { assetId: ${JSON.stringify(asset.id)}, type: 'asset', x: 1100, y: 100, width: 200, height: 133 })`)

  /* ---------- 2. 重载进入白板模式(store 需从 DB 拉取 boardItems) ---------- */
  await mainRun(`location.reload()`)
  let ready = false
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    ready = await mainRun(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (ready) break
  }
  check('主窗口就绪', ready, `boardId=${boardId}`)
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
  await sleep(800)

  /* ---------- 3. 100% 缩放(scale=1)：大图切原图、小图保持缩略图 ---------- */
  // 显式归位 scale=1
  await mainRun(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
  await sleep(400)
  const at100 = await mainRun(`return (() => {
    const items = [...document.querySelectorAll('[data-board-item]')]
    const byW = (el) => el.getBoundingClientRect().width
    const big = items.find((el) => byW(el) > 500)
    const small = items.find((el) => byW(el) < 300)
    return {
      total: items.length,
      bigOrig: !!big?.querySelector('[data-board-orig]'),
      smallOrig: !!small?.querySelector('[data-board-orig]'),
      bigLoaded: !!big?.querySelector('[data-board-orig][style*="opacity: 1"]'),
      bigW: big ? Math.round(byW(big)) : 0,
      smallW: small ? Math.round(byW(small)) : 0
    }
  })()`)
  check('100% 缩放有 2 个素材', at100.total === 2 && at100.bigW > 500 && at100.smallW < 300, `bigW=${at100.bigW} smallW=${at100.smallW} total=${at100.total}`)
  check('大图(渲染>512)100% 缩放即切原图并淡入', at100.bigOrig && at100.bigLoaded, `bigOrig=${at100.bigOrig} loaded=${at100.bigLoaded}`)
  check('小图(渲染<512)100% 缩放保持缩略图', !at100.smallOrig, `smallOrig=${at100.smallOrig}`)

  /* ---------- 4. 缩小到渲染 < 阈值下沿(滞回)后切回缩略图；再放大回原图 ---------- */
  // 每次 '-' ×0.8:需 900 * 0.8^n < 358(n>4),循环按压直到大图渲染降到滞回下沿以下
  let shrinkBigW = 999
  for (let i = 0; i < 8; i++) {
    await mainRun(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))`)
    await sleep(350)
    shrinkBigW = await mainRun(`return (() => {
      const items = [...document.querySelectorAll('[data-board-item]')]
      const byW = (el) => el.getBoundingClientRect().width
      const big = items.find((el) => byW(el) > 300)
      return big ? Math.round(byW(big)) : 0
    })()`)
    if (shrinkBigW < 358) break
  }
  const shrunk = await mainRun(`return document.querySelectorAll('[data-board-orig]').length`)
  check('缩小到渲染<358 后切回缩略图(原图层移除)', shrunk === 0 && shrinkBigW < 358, `bigW=${shrinkBigW} orig=${shrunk}`)
  // 放大回原图:循环 '+' 直到大图渲染 > 512
  let growOrig = 0
  for (let i = 0; i < 8; i++) {
    await mainRun(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))`)
    await sleep(350)
    growOrig = await mainRun(`return document.querySelectorAll('[data-board-orig]').length`)
    if (growOrig > 0) break
  }
  check('再放大回原图(>512 恢复)', growOrig > 0, `orig=${growOrig}`)

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
