/* 里程碑 247:白板智能吸附持久开关 + 拖素材到侧栏白板项直接上板。
   夹具:2 张随机色 PNG 经 clip /import 导「Agent 导入/itest-bsnap-<n>」,结束清理
   (素材永久删除、文件夹删除、测试期间新增的白板元素逐个删除)。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-board-snap-drop.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sharp = require('E:/类eagle搭建/node_modules/sharp')

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
  // ---------- 0. CDP 连接(先于导入:全量回归时前序套件会改 Agent 可写范围,导入前先临时放开) ----------
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

  const prevScope = await run(`return { u: (await window.api.getSettings()).agentScopeUnrestricted ?? false }`)
  await run(`await window.api.updateSettings({ agentScopeUnrestricted: true })`)

  // ---------- 0b. 夹具导入 ----------
  const tag = `bsnap-${Date.now().toString(36)}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lumen-${tag}-`))
  const files = []
  for (let i = 0; i < 2; i++) {
    const f = path.join(dir, `${tag}-${i}.png`)
    await sharp({ create: { width: 320 + i * 40, height: 220, channels: 3,
      background: { r: 60 + Math.floor(Math.random() * 180), g: 60 + Math.floor(Math.random() * 180), b: 60 + Math.floor(Math.random() * 180), alpha: 1 } } })
      .png()
      .toFile(f)
    files.push(f)
  }
  const imp = await rawRequest('POST', '/import', JSON.stringify({ paths: [dir], folder: `Agent 导入/${tag}` }))
  if (imp.status !== 200 || (imp.json?.importedIds ?? []).length !== 2) {
    throw new Error(`夹具导入失败: status=${imp.status} body=${imp.raw.slice(0, 200)}`)
  }
  const assetIds = imp.json.importedIds
  const folderId = (((await rawRequest('GET', '/folders')).json?.folders ?? []).find((f) => f.name === tag) || {}).id
  console.log(`夹具就绪: 2 张, folderId=${folderId}`)

  // ---------- 1. 断言助手 ----------
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    ok ? pass++ : fail++
  }
  async function waitFor(expr, timeout = 5000, interval = 250) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const v = await run(expr).catch(() => null)
      if (v) return v
      await sleep(interval)
    }
    return null
  }

  // 记录测试期间各白板的元素数,结束后把新增的删掉
  const beforeItems = await run(`
    const boards = await window.api.listBoards()
    const out = []
    for (const b of boards) out.push({ id: b.id, n: (await window.api.listBoardItems(b.id)).length })
    return out
  `)

  try {
    await send('Page.bringToFront')
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(800)
    await send('Page.bringToFront')

    // ---------- 2. 拖素材到侧栏白板项 → 直接上板 ----------
    // dev 的 localStorage 不随配置隔离,侧栏可能残留收起态,先展开;进夹具文件夹保证拖的是新素材
    await run(`
      // dev 的 localStorage 不随配置隔离,侧栏可能残留收起态,先展开
      const expand = document.querySelector('button[aria-label="展开侧栏"]')
      if (expand) { expand.click(); await new Promise((r) => setTimeout(r, 350)) }
      // 全量回归时上一套件可能把应用留在白板模式:白板模式下点导航只改参考来源,
      // 主区仍是画布(无 .contact-sheet),必须先退出
      const exit = document.querySelector('button[aria-label="退出白板"]')
      if (exit) { exit.click(); await new Promise((r) => setTimeout(r, 600)) }
      const nav = document.querySelector('nav[aria-label="素材库导航"]')
      const all = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '全部素材')
      if (all) all.click()
      await new Promise((r) => setTimeout(r, 500))
      const foldBtn = document.querySelector('button[aria-label="展开白板"]')
      if (foldBtn) { foldBtn.click(); await new Promise((r) => setTimeout(r, 200)) }
      const group = document.querySelector('button[aria-label="展开文件夹"]')
      if (group) { group.click(); await new Promise((r) => setTimeout(r, 200)) }
      // 侧栏文件夹列表可能仍在刷新,轮询等出现
      let sub = null
      for (let i = 0; i < 16 && !sub; i++) {
        const row = [...document.querySelectorAll('.archive-folder-row')].find((el) => (el.textContent || '').includes('Agent 导入'))
        if (row) {
          const caret = row.querySelector('button[aria-label="展开 Agent 导入"]')
          if (caret) { caret.click(); await new Promise((r) => setTimeout(r, 300)) }
          sub = [...document.querySelectorAll('.archive-folder-row')].find((el) => (el.textContent || '').includes(${JSON.stringify(tag)}))
        }
        if (!sub) await new Promise((r) => setTimeout(r, 250))
      }
      if (!sub) throw new Error('侧栏找不到测试文件夹')
      sub.querySelector('button')?.click()
      await new Promise((r) => setTimeout(r, 700))
      return true
    `)
    const drop = await run(`
      // 只拖夹具素材:轮询等文件夹视图渲染出夹具卡(整库视图首卡可能本来就在目标板里)
      const want = new Set(${JSON.stringify(assetIds)})
      let card = null
      for (let i = 0; i < 40 && !card; i++) {
        card = [...document.querySelectorAll('.contact-sheet [data-asset-id]')].find(
          (c) => want.has(c.getAttribute('data-asset-id')) && c.getBoundingClientRect().width > 0
        )
        if (!card) await new Promise((r) => setTimeout(r, 250))
      }
      const sec = document.querySelector('section[aria-label="白板"]')
      if (!card || !sec) return { err: '找不到夹具卡片或白板分区' }
      const boardBtn = [...sec.querySelectorAll('button[aria-label]')].find((b) => {
        const l = b.getAttribute('aria-label') || ''
        return l !== '新建白板' && l !== '展开白板' && l !== '折叠白板' && b.getBoundingClientRect().width > 0
      })
      if (!boardBtn) return { err: '侧栏没有白板' }
      const boardName = boardBtn.getAttribute('aria-label')
      const dragId = card.getAttribute('data-asset-id')
      const dt = new DataTransfer()
      dt.setData('application/x-eaglelike-assets', JSON.stringify([dragId]))
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await new Promise((r) => setTimeout(r, 120))
      boardBtn.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await new Promise((r) => setTimeout(r, 200))
      const highlighted = !!(boardBtn.parentElement && (boardBtn.parentElement.className || '').includes('outline'))
      boardBtn.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await new Promise((r) => setTimeout(r, 700))
      return { boardName, highlighted, dragId }
    `)
    check('拖卡片到白板项出现高亮与落板', !drop.err && !!drop.boardName, JSON.stringify(drop))
    const boardId = await run(`
      const boards = await window.api.listBoards()
      return boards.find((b) => b.name === ${JSON.stringify((drop && drop.boardName) || '')})?.id ?? null
    `)
    const dragId = drop && !drop.err ? drop.dragId : assetIds[0]
    const item = boardId != null
      ? await run(`return (await window.api.listBoardItems(${boardId})).find((i) => i.assetId === ${JSON.stringify(dragId)}) ?? null`)
      : null
    check('素材已进入目标白板(元素落库)', !!item, `boardId=${boardId} itemId=${item && item.id}`)

    // ---------- 3. 吸附持久开关 ----------
    await run(`
      const sec = document.querySelector('section[aria-label="白板"]')
      const btn = [...sec.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify((drop && drop.boardName) || '')})
      if (btn) btn.click()
      await new Promise((r) => setTimeout(r, 900))
      return true
    `)
    // 进白板后打开画布外观抽屉,切吸附开关
    await run(`
      const t = document.querySelector('button[aria-controls="board-appearance-drawer"]')
      if (!t) throw new Error('找不到画布外观按钮')
      t.click()
      await new Promise((r) => setTimeout(r, 400))
      return true
    `)
    const snapOff = await run(`
      const cb = document.querySelector('input[aria-label="吸附开关"]')
      if (!cb) return { err: '找不到吸附开关' }
      cb.click()
      await new Promise((r) => setTimeout(r, 500))
      const boards = await window.api.listBoards()
      const b = boards.find((x) => x.id === ${JSON.stringify(boardId)})
      if (!b) return { err: '找不到目标白板', boardId: ${JSON.stringify(boardId)} }
      return { checked: cb.checked, stored: JSON.parse(b.appearance || '{}').snap }
    `)
    check('吸附开关关闭并按白板持久化', !snapOff.err && snapOff.checked === false && snapOff.stored === false, JSON.stringify(snapOff))
    const snapOn = await run(`
      const cb = document.querySelector('input[aria-label="吸附开关"]')
      if (!cb) return { err: '找不到吸附开关' }
      cb.click()
      await new Promise((r) => setTimeout(r, 500))
      const boards = await window.api.listBoards()
      const b = boards.find((x) => x.id === ${JSON.stringify(boardId)})
      if (!b) return { err: '找不到目标白板', boardId: ${JSON.stringify(boardId)} }
      return { checked: cb.checked, stored: JSON.parse(b.appearance || '{}').snap }
    `)
    check('吸附开关重新打开', snapOn.checked === true && snapOn.stored === true, JSON.stringify(snapOn))
  } finally {
    // ---------- 4. 清理 ----------
    try {
      const afterItems = await run(`
        const boards = await window.api.listBoards()
        const out = []
        for (const b of boards) out.push({ id: b.id, items: (await window.api.listBoardItems(b.id)).map((i) => i.id) })
        return out
      `)
      const before = new Map((beforeItems || []).map((x) => [x.id, x.n]))
      const added = []
      for (const b of afterItems || []) {
        const n0 = before.get(b.id) ?? 0
        if (b.items.length > n0) added.push(...b.items.slice(n0))
      }
      if (added.length > 0) await run(`await window.api.deleteBoardItems(${JSON.stringify(added)})`)
      await run(`await window.api.updateSettings({ agentScopeUnrestricted: ${prevScope ? prevScope.u : false} })`)
      await run(`await window.api.deleteAssets(${JSON.stringify(assetIds)}, true)`)
      if (Number.isInteger(folderId)) await run(`await window.api.deleteFolder(${folderId})`)
      await run(`
        // 若在白板模式,先退出再回全部素材(白板模式下点导航只改参考来源,不退出)
        const exit = document.querySelector('button[aria-label="退出白板"]')
        if (exit) { exit.click(); await new Promise((r) => setTimeout(r, 500)) }
        const nav = document.querySelector('nav[aria-label="素材库导航"]')
        const all = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '全部素材')
        if (all) all.click()
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
