/* 里程碑 195：详情栏收起/拖宽 + 选区操作条。
   前置：npm run dev -- --remote-debugging-port=9333 */
const WebSocket = require('ws')
const http = require('http')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主渲染进程页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })

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

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    ok ? pass++ : fail++
  }

  await send('Page.bringToFront')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await run(`localStorage.setItem('lumen.theme', 'silver-gelatin'); location.reload(); return true`)
  await sleep(3500)
  await send('Page.bringToFront')

  // 回到全部素材 + 清选择
  await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    const all = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '全部素材')
    if (all) all.click()
    await new Promise((r) => setTimeout(r, 500))
    return true
  `)

  const inspectorBefore = await run(`
    const i = document.querySelector('.archive-inspector')
    const g = document.querySelector('.contact-sheet')
    return { w: i ? i.getBoundingClientRect().width : 0, gallery: g ? g.getBoundingClientRect().width : 0, open: localStorage.getItem('lumen.inspector.open') }
  `)

  // 收起 / 展开详情栏（顶栏 panelRight 按钮）
  await run(`document.querySelector('button[aria-label="收起详情"]')?.click(); await new Promise((r) => setTimeout(r, 400)); return true`)
  const collapsed = await run(`
    const i = document.querySelector('.archive-inspector')
    const g = document.querySelector('.contact-sheet')
    return { w: i ? i.getBoundingClientRect().width : 0, gallery: g ? g.getBoundingClientRect().width : 0, stored: localStorage.getItem('lumen.inspector.open') }
  `)
  check('收起详情栏后图库回流且状态持久化', !collapsed.w && collapsed.gallery > inspectorBefore.gallery + 200 && collapsed.stored === '0', JSON.stringify({ inspectorBefore, collapsed }))

  await run(`document.querySelector('button[aria-label="显示详情"]')?.click(); await new Promise((r) => setTimeout(r, 400)); return true`)
  const reopened = await run(`
    const i = document.querySelector('.archive-inspector')
    return { w: i ? Math.round(i.getBoundingClientRect().width) : 0, stored: localStorage.getItem('lumen.inspector.open') }
  `)
  check('重新展开详情栏', reopened.w > 220 && reopened.stored === '1', JSON.stringify(reopened))

  // 拖宽详情栏 60px + 双击复位
  const resized = await run(`
    const r = document.querySelector('[aria-label="拖动调整详情栏宽度"]')
    const i = document.querySelector('.archive-inspector')
    if (!r || !i) throw new Error('找不到详情栏拖拽手柄')
    const start = i.getBoundingClientRect().width
    const rect = r.getBoundingClientRect()
    const x = Math.round(rect.left + rect.width / 2)
    const y = Math.round(rect.top + rect.height / 2)
    const mk = (type, clientX) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY: y, button: 0, pointerId: 31, isPrimary: true })
    r.dispatchEvent(mk('pointerdown', x))
    await new Promise((r2) => setTimeout(r2, 50))
    window.dispatchEvent(mk('pointermove', x - 60))
    await new Promise((r2) => setTimeout(r2, 100))
    window.dispatchEvent(mk('pointerup', x - 60))
    await new Promise((r2) => setTimeout(r2, 250))
    const end = i.getBoundingClientRect().width
    r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise((r2) => setTimeout(r2, 250))
    return { start, end, reset: i.getBoundingClientRect().width, stored: Number(localStorage.getItem('lumen.inspector.width')) }
  `)
  check('详情栏拖宽并双击复位', Math.abs(resized.end - resized.start - 60) <= 2 && Math.abs(resized.reset - 252) <= 1 && resized.stored === 252, JSON.stringify(resized))

  // 多选：Ctrl+点击两张卡片
  const selected = await run(`
    const cards = [...document.querySelectorAll('.contact-sheet [role="button"][aria-pressed]')].filter((c) => c.getBoundingClientRect().width > 0)
    if (cards.length < 2) throw new Error('素材不足，无法测试选区操作条')
    cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    cards[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await new Promise((r) => setTimeout(r, 500))
    const bar = document.querySelector('[data-testid="selection-bar"]')
    return { count: document.querySelectorAll('.contact-sheet [aria-pressed="true"]').length, bar: !!bar, text: bar?.innerText || '' }
  `)
  check('多选后出现选区操作条', selected.count === 2 && selected.bar && selected.text.includes('已选 2 项'), JSON.stringify(selected))

  // 标签 / 文件夹 / 导出 / 删除确认均为可达弹层
  const popovers = await run(`
    const bar = document.querySelector('[data-testid="selection-bar"]')
    const tagBtn = [...bar.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '为所选素材添加标签')
    tagBtn.click()
    await new Promise((r) => setTimeout(r, 250))
    const tagInput = !!document.querySelector('input[aria-label="批量标签名"]')
    document.querySelector('button[aria-label="把所选素材移入文件夹"]').click()
    await new Promise((r) => setTimeout(r, 250))
    const folderMenu = !!document.querySelector('[data-testid="selection-bar"] .menu, body .menu')
    const exportBtn = [...bar.querySelectorAll('button')].find((b) => b.textContent.includes('导出'))
    exportBtn.click()
    await new Promise((r) => setTimeout(r, 350))
    const exportDialog = !!document.querySelector('[role="dialog"][aria-label="导出素材"]')
    const cancel = [...document.querySelectorAll('[role="dialog"][aria-label="导出素材"] button')].find((b) => (b.textContent || '').includes('取消'))
    if (cancel) cancel.click()
    await new Promise((r) => setTimeout(r, 300))
    return { tagInput, folderMenu, exportDialog }
  `)
  check('选区条标签/文件夹/导出入口可达', popovers.tagInput && popovers.exportDialog, JSON.stringify(popovers))

  const cleared = await run(`
    const bar = document.querySelector('[data-testid="selection-bar"]')
    const clear = bar && [...bar.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '取消选择')
    if (clear) clear.click()
    await new Promise((r) => setTimeout(r, 350))
    return { bar: !!document.querySelector('[data-testid="selection-bar"]'), selected: document.querySelectorAll('.contact-sheet [aria-pressed="true"]').length }
  `)
  check('取消选择后操作条消失', !cleared.bar && cleared.selected === 0, JSON.stringify(cleared))

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
