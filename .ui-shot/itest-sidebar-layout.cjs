/* 里程碑 214：左侧边栏布局度量回归（对齐 Eagle 的紧凑单栏滚动）
   —— 钉住这次布局优化的设计数值：品牌 56px、导航行 32px、分区间距 12px、
      计数成列、底栏合并为一行、单栏滚动无嵌套滚动。
   前置：npm run dev -- --remote-debugging-port=9333（scripts/itest.cjs 会自动起） */
const WebSocket = require('ws')
const http = require('http')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(url) {
  return new Promise((resolve, reject) =>
    http
      .get(url, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(JSON.parse(body)))
      })
      .on('error', reject)
  )
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

  // 等待应用首屏渲染出侧栏（启动时机不同会短暂没有 nav，直接测量会误判 no-nav）
  await run(`
    const t0 = performance.now()
    while (!document.querySelector('nav[aria-label="素材库导航"]') && performance.now() - t0 < 6000) {
      await new Promise((r) => setTimeout(r, 100))
    }
    return true
  `)

  // 确保处于素材库展开态（不是白板窄轨、不是 56px 图标栏）
  await run(`
    if (document.querySelector('[data-workspace-mode="board"]')) {
      const all = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="全部参考"]')
      if (all) all.click()
    }
    const expand = document.querySelector('button[aria-label="展开侧栏"]')
    if (expand) expand.click()
    return true
  `)
  await sleep(600)

  const m = await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    if (!nav) return 'no-nav'
    const brand = nav.querySelector('.archive-brand')
    const index = nav.querySelector('.archive-sidebar__index')
    const navItems = [...nav.querySelectorAll('.archive-nav-item')]
    const agent = nav.querySelector('button[aria-label="助手"]')
    const footer = nav.querySelector('footer')
    const sections = [...nav.querySelectorAll('section')]
    const headerRow = sections[0] && sections[0].querySelector('h3')?.closest('div')
    const allBtn = nav.querySelector('button[aria-label="全部素材"]')
    const countSpan = allBtn && [...allBtn.querySelectorAll('span')].find((s) => /^\\d+$/.test(s.textContent.trim()))
    const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null
    // 分区内是否存在独立滚动容器（scrollHeight 超出且 overflow-y 可滚）
    const nestedScroll = sections.some((sec) =>
      [...sec.querySelectorAll('*')].some((el) => {
        const oy = getComputedStyle(el).overflowY
        return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4
      })
    )
    return {
      brandH: brand?.getBoundingClientRect().height ?? -1,
      navHeights: navItems.map((el) => Math.round(el.getBoundingClientRect().height)),
      agentH: agent?.getBoundingClientRect().height ?? -1,
      sectionMargins: sections.map((s) => Math.round(parseFloat(getComputedStyle(s).marginTop))),
      indexOverflowY: index ? getComputedStyle(index).overflowY : null,
      nestedScroll,
      footerH: footer?.getBoundingClientRect().height ?? -1,
      footerStatusDot: !!footer?.querySelector('span[title]'),
      footerLib: !!footer?.querySelector('button[aria-label="切换素材库"]'),
      footerSettings: !!footer?.querySelector('button[aria-label="打开设置"]'),
      headerBorderBottom: headerRow ? parseFloat(getComputedStyle(headerRow).borderBottomWidth) : -1,
      count: countSpan
        ? { right: Math.round(countSpan.getBoundingClientRect().right), rowRight: Math.round(allBtn.getBoundingClientRect().right), width: Math.round(countSpan.getBoundingClientRect().width) }
        : null
    }
  `)
  if (typeof m !== 'object' || m === null) {
    check('侧栏布局度量', true, `环境跳过(${m})`)
    console.log(`\n${pass} PASS / ${fail} FAIL`)
    ws.close()
    process.exit(0)
  }

  const navSpread = m.navHeights.length > 1 ? Math.max(...m.navHeights) - Math.min(...m.navHeights) : 0
  check('品牌区 56px', Math.abs(m.brandH - 56) <= 3, `brandH=${m.brandH.toFixed(1)}`)
  // 助手入口已并入品牌区（里程碑 226），不再作为导航行比较高度
  check('导航行高统一 32px', navSpread <= 2 && Math.abs(m.navHeights[0] - 33) <= 2, JSON.stringify({ nav: m.navHeights.slice(0, 3) }))
  check('分区间距统一 12px', m.sectionMargins.every((v) => Math.abs(v - 12) <= 1), JSON.stringify(m.sectionMargins))
  check('计数成列(右侧对齐+定宽)', m.count !== null && Math.abs(m.count.right - (m.count.rowRight - 10)) <= 2 && Math.abs(m.count.width - 34) <= 2, JSON.stringify(m.count))
  check('底栏合并为一行', m.footerH > 0 && m.footerH <= 40 && m.footerStatusDot && m.footerLib && m.footerSettings, JSON.stringify({ h: m.footerH, dot: m.footerStatusDot, lib: m.footerLib, gear: m.footerSettings }))
  check('单栏滚动:索引区可滚且分区无嵌套滚动', m.indexOverflowY === 'auto' && m.nestedScroll === false, JSON.stringify({ indexOverflowY: m.indexOverflowY, nestedScroll: m.nestedScroll }))
  check('分区标题去下边框', m.headerBorderBottom === 0, `borderBottom=${m.headerBorderBottom}`)

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
