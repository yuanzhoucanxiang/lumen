/* 里程碑 253：白板剪贴板优先级修复。
   ① 板内 Ctrl+C 复制后，系统剪贴板带白板标记（isBoardCopy=true）；
   ② 外部复制的图片（无标记）即使板内剪贴板有内容，也应优先导入上板，而不是粘出旧元素；
   ③ 外部图片命中库内已有素材时，也要把这张图放上板（而不是毫无反应）；
   ④ 板内 Ctrl+C/V 仍然正常复制元素。
   夹具：sharp 生成 1 张随机色 PNG，经 clip /import 导「Agent 导入/itest-paste-<n>」；
   结束时删除本次新增的画布元素、素材与文件夹。
   前置：npm run dev -- --remote-debugging-port=9333
   运行：node .ui-shot/itest-board-paste.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sharp = require('sharp')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CLIP_PORT = Number(process.env.LUMEN_CLIP_PORT) || 45678

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(JSON.parse(body)))
      })
      .on('error', reject)
  })
}

function rawRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: CLIP_PORT, path: urlPath, method, agent: false,
        headers: { 'x-lumen-client': 'lumen-clip/1', 'Content-Length': Buffer.byteLength(body || '') } },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(d) } catch { return null } })(), raw: d }))
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function main() {
  // ---------- 0. CDP 连接（先于导入：全量回归下前序套件会改 Agent 可写范围） ----------
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主渲染进程页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })

  let nextId = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const run = (expr) =>
    send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    }).then((r) => {
      const payload = r.result
      if (payload?.exceptionDetails) {
        throw new Error('EVAL: ' + (payload.exceptionDetails.exception?.description || payload.exceptionDetails.text))
      }
      return payload?.result?.value
    })
  const key = async (k, code, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
  }

  const prevScope = await run(`return { u: (await window.api.getSettings()).agentScopeUnrestricted ?? false }`)
  await run(`await window.api.updateSettings({ agentScopeUnrestricted: true })`)

  // ---------- 0b. 夹具：A 用作画布元素，B 用作"外部剪贴板图片" ----------
  const tag = `paste-${Date.now().toString(36)}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lumen-${tag}-`))
  const files = []
  for (const name of ['a', 'b']) {
    const f = path.join(dir, `${tag}-${name}.png`)
    await sharp({ create: { width: 240 + (name === 'b' ? 24 : 0), height: 180, channels: 3,
      background: { r: 30 + Math.floor(Math.random() * 200), g: 30 + Math.floor(Math.random() * 200), b: 30 + Math.floor(Math.random() * 200), alpha: 1 } } })
      .png()
      .toFile(f)
    files.push(f)
  }
  const imp = await rawRequest('POST', '/import', JSON.stringify({ paths: [dir], folder: `Agent 导入/${tag}` }))
  if (imp.status !== 200 || (imp.json?.importedIds ?? []).length !== 2) {
    throw new Error(`夹具导入失败: status=${imp.status} body=${imp.raw.slice(0, 180)}`)
  }
  const [fixtureA, fixtureB] = imp.json.importedIds
  const folderId = (((await rawRequest('GET', '/folders')).json?.folders ?? []).find((f) => f.name === tag) || {}).id
  console.log(`夹具就绪: A=${fixtureA} B=${fixtureB}`)

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    ok ? pass++ : fail++
  }
  async function waitFor(expr, timeout = 6000, interval = 250) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const v = await run(expr).catch(() => null)
      if (v) return v
      await sleep(interval)
    }
    return null
  }

  /** 外部粘贴新增元素引用的素材（清理时只删这些非夹具的新素材） */
  let externalAdded = null
  /** 本次测试用的独立白板（结束时整块删除，不碰用户白板） */
  let boardId = null

  try {
    await send('Page.bringToFront')
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(600)
    await send('Page.bringToFront')

    // ---------- 1. 独立测试板：新建 → 预置一个元素 → 重载 → 进白板并切到该板 ----------
    // 与 board-tools 同一套可靠路径（API 直加元素后必须重载，画布才从 DB 重建）
    const board = await run(`
      const bs = await window.api.listBoards()
      for (const b of bs) if (b.name.startsWith('itest-paste')) await window.api.deleteBoard(b.id)
      const b = await window.api.createBoard('itest-paste-${Date.now()}')
      await window.api.addBoardItem(b.id, { assetId: ${JSON.stringify(fixtureA)}, type: 'asset', x: 80, y: 80, width: 200, height: 150 })
      return b
    `)
    boardId = board.id
    await run(`location.reload()`).catch(() => undefined)
    let ready = false
    for (let i = 0; i < 60; i++) {
      await sleep(400)
      ready = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`).catch(() => false)
      if (ready) break
    }
    check('应用重载后就绪', ready, `boardId=${boardId}`)
    if (!ready) throw new Error('重载后未就绪')
    const frameOk = await run(`
      const exit = document.querySelector('button[aria-label="退出白板"]')
      if (exit) { exit.click(); await new Promise((r) => setTimeout(r, 300)) }
      document.querySelector('nav[aria-label="素材库导航"] button[aria-label="白板"]').click()
      await new Promise((r) => setTimeout(r, 500))
      const sel = document.querySelector('select[aria-label="切换白板"]')
      if (!sel) throw new Error('找不到白板切换器')
      sel.value = ${boardId}
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 600))
      return !!document.querySelector('[data-board-frame]')
    `)
    check('进入测试白板', frameOk === true, `frame=${frameOk}`)
    if (!frameOk) throw new Error('未能进入测试白板')
    const items = await run(`return await window.api.listBoardItems(${boardId})`)
    check('测试白板就绪且有元素可复制', items.length === 1, `items=${items.length}`)
    if (items.length !== 1) throw new Error('测试白板元素数量异常')

    // 选中唯一元素（画布坐标点选）
    const picked = await run(`
      const it = (await window.api.listBoardItems(${boardId}))[0]
      const el = document.querySelector('[data-board-item="' + it.id + '"]')
      if (!el) return { err: '元素不在 DOM' }
      const b = el.getBoundingClientRect()
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, pointerId: 31, isPrimary: true }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, pointerId: 31, isPrimary: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }))
      await new Promise((r) => setTimeout(r, 250))
      return { id: it.id, assetId: it.assetId }
    `)
    check('选中画布元素', !picked.err, JSON.stringify(picked))
    if (picked.err) throw new Error(picked.err)

    // ---------- 2. 板内 Ctrl+C：写出的图片（透明 PNG，2x 选区）可粘到外部，且被识别为白板来源 ----------
    await key('c', 'KeyC', 67, 2)
    // 等"本次复制"真正落地：尺寸必须是 2x 选区。只等"有带标记的图"不够——
    // 全量回归时上一套件可能已留下同样带标记的旧板内剪贴板，会让断言拿到旧图（1×1 假失败）
    const clipImage = await waitFor(`
      const dataUrl = await window.api.readClipboardImage()
      if (!dataUrl) return false
      const size = await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => resolve({ w: 0, h: 0 })
        img.src = dataUrl
      })
      if (!(size.w >= 380 && size.w <= 440 && size.h >= 280 && size.h <= 340)) return false
      return { isPng: dataUrl.startsWith('data:image/png'), bytes: dataUrl.length, ...size }
    `, 8000)
    check('板内复制写出的图片可粘到外部(2x 选区尺寸)', !!clipImage && clipImage.isPng, JSON.stringify(clipImage))
    const marked = await run(`const i = await window.api.readClipboardImageInfo(); return i`)
    check('板内复制被识别为白板来源', marked.hasImage === true && marked.isBoardCopy === true, JSON.stringify(marked))

    // ---------- 3. 外部图片优先级：内部剪贴板有内容时也应导入上板 ----------
    // 等过"刚复制"窗口（1.2s），再用 copyImage 把库里另一张图写成无标记的外部剪贴板内容
    await sleep(1400)
    const beforeExternal = await run(`return (await window.api.listBoardItems(${boardId})).map((i) => i.id)`)
    await run(`await window.api.copyImage(${JSON.stringify(fixtureB)})`)
    const infoExternal = await run(`const i = await window.api.readClipboardImageInfo(); return i`)
    check('外部剪贴板图片无白板标记', infoExternal.hasImage === true && infoExternal.isBoardCopy === false, JSON.stringify(infoExternal))
    await key('v', 'KeyV', 86, 2)
    externalAdded = await waitFor(`
      const items = await window.api.listBoardItems(${boardId})
      const fresh = items.filter((i) => !${JSON.stringify(beforeExternal)}.includes(i.id))
      return fresh.length > 0 ? fresh.map((i) => i.assetId) : false
    `, 6000)
    // 判定"外部赢了"：新元素不能是刚复制的那个板内元素（内部粘贴会复制 picked.assetId）；
    // 剪贴板导入会重新编码 PNG，assetId 可能是新导入的，所以只排除"等于板内元素"这一种
    check(
      '外部图片优先于板内旧剪贴板上板',
      !!externalAdded && externalAdded.length > 0 && !externalAdded.includes(picked.assetId),
      JSON.stringify({ added: externalAdded, picked: picked.assetId, fixtureB })
    )

    // ---------- 4. 板内复制粘贴仍正常 ----------
    await sleep(1300)
    const beforeInternal = await run(`return (await window.api.listBoardItems(${boardId})).map((i) => i.id)`)
    await run(`
      const it = (await window.api.listBoardItems(${boardId}))[0]
      const el = document.querySelector('[data-board-item="' + it.id + '"]')
      const b = el.getBoundingClientRect()
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, pointerId: 32, isPrimary: true }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, pointerId: 32, isPrimary: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }))
      await new Promise((r) => setTimeout(r, 200))
      return true
    `)
    await key('c', 'KeyC', 67, 2)
    await sleep(600)
    await key('v', 'KeyV', 86, 2)
    const internalAdded = await waitFor(`
      const items = await window.api.listBoardItems(${boardId})
      return items.length > ${beforeInternal.length} ? items.length : false
    `, 5000)
    check('板内 Ctrl+C/V 仍复制元素', !!internalAdded, `before=${beforeInternal.length} after=${internalAdded}`)
  } finally {
    // ---------- 5. 清理：整块删除测试白板 + 夹具素材/文件夹 + 范围还原 ----------
    try {
      if (boardId != null) await run(`await window.api.deleteBoard(${boardId})`)
      await run(`await window.api.updateSettings({ agentScopeUnrestricted: ${prevScope ? prevScope.u : false} })`)
      // 剪贴板导入会把图片重新编码，可能生成新素材（hash 与 B 不同）：只删本次外部粘贴带来的新素材
      const extraAssets = Array.from(new Set(externalAdded ?? []))
        .filter((id) => id !== fixtureA && id !== fixtureB)
      if (extraAssets.length > 0) await run(`await window.api.deleteAssets(${JSON.stringify(extraAssets)}, true)`)
      await run(`await window.api.deleteAssets([${JSON.stringify(fixtureA)}, ${JSON.stringify(fixtureB)}], true)`)
      if (Number.isInteger(folderId)) await run(`await window.api.deleteFolder(${folderId})`)
      await run(`
        const exit = document.querySelector('button[aria-label="退出白板"]')
        if (exit) { exit.click(); await new Promise((r) => setTimeout(r, 400)) }
        return true
      `)
      fs.rmSync(dir, { recursive: true, force: true })
      console.log('夹具已清理')
    } catch (e) {
      console.log('清理失败(需手动删):', e.message)
    }
  }

  await send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)
  ws.close()
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
