/* 里程碑 192：筛选台窄窗布局（1024/1120/1280/1366/1440）+ 紧凑筛选面板与生效 chips。
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
    // 无头/被遮挡环境 ResizeObserver 不一定派发；补一个 resize 事件走窗口兜底路径
    await run(`window.dispatchEvent(new Event('resize')); return true`)
    await sleep(500)
  }

  const probe = () =>
    run(`
      const bar = document.querySelector('.archive-filterbar')
      const scroller = document.querySelector('.archive-filterbar__scroller')
      const fixed = document.querySelector('.archive-filterbar__fixed')
      const compact = !!document.querySelector('button[aria-label="打开筛选面板"]')
      if (!bar || !scroller || !fixed) return { missing: true }
      const sr = scroller.getBoundingClientRect()
      const controls = [...scroller.querySelectorAll('button, input')].filter((el) => el.getBoundingClientRect().width > 0)
      const clipped = controls
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.left < sr.left - 0.5 || r.right > sr.right + 0.5
        })
        .map((el) => el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 12))
      return {
        width: innerWidth,
        compact,
        barFits: bar.scrollWidth <= bar.clientWidth + 1,
        scrollerFits: scroller.scrollWidth <= scroller.clientWidth + 1,
        fixedVisible: fixed.getBoundingClientRect().right <= bar.getBoundingClientRect().right + 0.5,
        clipped
      }
    `)

  const reset = () =>
    run(`
      const close = document.querySelector('button[aria-label="关闭设置与帮助"]')
      if (close) close.click()
      const closePreview = document.querySelector('button[aria-label="关闭预览"]')
      if (closePreview) closePreview.click()
      const agent = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="助手"]')
      if (agent && agent.getAttribute('aria-pressed') === 'true') agent.click()
      const nav = document.querySelector('nav[aria-label="素材库导航"]')
      const all = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '全部素材')
      if (all) all.click()
      await new Promise((r) => setTimeout(r, 400))
      return true
    `)

  await send('Page.bringToFront')
  // 重载一次确保拿到当前源码（HMR 可能保留旧 effect），并回到默认主题
  await run(`localStorage.setItem('lumen.theme', 'silver-gelatin'); location.reload(); return true`)
  await sleep(3500)
  await send('Page.bringToFront')
  await reset()

  const widths = [
    { w: 1440, h: 900, compact: false },
    { w: 1366, h: 768, compact: false },
    { w: 1280, h: 800, compact: true },
    { w: 1120, h: 760, compact: true },
    { w: 1024, h: 720, compact: true }
  ]
  for (const item of widths) {
    await setWidth(item.w, item.h)
    const info = await probe()
    check(
      `${item.w}px 无横向裁切且 ${item.compact ? '紧凑' : '常规'}模式正确`,
      !info.missing &&
        info.compact === item.compact &&
        info.barFits &&
        info.scrollerFits &&
        info.fixedVisible &&
        info.clipped.length === 0,
      JSON.stringify(info)
    )
  }

  // 1024 紧凑筛选面板：打开 → 选 PNG → 关闭 → chips → 清除全部
  await setWidth(1024, 720)
  const panel = await run(`
    const btn = document.querySelector('button[aria-label="打开筛选面板"]')
    if (!btn) throw new Error('紧凑筛选按钮不存在')
    btn.click()
    await new Promise((r) => setTimeout(r, 400))
    const menu = document.querySelector('body > .menu')
    if (!menu) return { open: false }
    const r = menu.getBoundingClientRect()
    return {
      open: true,
      within: r.left >= 0 && r.right <= innerWidth + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5,
      png: !!([...menu.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'PNG'))
    }
  `)
  check('1024 紧凑筛选面板可见且在视口内', panel.open && panel.within && panel.png, JSON.stringify(panel))
  const applied = await run(`
    const menu = document.querySelector('body > .menu')
    const png = [...menu.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'PNG')
    png.click()
    await new Promise((r) => setTimeout(r, 500))
    const bar = document.querySelector('.archive-filterbar')
    const chips = document.querySelector('.archive-filterbar__chips')
    const done = [...menu.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '完成')
    if (done) done.click()
    await new Promise((r) => setTimeout(r, 300))
    return {
      pngPressed: png.getAttribute('aria-pressed'),
      chips: chips
        ? {
            top: Math.round(chips.getBoundingClientRect().top),
            text: chips.innerText.replace(/\s+/g, ' ').trim(),
            clear: !!([...chips.querySelectorAll('button')].find((b) => (b.textContent || '').includes('清除全部')))
          }
        : null,
      barBottom: Math.round(bar.getBoundingClientRect().bottom)
    }
  `)
  check(
    '紧凑筛选生效且 chips 位于筛选台下方',
    applied.pngPressed === 'true' &&
      applied.chips &&
      applied.chips.top >= applied.barBottom - 1 &&
      applied.chips.text.includes('PNG') &&
      applied.chips.clear,
    JSON.stringify(applied)
  )
  const cleared = await run(`
    const cl = [...document.querySelectorAll('.archive-filterbar__chips button')].find((b) => (b.textContent || '').includes('清除全部'))
    if (cl) cl.click()
    await new Promise((r) => setTimeout(r, 400))
    return { chips: !!document.querySelector('.archive-filterbar__chips') }
  `)
  check('清除全部移除 chips', !cleared.chips, JSON.stringify(cleared))

  // 三主题窄窗/宽窗
  for (const theme of ['pixel-glitch', 'cyber-glitch']) {
    await run(`localStorage.setItem('lumen.theme', ${JSON.stringify(theme)}); location.reload(); return true`)
    await sleep(3000)
    await send('Page.bringToFront')
    await reset()
    await setWidth(1024, 720)
    const narrow = await probe()
    check(
      `${theme} 1024px 紧凑模式无裁切`,
      narrow.compact && narrow.barFits && narrow.scrollerFits && narrow.clipped.length === 0,
      JSON.stringify(narrow)
    )
    await setWidth(1440, 900)
    const wide = await probe()
    check(
      `${theme} 1440px 常规模式无裁切`,
      !wide.compact && wide.barFits && wide.scrollerFits && wide.clipped.length === 0,
      JSON.stringify(wide)
    )
  }

  // 恢复默认主题与窗口
  await run(`localStorage.setItem('lumen.theme', 'silver-gelatin'); location.reload(); return true`)
  await sleep(3000)
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
