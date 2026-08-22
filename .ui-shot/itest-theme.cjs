/* 主题系统专项回归：默认值 / 设置入口 / 持久化 / 两主题布局 / 悬停预览边界。
   前置：npm run dev -- --remote-debugging-port=9333 */
const WebSocket = require('ws')
const http = require('http')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve(JSON.parse(body)))
    }).on('error', reject)
  })
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((target) => target.type === 'page' && target.url.includes('localhost:5173') && !target.url.includes('floating'))
  if (!page) throw new Error('找不到主渲染进程页面')

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  let nextId = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  const evalJs = (expression) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, (message) => {
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result.result.value)
    })
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true }
    }))
  })
  const sendCommand = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, (message) => {
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    })
    ws.send(JSON.stringify({ id, method, params }))
  })

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    ok ? pass++ : fail++
  }
  const reloadAs = async (theme) => {
    await evalJs(`(() => {
      ${theme ? `localStorage.setItem('lumen.theme', ${JSON.stringify(theme)})` : `localStorage.removeItem('lumen.theme')`}
      location.reload()
      return true
    })()`)
    await sleep(1000)
  }
  const probeLayout = () => evalJs(`(() => {
    const bar = document.querySelector('.archive-filterbar')
    const scroller = document.querySelector('.archive-filterbar__scroller')
    const fixed = document.querySelector('.archive-filterbar__fixed')
    const gallery = document.querySelector('.contact-sheet')
    const index = document.querySelector('.archive-sidebar__index')
    const right = (element) => element?.getBoundingClientRect().right ?? 0
    return {
      theme: document.documentElement.dataset.theme,
      toolbarFits: !!bar && bar.scrollWidth <= bar.clientWidth,
      filtersFit: !!scroller && scroller.scrollWidth <= scroller.clientWidth,
      fixedVisible: !!fixed && !!bar && right(fixed) <= right(bar) + 0.5,
      galleryScrolls: !!gallery && gallery.scrollHeight > gallery.clientHeight,
      sidebarNoX: !!index && index.scrollWidth <= index.clientWidth,
      masthead: document.querySelector('.archive-masthead')?.clientHeight,
      sidebar: document.querySelector('.archive-sidebar')?.clientWidth,
      inspector: document.querySelector('.archive-inspector')?.clientWidth,
      brandText: document.querySelector('.archive-sidebar')?.textContent,
      mastheadText: document.querySelector('.archive-masthead')?.textContent,
      inspectorText: document.querySelector('.archive-inspector')?.textContent,
      cardRadius: getComputedStyle(document.querySelector('.asset-card')).borderRadius,
      cardClip: getComputedStyle(document.querySelector('.asset-card')).clipPath,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      bodyFont: getComputedStyle(document.body).fontFamily,
      statusbar: (() => {
        const node = document.querySelector('.pixel-statusbar')
        const rect = node?.getBoundingClientRect()
        return node && rect ? {
          height: rect.height,
          bottom: rect.bottom,
          text: node.textContent,
          visible: rect.top >= 0 && rect.bottom <= innerHeight + 0.5
        } : null
      })(),
      assetImageFilter: getComputedStyle(document.querySelector('.asset-card img')).filter
    }
  })()`)

  await reloadAs(null)
  let theme = await evalJs(`document.documentElement.dataset.theme`)
  check('缺失设置回落银盐鸦影', theme === 'silver-gelatin', theme)

  await evalJs(`document.querySelector('button[aria-label^="打开设置"]')?.click()`)
  await sleep(900)
  const choices = await evalJs(`[...document.querySelectorAll('.theme-choice')].map((node) => ({ text: node.textContent, checked: node.getAttribute('aria-checked') }))`)
  check('设置页包含三个主题', choices.length === 3, `${choices.length} 个`)
  check('银盐鸦影标记默认选中', choices[0]?.checked === 'true' && choices[0]?.text.includes('默认标准'), JSON.stringify(choices.map((item) => item.checked)))

  await evalJs(`document.querySelectorAll('.theme-choice')[1]?.click()`)
  await sleep(550)
  theme = await evalJs(`({ root: document.documentElement.dataset.theme, saved: localStorage.getItem('lumen.theme') })`)
  check('设置页即时切换像素故障', theme.root === 'pixel-glitch' && theme.saved === 'pixel-glitch', JSON.stringify(theme))

  await reloadAs('pixel-glitch')
  theme = await evalJs(`document.documentElement.dataset.theme`)
  check('像素故障刷新后保持', theme === 'pixel-glitch', theme)
  const pixelLayout = await probeLayout()
  check('像素主题工具栏完整', pixelLayout.toolbarFits && pixelLayout.filtersFit && pixelLayout.fixedVisible, JSON.stringify(pixelLayout))
  check('像素主题滚动链正常', pixelLayout.galleryScrolls && pixelLayout.sidebarNoX, JSON.stringify(pixelLayout))
  check('像素主题 PX–03.1 比例生效', pixelLayout.masthead >= 49 && pixelLayout.masthead <= 50 && pixelLayout.sidebar >= 199 && pixelLayout.sidebar <= 212 && pixelLayout.inspector >= 219 && pixelLayout.inspector <= 236, JSON.stringify(pixelLayout))
  check('PX–03.1 继承原布局且不新增底部任务栏', pixelLayout.statusbar === null, JSON.stringify(pixelLayout.statusbar))
  check('像素主题不污染素材原图', pixelLayout.assetImageFilter === 'none', pixelLayout.assetImageFilter)
  check('PX–03.1 使用独立索引语义', pixelLayout.brandText.includes('INDEX / 03') && pixelLayout.mastheadText.includes('MASTER INDEX') && pixelLayout.inspectorText.includes('INDEX LOG'), JSON.stringify({ brand: pixelLayout.brandText.slice(0, 80), masthead: pixelLayout.mastheadText, inspector: pixelLayout.inspectorText.slice(0, 60) }))
  check('PX–03.1 使用直角终端轮廓与独立字体', pixelLayout.cardRadius === '0px' && pixelLayout.bodyFont.includes('Cascadia Mono'), JSON.stringify({ radius: pixelLayout.cardRadius, font: pixelLayout.bodyFont }))

  await sendCommand('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false })
  await sleep(250)
  const compactLayout = await evalJs(`(() => {
    const bar = document.querySelector('.archive-filterbar')
    const scroller = document.querySelector('.archive-filterbar__scroller')
    const fixed = document.querySelector('.archive-filterbar__fixed')
    const telemetry = document.querySelector('.archive-masthead__telemetry')
    const right = (element) => element?.getBoundingClientRect().right ?? 0
    return {
      width: innerWidth,
      telemetry: telemetry ? getComputedStyle(telemetry).display : null,
      toolbarFits: !!bar && bar.scrollWidth <= bar.clientWidth,
      filtersFit: !!scroller && scroller.scrollWidth <= scroller.clientWidth,
      fixedVisible: !!fixed && !!bar && right(fixed) <= right(bar) + 0.5
    }
  })()`)
  check('PX–03.1 中等宽度收起遥测且工具完整', compactLayout.width === 1366 && compactLayout.telemetry === 'none' && compactLayout.toolbarFits && compactLayout.filtersFit && compactLayout.fixedVisible, JSON.stringify(compactLayout))
  await sendCommand('Emulation.clearDeviceMetricsOverride')
  await sleep(250)

  const hover = await evalJs(`(async () => {
    const gallery = document.querySelector('.contact-sheet')
    gallery.scrollTop = 0
    gallery.dispatchEvent(new Event('scroll', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 180))
    const card = [...document.querySelectorAll('.asset-card')]
      .map((node) => node.parentElement)
      .find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.bottom > gallery.getBoundingClientRect().top && rect.top < gallery.getBoundingClientRect().bottom
      })
    const rect = card.getBoundingClientRect()
    card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null, clientX: rect.left + 4, clientY: rect.top + 4 }))
    // 悬停延迟 420ms;dev 窗口在后台时 Electron 会把定时器节流到 >=1s,固定 sleep 会
    // 等到不了——轮询最终状态(照 itest-board-workspace 的既有做法)
    let preview = null
    for (let i = 0; i < 25; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      preview = document.querySelector('[data-hover-preview]')
      if (preview) break
    }
    const p = preview?.getBoundingClientRect()
    const g = gallery.getBoundingClientRect()
    const within = !!p && p.left >= g.left && p.right <= g.right && p.top >= g.top && p.bottom <= g.bottom
    gallery.dispatchEvent(new Event('scroll', { bubbles: true }))
    return { exists: !!preview, parent: preview?.parentElement?.tagName, within }
  })()`)
  check('悬停预览根层定位且不越界', hover.exists && hover.parent === 'BODY' && hover.within, JSON.stringify(hover))

  await reloadAs('cyber-glitch')
  const cyberLayout = await probeLayout()
  check('信号故障主题工具栏完整', cyberLayout.toolbarFits && cyberLayout.filtersFit && cyberLayout.fixedVisible, JSON.stringify(cyberLayout))
  check('信号故障主题滚动链正常', cyberLayout.galleryScrolls && cyberLayout.sidebarNoX, JSON.stringify(cyberLayout))
  check('信号故障 PX–02R 比例生效', cyberLayout.masthead >= 51 && cyberLayout.masthead <= 53 && cyberLayout.sidebar >= 203 && cyberLayout.sidebar <= 217 && cyberLayout.inspector >= 223 && cyberLayout.inspector <= 241, JSON.stringify(cyberLayout))
  check('PX–02R 使用独立信号语义', cyberLayout.brandText.includes('SIGNAL / 02') && cyberLayout.mastheadText.includes('SIGNAL MATRIX') && cyberLayout.inspectorText.includes('TRACE PANEL'), JSON.stringify({ brand: cyberLayout.brandText.slice(0, 80), masthead: cyberLayout.mastheadText, inspector: cyberLayout.inspectorText.slice(0, 60) }))
  check('PX–02R 使用磷光青和像素切角', cyberLayout.accent.toLowerCase() === '#63e7f4' && cyberLayout.cardClip !== 'none', JSON.stringify({ accent: cyberLayout.accent, clip: cyberLayout.cardClip }))
  check('信号故障不污染素材原图', cyberLayout.assetImageFilter === 'none', cyberLayout.assetImageFilter)

  await sendCommand('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false })
  await sleep(250)
  const cyberCompact = await evalJs(`(() => {
    const bar = document.querySelector('.archive-filterbar')
    const telemetry = document.querySelector('.archive-masthead__telemetry')
    return {
      width: innerWidth,
      telemetry: telemetry ? getComputedStyle(telemetry).display : null,
      toolbarFits: !!bar && bar.scrollWidth <= bar.clientWidth
    }
  })()`)
  check('PX–02R 中等宽度收起信号总线', cyberCompact.width === 1366 && cyberCompact.telemetry === 'none' && cyberCompact.toolbarFits, JSON.stringify(cyberCompact))
  await sendCommand('Emulation.clearDeviceMetricsOverride')
  await sleep(250)

  await reloadAs('silver-gelatin')
  const silverLayout = await probeLayout()
  check('银盐主题工具栏完整', silverLayout.toolbarFits && silverLayout.filtersFit && silverLayout.fixedVisible, JSON.stringify(silverLayout))
  check('银盐主题滚动链正常', silverLayout.galleryScrolls && silverLayout.sidebarNoX, JSON.stringify(silverLayout))
  check('银盐主题标准比例生效', silverLayout.masthead >= 53 && silverLayout.masthead <= 54 && silverLayout.sidebar >= 219 && silverLayout.sidebar <= 220 && silverLayout.inspector >= 251 && silverLayout.inspector <= 252, JSON.stringify(silverLayout))
  check('银盐主题保持原布局且无附加任务栏', silverLayout.statusbar === null, JSON.stringify(silverLayout.statusbar))
  check('银盐主题保持暗房档案语义', !silverLayout.brandText.includes('INDEX / 03') && !silverLayout.mastheadText.includes('MASTER INDEX') && !silverLayout.inspectorText.includes('INDEX LOG'), JSON.stringify({ brand: silverLayout.brandText.slice(0, 80), masthead: silverLayout.mastheadText, inspector: silverLayout.inspectorText.slice(0, 60) }))
  check('三主题不是换色复用', silverLayout.bodyFont !== pixelLayout.bodyFont && cyberLayout.cardClip !== pixelLayout.cardClip && cyberLayout.accent !== pixelLayout.accent, JSON.stringify({ silverFont: silverLayout.bodyFont, pixelAccent: pixelLayout.accent, pixelClip: pixelLayout.cardClip, cyberAccent: cyberLayout.accent, cyberClip: cyberLayout.cardClip }))

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('THEME ITEST ERROR:', error.message || error)
  process.exit(2)
})
