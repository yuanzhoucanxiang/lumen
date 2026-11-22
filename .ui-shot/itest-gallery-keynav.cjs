/* 里程碑 246:图库键盘导航——方向键网格/瀑布流感知移动、Shift 扩选、
   0-5 评分(0 清星、多选批量)、预览 Space 开关。
   夹具:sharp 生成 12 张随机色 PNG,经 clip /import 导入「Agent 导入/itest-keynav-<n>」,
   结束时永久删除素材并删除文件夹。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-gallery-keynav.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
// 用项目 node_modules 里的 sharp（相对解析：脚本在 .ui-shot/，向上找到根 node_modules）
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

/** node 直发 clip HTTP(带鉴权头,绕开 CORS) */
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
  // ---------- 0. CDP 连接(先于导入:全量回归时,前序套件会改 Agent 可写范围配置,
  //              夹具导入须先临时放开,结束后还原,避免 403) ----------
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

  // ---------- 0b. 生成夹具并导入 ----------
  const prevScope = await run(`return { u: (await window.api.getSettings()).agentScopeUnrestricted ?? false }`)
  await run(`await window.api.updateSettings({ agentScopeUnrestricted: true })`)
  const tag = `keynav-${Date.now().toString(36)}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lumen-${tag}-`))
  const ids = []
  for (let i = 0; i < 12; i++) {
    const f = path.join(dir, `${tag}-${String(i).padStart(2, '0')}.png`)
    const r = 40 + Math.floor(Math.random() * 200)
    const g = 40 + Math.floor(Math.random() * 200)
    const b = 40 + Math.floor(Math.random() * 200)
    await sharp({ create: { width: 300 + i * 8, height: 210 + (i % 5) * 12, channels: 3, background: { r, g, b, alpha: 1 } } })
      .png()
      .toFile(f)
    ids.push(f)
  }
  const imp = await rawRequest('POST', '/import', JSON.stringify({ paths: [dir], folder: `Agent 导入/${tag}` }))
  if (imp.status !== 200 || (imp.json?.importedIds ?? []).length !== 12) {
    throw new Error(`夹具导入失败: status=${imp.status} body=${imp.raw.slice(0, 200)}`)
  }
  const assetIds = imp.json.importedIds
  const folders = (await rawRequest('GET', '/folders')).json?.folders ?? []
  const folderId = folders.find((f) => f.name === tag)?.id
  console.log(`夹具就绪: 12 张, folderId=${folderId}`)

  // ---------- 1. 断言助手 ----------
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    ok ? pass++ : fail++
  }

  /** 轮询直到 evalJs 返回真(默认 5s) */
  async function waitFor(expr, timeout = 5000, interval = 250) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const v = await run(expr).catch(() => null)
      if (v) return v
      await sleep(interval)
    }
    return null
  }

  try {
    await send('Page.bringToFront')
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(800)
    await send('Page.bringToFront')

    // ---------- 2. 进入夹具文件夹视图 ----------
    await run(`
      // 全量回归时上一套件可能把应用留在白板模式:白板模式下点导航只改参考来源,主区仍是画布,必须先退出
      const exit = document.querySelector('button[aria-label="退出白板"]')
      if (exit) { exit.click(); await new Promise((r) => setTimeout(r, 600)) }
      const nav = document.querySelector('nav[aria-label="素材库导航"]')
      const all = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '全部素材')
      if (all) all.click()
      await new Promise((r) => setTimeout(r, 400))
      return true
    `)
    // 展开父夹「Agent 导入」露出子夹(文件夹树默认全折叠;
    // dev 的 localStorage 不随配置隔离,侧栏可能残留收起态,先确保展开)
    await run(`
      const expand = document.querySelector('button[aria-label="展开侧栏"]')
      if (expand) { expand.click(); await new Promise((r) => setTimeout(r, 350)) }
      const group = document.querySelector('button[aria-label="展开文件夹"]')
      if (group) { group.click(); await new Promise((r) => setTimeout(r, 200)) }
      return true
    `)
    const expanded = await waitFor(`
      const row = [...document.querySelectorAll('.archive-folder-row')]
        .find((el) => (el.textContent || '').includes('Agent 导入'))
      if (!row) return false
      const caret = row.querySelector('button[aria-label="展开 Agent 导入"]')
      if (caret) { caret.click(); return 'clicked' }
      return [...row.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === '折叠 Agent 导入')
    `)
    if (!expanded) throw new Error('找不到「Agent 导入」文件夹行')
    await sleep(300)
    const navOk = await waitFor(`
      const row = [...document.querySelectorAll('.archive-folder-row')]
        .find((el) => (el.textContent || '').includes(${JSON.stringify(tag)}))
      if (!row) return false
      const btn = row.querySelector('button')
      if (!btn) return false
      btn.click()
      return true
    `)
    if (!navOk) throw new Error('侧栏找不到测试文件夹')
    // 等夹具卡片就绪(12 张都在一个视图里)
    const ready = await waitFor(`return document.querySelectorAll('.contact-sheet [role="button"][aria-pressed]').length >= 12`, 6000)
    if (!ready) throw new Error('夹具视图未就绪')

    // ---------- 3. 网格布局:方向键列感知 ----------
    await run(`document.querySelector('button[aria-label="网格"]').click(); await new Promise((r) => setTimeout(r, 400)); return true`)
    const grid = await run(`
      const cards = [...document.querySelectorAll('.contact-sheet [role="button"][aria-pressed]')].filter((c) => c.getBoundingClientRect().width > 0)
      if (cards.length < 6) return { err: '可见卡片不足' }
      const r0 = cards[0].getBoundingClientRect()
      const cols = cards.filter((c) => Math.abs(c.getBoundingClientRect().top - r0.top) < 4).length
      return { n: cards.length, cols }
    `)
    check('网格布局就绪且列数可测', !grid.err && grid.cols >= 2 && grid.cols <= 6, JSON.stringify(grid))
    if (grid.err) throw new Error(grid.err)
    const cols = grid.cols

    // ArrowRight(无选中)→ 第一张
    await key('ArrowRight', 'ArrowRight', 39)
    await sleep(200)
    const afterRight = await run(`
      const cards = [...document.querySelectorAll('.contact-sheet [role="button"][aria-pressed]')].filter((c) => c.getBoundingClientRect().width > 0)
      const sel = cards.filter((c) => c.getAttribute('aria-pressed') === 'true')
      return { count: sel.length, first: sel.length === 1 && sel[0] === cards[0] }
    `)
    check('ArrowRight 从无选中移动到第一张', afterRight.count === 1 && afterRight.first, JSON.stringify(afterRight))

    // ArrowDown → 同列下一行(平铺索引 +cols)
    await key('ArrowDown', 'ArrowDown', 40)
    await sleep(200)
    const afterDown = await run(`
      const cards = [...document.querySelectorAll('.contact-sheet [role="button"][aria-pressed]')].filter((c) => c.getBoundingClientRect().width > 0)
      const sel = cards.filter((c) => c.getAttribute('aria-pressed') === 'true')
      return { idx: sel.length === 1 ? cards.indexOf(sel[0]) : -1, expect: ${cols} }
    `)
    check('网格 ArrowDown 跨到同列下一行', afterDown.idx === cols, JSON.stringify(afterDown))

    // Shift+ArrowDown → 从锚点扩选一整行(区间长 cols+1,首张不在内)
    await key('ArrowDown', 'ArrowDown', 40, 8)
    await sleep(250)
    const afterExtend = await run(`
      const cards = [...document.querySelectorAll('.contact-sheet [role="button"][aria-pressed]')].filter((c) => c.getBoundingClientRect().width > 0)
      const sel = cards.filter((c) => c.getAttribute('aria-pressed') === 'true')
      const idxs = sel.map((c) => cards.indexOf(c))
      return { count: sel.length, minIdx: Math.min(...idxs), maxIdx: Math.max(...idxs), expect: ${cols + 1} }
    `)
    check('Shift+ArrowDown 扩选区间(锚点到目标)', afterExtend.count === cols + 1 && afterExtend.minIdx === cols && afterExtend.maxIdx === 2 * cols, JSON.stringify(afterExtend))

    // ---------- 4. 多选批量打星 + 0 清星 ----------
    await key('4', 'Digit4', 52)
    const batchToast = await waitFor(`
      const t = document.querySelector('div[role="status"]')
      return t && t.textContent.includes('评 4 星') ? t.textContent : false
    `)
    check('多选打星出现批量 toast', !!batchToast, String(batchToast))
    await sleep(400)
    const starred = (await rawRequest('GET', `/assets?folder=${folderId}&limit=100`)).json?.assets ?? []
    const star4 = starred.filter((a) => a.star === 4).length
    check('批量打星落库(库内 4 星数=扩选数)', star4 === cols + 1, `star4=${star4} expect=${cols + 1}`)

    await key('Escape', 'Escape', 27)
    await sleep(250)
    // 移到一张 4 星素材上(网格:ArrowRight→flat[0] 无星,ArrowDown→flat[cols] 在扩选区间内是 4 星),0 清星
    await key('ArrowRight', 'ArrowRight', 39)
    await sleep(150)
    await key('ArrowDown', 'ArrowDown', 40)
    await sleep(150)
    await key('0', 'Digit0', 48)
    await sleep(400)
    const afterClear = (await rawRequest('GET', `/assets?folder=${folderId}&limit=100`)).json?.assets ?? []
    const star4After = afterClear.filter((a) => a.star === 4).length
    const star0 = afterClear.filter((a) => a.star === 0).length
    check('数字 0 清除星级', star4After === cols && star0 === 12 - cols, `star4=${star4After} star0=${star0}`)

    // ---------- 5. 预览 Space 开关 ----------
    const pvOpen = await run(`
      const card = [...document.querySelectorAll('.contact-sheet [role="button"][aria-pressed]')]
        .find((c) => c.getBoundingClientRect().width > 0)
      if (!card) return false
      card.focus()
      return true
    `)
    if (!pvOpen) throw new Error('找不到可聚焦卡片')
    await key(' ', 'Space', 32)
    await sleep(500)
    const pv1 = await run(`return !!document.querySelector('[role="dialog"][aria-label^="预览"]')`)
    check('Space 打开预览', !!pv1, `open=${pv1}`)
    await key(' ', 'Space', 32)
    await sleep(450)
    const pv2 = await run(`return !!document.querySelector('[role="dialog"][aria-label^="预览"]')`)
    check('Space 再按关闭预览(开关切换)', !pv2, `open=${pv2}`)

    // ---------- 6. 瀑布流:ArrowDown 留在同列 ----------
    await run(`document.querySelector('button[aria-label="瀑布流"]').click(); await new Promise((r) => setTimeout(r, 400)); return true`)
    await key('Escape', 'Escape', 27)
    await sleep(200)
    await key('ArrowRight', 'ArrowRight', 39)
    await sleep(200)
    await key('ArrowDown', 'ArrowDown', 40)
    await sleep(250)
    const masonry = await run(`
      const cards = [...document.querySelectorAll('.contact-sheet [role="button"][aria-pressed]')].filter((c) => c.getBoundingClientRect().width > 0)
      const sel = cards.filter((c) => c.getAttribute('aria-pressed') === 'true')
      if (sel.length !== 1) return { err: '选中数异常' }
      const r0 = cards[0].getBoundingClientRect()
      const r1 = sel[0].getBoundingClientRect()
      return { sameCol: Math.abs(r0.left - r1.left) < 4, movedDown: r1.top > r0.top + 10 }
    `)
    check('瀑布流 ArrowDown 留在同一列', !masonry.err && masonry.sameCol && masonry.movedDown, JSON.stringify(masonry))
  } finally {
    // ---------- 7. 清理夹具(永久删除 + 删文件夹 + 还原 Agent 范围) ----------
    try {
      await run(`await window.api.updateSettings({ agentScopeUnrestricted: ${prevScope ? prevScope.u : false} })`)
      if (assetIds.length > 0) {
        await run(`await window.api.deleteAssets(${JSON.stringify(assetIds)}, true)`)
      }
      if (Number.isInteger(folderId)) {
        await run(`await window.api.deleteFolder(${folderId})`)
      }
      await run(`
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
