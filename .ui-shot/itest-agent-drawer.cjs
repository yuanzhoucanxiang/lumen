/* 里程碑 193：助手停靠/浮层两种布局 + 拖拽宽度 + 遮罩关闭。
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

  const setWidth = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await run(`window.dispatchEvent(new Event('resize')); return true`)
    await settleAnimations()
    await sleep(500)
  }

  const settleAnimations = () =>
    run(`
      document.getAnimations().forEach((a) => {
        try {
          a.finish()
        } catch {
          /* 无限动画不能 finish，忽略 */
        }
      })
      return true
    `)

  const probe = () =>
    run(`
      const gallery = document.querySelector('.contact-sheet')
      const inspector = document.querySelector('.archive-inspector')
      const panel = document.querySelector('[data-testid="agent-panel"]')
      const scrim = [...document.querySelectorAll('.fixed.inset-0')].find(
        (el) => getComputedStyle(el).zIndex === '130'
      )
      const stack = document.querySelector('[data-testid="activity-stack"]')
      const pr = panel && panel.getBoundingClientRect()
      return {
        gallery: gallery ? Math.round(gallery.getBoundingClientRect().width) : null,
        inspector: inspector ? getComputedStyle(inspector).display : null,
        panel: pr ? { x: Math.round(pr.x), w: Math.round(pr.width), mode: panel.dataset.mode } : null,
        scrim: !!scrim,
        activityRight: stack ? Math.round(parseFloat(getComputedStyle(stack).right)) : null,
        innerW: innerWidth,
        storedWidth: Number(localStorage.getItem('lumen.agentWidth'))
      }
    `)

  const closeAgent = () =>
    run(`
      const btn = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="助手"]')
      if (btn && btn.getAttribute('aria-pressed') === 'true') btn.click()
      await new Promise((r) => setTimeout(r, 400))
      return true
    `)

  await send('Page.bringToFront')
  await run(`
    const exit = document.querySelector('button[aria-label="退出白板"]')
    if (exit) exit.click()
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    const all = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '全部素材')
    if (all) all.click()
    await new Promise((r) => setTimeout(r, 500))
    return true
  `)
  await closeAgent()
  await setWidth(1440, 900)

  const before = await probe()
  await run(`
    const btn = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="助手"]')
    btn.click()
    await new Promise((r) => setTimeout(r, 700))
    return true
  `)
  await settleAnimations()
  const docked = await probe()
  check(
    '1440 助手停靠模式',
    docked.panel?.mode === 'docked' &&
      docked.panel.x + docked.panel.w === docked.innerW &&
      docked.activityRight === docked.panel.w + 20,
    JSON.stringify(docked)
  )
  check(
    '停靠后图库回流且详情栏隐藏',
    docked.gallery < before.gallery - 100 && (!docked.inspector || docked.inspector === 'none'),
    JSON.stringify({ before, docked })
  )

  // 拖拽左边缘加宽 80px
  const dragged = await run(`
    const resizer = document.querySelector('[aria-label="拖动调整助手宽度"]')
    const panel = document.querySelector('[data-testid="agent-panel"]')
    if (!resizer || !panel) throw new Error('缺少拖拽手柄或面板')
    const startW = panel.getBoundingClientRect().width
    const r = resizer.getBoundingClientRect()
    const x = Math.round(r.left + r.width / 2)
    const y = Math.round(r.top + r.height / 2)
    const mk = (type, clientX) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY: y, button: 0, pointerId: 21, isPrimary: true })
    resizer.dispatchEvent(mk('pointerdown', x))
    await new Promise((r2) => setTimeout(r2, 60))
    window.dispatchEvent(mk('pointermove', x - 80))
    await new Promise((r2) => setTimeout(r2, 120))
    window.dispatchEvent(mk('pointerup', x - 80))
    await new Promise((r2) => setTimeout(r2, 250))
    return { startW, endW: panel.getBoundingClientRect().width, stored: Number(localStorage.getItem('lumen.agentWidth')) }
  `)
  check('拖拽手柄加宽助手并持久化', Math.abs(dragged.endW - dragged.startW - 80) <= 2 && Math.abs(dragged.stored - dragged.endW) <= 2, JSON.stringify(dragged))

  // 双击手柄复位
  const resetWidth = await run(`
    const resizer = document.querySelector('[aria-label="拖动调整助手宽度"]')
    const panel = document.querySelector('[data-testid="agent-panel"]')
    resizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    return { w: panel.getBoundingClientRect().width, stored: Number(localStorage.getItem('lumen.agentWidth')) }
  `)
  check('双击手柄复位助手宽度', Math.abs(resetWidth.w - 384) <= 1 && resetWidth.stored === 384, JSON.stringify(resetWidth))

  // 1024：改为浮层 + 遮罩，图库宽度不再被挤压
  await setWidth(1024, 720)
  const overlay = await probe()
  check(
    '1024 助手切为浮层并带遮罩',
    overlay.panel?.mode === 'overlay' && overlay.scrim && overlay.gallery > 500 && overlay.activityRight === 400,
    JSON.stringify(overlay)
  )
  await run(`
    const scrim = [...document.querySelectorAll('.fixed.inset-0')].find((el) => getComputedStyle(el).zIndex === '130')
    if (scrim) scrim.click()
    await new Promise((r) => setTimeout(r, 500))
    return true
  `)
  const closed = await probe()
  check(
    '点击遮罩关闭助手且图库宽度不变',
    !closed.panel && !closed.scrim && closed.gallery === overlay.gallery && closed.activityRight === 24,
    JSON.stringify(closed)
  )

  await closeAgent()
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
