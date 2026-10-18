/* 里程碑 196：侧栏收起/导航过滤 + 设置页分区索引。
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
  await run(`localStorage.setItem('lumen.theme', 'silver-gelatin'); localStorage.removeItem('lumen.sidebar.collapsed'); location.reload(); return true`)
  await sleep(3500)
  await send('Page.bringToFront')

  const initial = await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    return { w: nav.getBoundingClientRect().width, collapse: !!document.querySelector('button[aria-label="收起侧栏"]') }
  `)
  check('侧栏默认展开', initial.w > 200 && initial.collapse, JSON.stringify(initial))

  await run(`document.querySelector('button[aria-label="收起侧栏"]')?.click(); await new Promise((r) => setTimeout(r, 350)); return true`)
  const rail = await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    return {
      w: Math.round(nav.getBoundingClientRect().width),
      expand: !!document.querySelector('button[aria-label="展开侧栏"]'),
      folderSection: !!document.querySelector('section[aria-label="文件夹"]'),
      stored: localStorage.getItem('lumen.sidebar.collapsed')
    }
  `)
  check('侧栏收起为 56px 图标栏', rail.w === 56 && rail.expand && !rail.folderSection && rail.stored === '1', JSON.stringify(rail))

  await run(`document.querySelector('button[aria-label="展开侧栏"]')?.click(); await new Promise((r) => setTimeout(r, 350)); return true`)
  const expanded = await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    return { w: nav.getBoundingClientRect().width, filter: !!document.querySelector('input[aria-label="筛选导航"]'), stored: localStorage.getItem('lumen.sidebar.collapsed') }
  `)
  check('展开恢复侧栏与导航过滤框', expanded.w > 200 && expanded.filter && expanded.stored === '0', JSON.stringify(expanded))

  // 导航过滤：GIR 文件夹应保留，胶片应被筛掉
  const filtered = await run(`
    const input = document.querySelector('input[aria-label="筛选导航"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'GIR')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 450))
    const folderSection = document.querySelector('section[aria-label="文件夹"]')
    const names = folderSection ? [...folderSection.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()) : []
    return { names: names.filter(Boolean), hasGir: names.some((n) => n.includes('GIR')), hasFilm: names.some((n) => n.includes('胶片')) }
  `)
  check('导航过滤保留命中文件夹并筛掉无关项', filtered.hasGir && !filtered.hasFilm, JSON.stringify(filtered))

  const clearedFilter = await run(`
    document.querySelector('button[aria-label="清除导航筛选"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const folderSection = document.querySelector('section[aria-label="文件夹"]')
    const names = folderSection ? [...folderSection.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()) : []
    return { hasFilm: names.some((n) => n.includes('胶片')), value: document.querySelector('input[aria-label="筛选导航"]')?.value }
  `)
  check('清除导航过滤恢复列表', clearedFilter.hasFilm && clearedFilter.value === '', JSON.stringify(clearedFilter))

  // 设置页 8 个分区索引
  await run(`document.querySelector('button[aria-label^="打开设置"]')?.click(); await new Promise((r) => setTimeout(r, 1200)); return true`)
  const index = await run(`
    const bar = document.querySelector('[data-testid="settings-section-index"]')
    return { count: bar ? bar.querySelectorAll('button').length : 0, visible: !!bar }
  `)
  check('设置页渲染 8 个分区索引', index.visible && index.count === 8, JSON.stringify(index))

  const jumped = await run(`
    const prefs = document.querySelector('.settings-preferences')
    const btn = document.querySelector('[data-testid="settings-section-index"] [data-section="03"]')
    btn.click()
    await new Promise((r) => setTimeout(r, 900))
    return {
      scrollTop: Math.round(prefs.scrollTop),
      active: btn.getAttribute('aria-pressed'),
      backupTop: Math.round(document.querySelector('[data-code^="03"]').getBoundingClientRect().top),
      prefsTop: Math.round(prefs.getBoundingClientRect().top)
    }
  `)
  check('点击分区索引跳到备份模块', jumped.scrollTop > 100 && jumped.active === 'true' && jumped.backupTop - jumped.prefsTop < 80, JSON.stringify(jumped))

  const sys = await run(`
    const prefs = document.querySelector('.settings-preferences')
    const btn = document.querySelector('[data-testid="settings-section-index"] [data-section="07"]')
    btn.click()
    await new Promise((r) => setTimeout(r, 900))
    return { scrollTop: Math.round(prefs.scrollTop), active: btn.getAttribute('aria-pressed') }
  `)
  check('点击系统分区继续下滚并高亮', sys.scrollTop > jumped.scrollTop && sys.active === 'true', JSON.stringify({ jumped, sys }))

  await run(`document.querySelector('button[aria-label="关闭设置与帮助"]')?.click(); return true`)
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
