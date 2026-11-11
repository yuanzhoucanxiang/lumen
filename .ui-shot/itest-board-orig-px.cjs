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

  /* ---------- 1. 建板并放入大、中、小三个素材 ---------- */
  await mainRun(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name === 'itest-原图像素') await window.api.deleteBoard(b.id)
  })()`)
  const board = await mainRun(`return window.api.createBoard('itest-原图像素')`)
  const boardId = board.id
  // 大素材:900px 宽 → 100% 缩放下渲染 900 > 512(缩略图长边),应切原图
  await mainRun(`window.api.addBoardItem(${boardId}, { assetId: ${JSON.stringify(asset.id)}, type: 'asset', x: 100, y: 100, width: 900, height: 380 })`)
  // 小素材:200px 宽 → 渲染 200 < 512,缩略图足够,不应切原图
  await mainRun(`window.api.addBoardItem(${boardId}, { assetId: ${JSON.stringify(asset.id)}, type: 'asset', x: 1100, y: 100, width: 200, height: 133 })`)
  // 中等素材:300px 宽 → DPR=1 时不切；DPR≥2 时设备像素 600 > 512，应切 LOD（高 DPI 回归）
  await mainRun(`window.api.addBoardItem(${boardId}, { assetId: ${JSON.stringify(asset.id)}, type: 'asset', x: 580, y: 500, width: 300, height: 140 })`)

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

  /* ---------- 3. 100% 缩放(scale=1)：大图切高清、小图保持缩略图、中等图按设备像素 ---------- */
  // 显式归位 scale=1；本机高 DPI（273% 缩放）下 300 CSS px 已占 600 设备像素
  await mainRun(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
  await sleep(400)
  const dpr = await mainRun(`return Math.min(2, Math.max(1, window.devicePixelRatio || 1))`)
  const at100 = await mainRun(`return (async () => {
    const items = [...document.querySelectorAll('[data-board-item]')]
    const byW = (el) => el.getBoundingClientRect().width
    const big = items.find((el) => byW(el) > 500)
    const small = items.find((el) => byW(el) < 300)
    const mid = items.find((el) => Math.abs(byW(el) - 300) < 1)
    const overlay = big?.querySelector('[data-board-orig]')
    const src = overlay?.getAttribute('src') ?? ''
    const lod = overlay?.getAttribute('data-board-lod') ?? ''
    let previewOk = false
    if (src) {
      try {
        const res = await fetch(src)
        previewOk = res.status === 200 && (await res.arrayBuffer()).byteLength > 0
      } catch {
        previewOk = false
      }
    }
    const midOverlay = mid?.querySelector('[data-board-orig]')
    return {
      total: items.length,
      bigOrig: !!overlay,
      smallOrig: !!small?.querySelector('[data-board-orig]'),
      bigLoaded: !!big?.querySelector('[data-board-orig][style*="opacity: 1"]'),
      bigW: big ? Math.round(byW(big)) : 0,
      smallW: small ? Math.round(byW(small)) : 0,
      midW: mid ? Math.round(byW(mid)) : 0,
      midOrig: !!midOverlay,
      midLod: midOverlay?.getAttribute('data-board-lod') ?? '',
      lod,
      previewOk,
      src
    }
  })()`)
  check('100% 缩放有 3 个素材', at100.total === 3 && at100.bigW > 500 && at100.smallW < 300 && at100.midW === 300, `bigW=${at100.bigW} smallW=${at100.smallW} midW=${at100.midW} total=${at100.total}`)
  check('大图(渲染>512)100% 缩放即切原图并淡入', at100.bigOrig && at100.bigLoaded, `bigOrig=${at100.bigOrig} loaded=${at100.bigLoaded}`)
  check('小图(渲染<512)100% 缩放保持缩略图', !at100.smallOrig, `smallOrig=${at100.smallOrig}`)
  check(
    '大图叠加层走多档预览(LOD)且请求 200',
    ['640', '1280', '2048', '3072', 'orig'].includes(at100.lod) && at100.previewOk === true,
    `lod=${at100.lod} previewOk=${at100.previewOk} src=${String(at100.src).slice(0, 60)}`
  )
  // DPR=1 时 300 CSS px < 512 设备像素（保持缩略图）；DPR≥2 时 600 设备像素应切 LOD
  check(
    '中等素材按设备像素触发 LOD（高 DPI）',
    dpr <= 1 ? at100.midOrig === false : at100.midOrig === true && at100.midLod !== '',
    `dpr=${dpr} midW=${at100.midW} midOrig=${at100.midOrig} midLod=${at100.midLod}`
  )

  /* ---------- 4. 缩小到设备像素 < 阈值下沿(滞回)后切回缩略图；再放大恢复 ---------- */
  // 每次 '-' ×0.8:需 900 * 0.8^n * DPR < 358，循环按压直到大图降到滞回下沿以下
  let shrinkBigW = 999
  for (let i = 0; i < 10; i++) {
    await mainRun(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))`)
    await sleep(350)
    shrinkBigW = await mainRun(`return (() => {
      const items = [...document.querySelectorAll('[data-board-item]')]
      const byW = (el) => el.getBoundingClientRect().width
      return items.length > 0 ? Math.round(Math.max(...items.map(byW))) : 0
    })()`)
    if (shrinkBigW * dpr < 358) break
  }
  const shrunk = await mainRun(`return document.querySelectorAll('[data-board-orig]').length`)
  check(
    '缩小到设备像素<358 后切回缩略图(高清层移除)',
    shrunk === 0 && shrinkBigW * dpr < 358,
    `bigW=${shrinkBigW} dpr=${dpr} orig=${shrunk}`
  )
  // 放大回高清:循环 '+' 直到大图渲染超过 512 设备像素
  let growOrig = 0
  for (let i = 0; i < 10; i++) {
    await mainRun(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))`)
    await sleep(350)
    growOrig = await mainRun(`return document.querySelectorAll('[data-board-orig]').length`)
    if (growOrig > 0) break
  }
  check('再放大回高清(>512 设备像素恢复)', growOrig > 0, `orig=${growOrig} dpr=${dpr}`)

  /* ---------- 5. GIF 回退原图：不生成 LOD 档（保留动画），白板仍能放大清晰 ---------- */
  const gifAsset = await mainRun(`return (async () => {
    const all = await window.api.queryAssets({ limit: 2000 })
    return all.filter((a) => a.ext === 'gif' && a.width > 0 && !a.deletedAt).sort((a, b) => a.size - b.size)[0] ?? null
  })()`)
  let gifBoardId = null
  if (gifAsset) {
    await mainRun(`(async () => {
      const bs = await window.api.listBoards()
      for (const b of bs) if (b.name === 'itest-LOD-动图') await window.api.deleteBoard(b.id)
    })()`)
    const gifBoard = await mainRun(`return window.api.createBoard('itest-LOD-动图')`)
    gifBoardId = gifBoard.id
    await mainRun(`window.api.addBoardItem(${gifBoardId}, { assetId: ${JSON.stringify(gifAsset.id)}, type: 'asset', x: 100, y: 100, width: 900, height: 600 })`)
  } else {
    console.log('  SKIP GIF 回退原图 — 库内没有 GIF 素材')
  }

  /* ---------- 6. 素材多且相隔远：平移到远处素材仍恢复 LOD（里程碑 242 回归） ----------
     此前高清候选遍历全量 boardItems 且只留 32 个，屏幕外元素占满名额后，
     平移到远处素材即使渲染尺寸足够也拿不到高清叠加层。 */
  await mainRun(`(async () => {
    const bs = await window.api.listBoards()
    for (const b of bs) if (b.name === 'itest-LOD-远端') await window.api.deleteBoard(b.id)
  })()`)
  const farBoard = await mainRun(`return window.api.createBoard('itest-LOD-远端')`)
  const farBoardId = farBoard.id
  await mainRun(`(async () => {
    const items = []
    for (let i = 0; i < 40; i++) {
      items.push({ assetId: ${JSON.stringify(asset.id)}, type: 'asset', x: 100 + i * 1500, y: 100, width: 900, height: 600 })
    }
    await window.api.addBoardItems(${farBoardId}, items)
    return true
  })()`)
  const farItems = await mainRun(`return window.api.listBoardItems(${farBoardId})`)
  const farTarget = farItems[farItems.length - 1]
  await mainRun(`location.reload()`)
  ready = false
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    ready = await mainRun(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (ready) break
  }
  if (ready) {
    await mainRun(`(() => {
      const btn = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]')
      btn.click()
    })()`)
    await sleep(500)
    await mainRun(`(() => {
      const sel = document.querySelector('select[aria-label="切换白板"]')
      sel.value = ${farBoardId}
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await sleep(1000)
    await mainRun(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
    await sleep(500)
    // 中键拖拽平移到最远的一件（画布 40 件、间距 1500px）
    const dx = -(farTarget.x - 100)
    await mainRun(`(() => {
      const frame = document.querySelector('[data-board-frame]')
      const opt = { bubbles: true, cancelable: true, pointerId: 88, pointerType: 'mouse', button: 1, buttons: 4 }
      frame.dispatchEvent(new PointerEvent('pointerdown', { ...opt, clientX: 700, clientY: 500 }))
      frame.dispatchEvent(new PointerEvent('pointermove', { ...opt, clientX: 700 + ${dx}, clientY: 500 }))
      frame.dispatchEvent(new PointerEvent('pointerup', { ...opt, clientX: 700 + ${dx}, clientY: 500, buttons: 0 }))
      return true
    })()`)
    await sleep(1200)
  }
  const far = ready
    ? await mainRun(`return (async () => {
        const target = document.querySelector('[data-board-item="${farTarget.id}"]')
        const overlay = target?.querySelector('[data-board-orig]')
        const src = overlay?.getAttribute('src') ?? ''
        let previewOk = false
        if (src) {
          try {
            const res = await fetch(src)
            previewOk = res.status === 200 && (await res.arrayBuffer()).byteLength > 0
          } catch {
            previewOk = false
          }
        }
        return {
          inDom: !!target,
          w: target ? Math.round(target.getBoundingClientRect().width) : 0,
          orig: !!overlay,
          lod: overlay?.getAttribute('data-board-lod') ?? '',
          previewOk
        }
      })()`)
    : { inDom: false, w: 0, orig: false, lod: '', previewOk: false }
  check('多素材相隔远：平移到远处素材(渲染>512)', far.inDom && far.w > 500, `inDom=${far.inDom} w=${far.w}`)
  check(
    '多素材相隔远：远处素材仍挂载 LOD 高清层且请求 200',
    far.orig && ['640', '1280', '2048', '3072', 'orig'].includes(far.lod) && far.previewOk === true,
    `orig=${far.orig} lod=${far.lod} previewOk=${far.previewOk}`
  )
  await mainRun(`await window.api.deleteBoard(${farBoardId})`)

  if (gifBoardId) {
    await mainRun(`(() => {
      const sel = document.querySelector('select[aria-label="切换白板"]')
      sel.value = ${gifBoardId}
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await sleep(1000)
    await mainRun(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
    await sleep(500)
    const gif = await mainRun(`return (async () => {
      const overlay = document.querySelector('[data-board-orig]')
      const src = overlay?.getAttribute('src') ?? ''
      let previewOk = false
      if (src) {
        try {
          const res = await fetch(src)
          previewOk = res.status === 200 && (await res.arrayBuffer()).byteLength > 0
        } catch {
          previewOk = false
        }
      }
      return { orig: !!overlay, lod: overlay?.getAttribute('data-board-lod') ?? '', src, previewOk }
    })()`)
    check(
      'GIF 大图回退原图（不请求不存在的 LOD 档）',
      gif.orig && gif.lod === 'orig' && String(gif.src).includes('t=o') && gif.previewOk === true,
      `orig=${gif.orig} lod=${gif.lod} previewOk=${gif.previewOk} src=${String(gif.src).slice(0, 60)}`
    )
    await mainRun(`await window.api.deleteBoard(${gifBoardId})`)
  }

  /* ---------- 7. 富剪贴板：选区图片可写入系统剪贴板（里程碑 222） ---------- */
  const copyOk = await mainRun(`return window.api.copyBoardImage(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  )`)
  check('白板选区图片可写系统剪贴板', copyOk === true, `ok=${copyOk}`)

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
