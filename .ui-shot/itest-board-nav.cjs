/* 白板独立入口 + 可关闭专项验证
   前置：npm run dev -- --remote-debugging-port=9333
   运行：node .ui-shot/itest-board-nav.cjs
   验证：默认素材库全屏(白板不常驻) / 主导航「白板」入口 / 退出按钮 / 库导航自动退出全屏 / 分屏切换 */
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

  const hasBoardPanel = `!!document.querySelector('select[aria-label="切换白板"]')`
  // NavItem 可能带数量徽标（如「全部素材515」),用 startsWith 匹配
  const navBtn = (label) => `[...document.querySelectorAll('nav[aria-label="素材库导航"] > div.mt-2 button')].find((b) => b.textContent.trim().startsWith('${label}'))`

  /* ---------- 0. 重载重置状态（前序操作可能停留在白板模式） ---------- */
  await run(`location.reload()`)
  let booted = false
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    booted = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (booted) break
  }
  check('应用重载就绪', booted, '')
  await sleep(500)

  /* ---------- 1. 默认状态：白板不常驻,素材库全屏 ---------- */
  const d1 = await run(`return (() => { const nav = document.querySelector('nav[aria-label="素材库导航"]'); const labels = [...nav.querySelectorAll('div.mt-2 button')].map((b) => b.textContent.trim()); return { panel: ${hasBoardPanel}, navLabels: labels } })()`)
  check('默认纯素材库(白板面板不出现)', !d1.panel, `panel=${d1.panel}`)
  check('主导航含「白板」入口', d1.navLabels.some((l) => l.startsWith('白板')) && d1.navLabels.some((l) => l.startsWith('全部素材')) && d1.navLabels.some((l) => l.startsWith('回收站')), d1.navLabels.join(' / '))

  /* ---------- 2. 点「白板」→ 白板全屏出现 ---------- */
  await run(`(() => { const btn = ${navBtn('白板')}; btn.click() })()`)
  await sleep(400)
  const d2 = await run(`return ${hasBoardPanel}`)
  check('点击主导航「白板」进入白板', d2, `panel=${d2}`)

  /* ---------- 3. 点「退出白板」→ 回到素材库 ---------- */
  await run(`document.querySelector('button[aria-label="退出白板"]').click()`)
  await sleep(400)
  const d3 = await run(`return ${hasBoardPanel}`)
  check('退出白板按钮生效(回到素材库)', !d3, `panel=${d3}`)

  /* ---------- 4. 白板全屏下点「全部素材」→ 自动退出 ---------- */
  await run(`(() => { const btn = ${navBtn('白板')}; btn.click() })()`)
  await sleep(400)
  await run(`(() => { const btn = ${navBtn('全部素材')}; btn.click() })()`)
  await sleep(400)
  const d4 = await run(`return ${hasBoardPanel}`)
  check('库导航点击自动退出白板全屏', !d4, `panel=${d4}`)

  /* ---------- 5. 分屏切换：board → split(Gallery+白板并存) → 退出 ---------- */
  await run(`(() => { const btn = ${navBtn('白板')}; btn.click() })()`)
  await sleep(400)
  await run(`document.querySelector('button[aria-label="取消白板全屏"]').click()`)
  await sleep(400)
  const d5 = await run(`return (() => { const panel = ${hasBoardPanel}; const search = !!document.querySelector('input[aria-label="搜索素材"]'); return { panel, search } })()`)
  check('分屏模式:白板面板与素材库并存', d5.panel && d5.search, `panel=${d5.panel} 素材库搜索框=${d5.search}`)
  await run(`document.querySelector('button[aria-label="退出白板"]').click()`)
  await sleep(400)
  const d5b = await run(`return ${hasBoardPanel}`)
  check('分屏下退出白板', !d5b, `panel=${d5b}`)

  /* ---------- 6. 侧栏白板列表点击 → 进入白板全屏 ---------- */
  const d6 = await run(`return (() => {
    const sec = document.querySelector('section[aria-label="白板"]')
    if (!sec) return 'no section'
    // 分区默认折叠：先点标题行展开
    const header = sec.querySelector('button')
    if (header && !sec.querySelector('.modal-scroll button')) header.click()
    return true
  })()`)
  await sleep(400)
  const d6b = await run(`return (() => {
    const sec = document.querySelector('section[aria-label="白板"]')
    const item = sec && sec.querySelector('.modal-scroll button')
    if (!item) return 'no board item'
    item.click()
    return true
  })()`)
  await sleep(400)
  const d6c = await run(`return ${hasBoardPanel}`)
  check('侧栏白板列表点击进入白板', d6 === true && d6b === true && d6c, `panel=${d6c}`)

  /* ---------- 7. 清理状态：退出白板 ---------- */
  await run(`(() => { const btn = document.querySelector('button[aria-label="退出白板"]'); if (btn) btn.click() })()`)
  await sleep(300)

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
