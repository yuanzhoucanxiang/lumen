/* 视觉基线采集（里程碑 200）
   前置：npm run dev -- --remote-debugging-port=9333
   用法：node scripts/capture-ui.cjs --label v0.8.42
   输出：.ui-shot/ui-baseline/<label>/<theme>-<width>-<view>.png + manifest.json
   说明：只读操作（打开/关闭弹层、选两张卡），不改素材数据。 */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT_ROOT = path.join(ROOT, '.ui-shot', 'ui-baseline')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const label = arg('label', new Date().toISOString().slice(0, 10))
const widths = arg('widths', '1024,1280,1440').split(',').map(Number)
const themes = arg('themes', 'silver-gelatin,pixel-glitch,cyber-glitch').split(',')
const views = arg('views', 'library,settings,preview,agent,selection').split(',')
const OUT = path.join(OUT_ROOT, label)
fs.mkdirSync(OUT, { recursive: true })

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
    }).then((r) => r.result?.result?.value)
  const finishAnimations = () =>
    run(`
      document.getAnimations().forEach((a) => {
        try { a.finish() } catch { /* 无限动画忽略 */ }
      })
      return true
    `)
  const screenshot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    const data = r.result?.data
    if (!data) throw new Error('截图数据为空')
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'))
    console.log('  shot', name)
  }
  const setWidth = async (width) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    })
    await run(`window.dispatchEvent(new Event('resize')); return true`)
    await finishAnimations()
    await sleep(500)
  }
  const setTheme = async (theme) => {
    await run(`
      localStorage.setItem('lumen.theme', ${JSON.stringify(theme)})
      localStorage.removeItem('lumen.sidebar.collapsed')
      localStorage.removeItem('lumen.inspector.open')
      localStorage.setItem('lumen.inspector.width', '252')
      localStorage.setItem('lumen.agentWidth', '384')
      location.reload()
      return true
    `)
    await sleep(3200)
    await send('Page.bringToFront')
  }
  const reset = async () => {
    await run(`
      const closeSettings = document.querySelector('button[aria-label="关闭设置与帮助"]')
      if (closeSettings) closeSettings.click()
      const closePreview = document.querySelector('button[aria-label="关闭预览"]')
      if (closePreview) closePreview.click()
      const agent = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="助手"]')
      if (agent && agent.getAttribute('aria-pressed') === 'true') agent.click()
      const exitBoard = document.querySelector('button[aria-label="退出白板"]')
      if (exitBoard) exitBoard.click()
      const nav = document.querySelector('nav[aria-label="素材库导航"]')
      const all = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '全部素材')
      if (all) all.click()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await new Promise((r) => setTimeout(r, 500))
      return true
    `)
    await finishAnimations()
  }

  const version = await run(`window.api.getAppVersion()`)
  const manifest = { label, version, generatedAt: new Date().toISOString(), widths, themes, views }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))

  for (const theme of themes) {
    await setTheme(theme)
    for (const width of widths) {
      await setWidth(width)
      await reset()
      for (const view of views) {
        try {
          if (view === 'library') {
            await screenshot(`${theme}-${width}-library.png`)
          } else if (view === 'settings') {
            await run(`document.querySelector('button[aria-label^="打开设置"]')?.click(); await new Promise((r) => setTimeout(r, 1200)); return true`)
            await screenshot(`${theme}-${width}-settings.png`)
            await run(`document.querySelector('button[aria-label="关闭设置与帮助"]')?.click(); await new Promise((r) => setTimeout(r, 300)); return true`)
          } else if (view === 'preview') {
            await run(`
              const card = document.querySelector('.asset-card')
              if (!card) return false
              card.closest('[tabindex="0"]')?.focus()
              card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
              await new Promise((r) => setTimeout(r, 800))
              document.querySelector('button[aria-label="显示/隐藏素材信息"]')?.click()
              await new Promise((r) => setTimeout(r, 300))
              return true
            `)
            await finishAnimations()
            await screenshot(`${theme}-${width}-preview.png`)
            await run(`document.querySelector('button[aria-label="关闭预览"]')?.click(); await new Promise((r) => setTimeout(r, 300)); return true`)
          } else if (view === 'agent') {
            await run(`const b=document.querySelector('nav[aria-label="素材库导航"] button[aria-label="助手"]'); if(b) b.click(); await new Promise((r) => setTimeout(r, 700)); return true`)
            await finishAnimations()
            await screenshot(`${theme}-${width}-agent.png`)
            await run(`const b=document.querySelector('nav[aria-label="素材库导航"] button[aria-label="助手"]'); if(b) b.click(); await new Promise((r) => setTimeout(r, 300)); return true`)
          } else if (view === 'selection') {
            await run(`
              const cards = [...document.querySelectorAll('.contact-sheet [role="button"][aria-pressed]')].filter((c) => c.getBoundingClientRect().width > 0)
              if (cards.length < 2) return false
              cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
              cards[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
              await new Promise((r) => setTimeout(r, 450))
              return true
            `)
            await finishAnimations()
            await screenshot(`${theme}-${width}-selection.png`)
            // 通过取消选择按钮回到干净状态
            await run(`document.querySelector('[data-testid="selection-bar"] button[aria-label="取消选择"]')?.click(); await new Promise((r) => setTimeout(r, 300)); return true`)
          }
        } catch (e) {
          console.log('  skip', theme, width, view, e.message)
        }
      }
    }
  }

  await run(`localStorage.setItem('lumen.theme', 'silver-gelatin'); location.reload(); return true`)
  await send('Emulation.clearDeviceMetricsOverride')
  await sleep(2500)
  ws.close()
  console.log(`\n基线已写入 ${OUT}`)
}

main().catch((e) => {
  console.error('CAPTURE CRASH:', e.message)
  process.exit(1)
})
