const fs = require('fs')
const http = require('http')
const path = require('path')
const WebSocket = require('ws')

const root = path.resolve(__dirname, '..')
const requestedTheme = process.argv[2]
const theme = ['silver-gelatin', 'pixel-glitch', 'cyber-glitch'].includes(requestedTheme)
  ? requestedTheme
  : 'silver-gelatin'
const outDir = path.join(
  root,
  'design-proposals',
  theme === 'pixel-glitch'
    ? 'pixel-glitch-theme'
    : theme === 'cyber-glitch'
      ? 'cyber-glitch-theme'
      : 'raven-archive-theme'
)

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve(JSON.parse(body)))
    }).on('error', reject)
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((target) => target.type === 'page' && target.url.includes('localhost:5173') && !target.url.includes('floating'))
  if (!page) throw new Error('Main renderer target not found on CDP 9333')

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
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, (message) => {
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = (expression) => call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  const clickByText = (text) => evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(${JSON.stringify(text)}))
    if (!el) return false
    el.click()
    return true
  })()`)
  const clickByLabel = (label) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})
    if (!el) return false
    el.click()
    return true
  })()`)
  const shot = async (name) => {
    const result = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    fs.writeFileSync(path.join(outDir, name), Buffer.from(result.data, 'base64'))
  }

  await call('Page.bringToFront')
  await evaluate(`(() => {
    localStorage.setItem('lumen.theme', ${JSON.stringify(theme)})
    location.reload()
    return true
  })()`)
  await sleep(1100)
  await clickByText('全部素材')
  await sleep(900)
  await shot('theme-home.png')

  await evaluate(`(() => {
    const card = document.querySelector('.asset-card')?.parentElement
    if (!card) return false
    card.click()
    return true
  })()`)
  await sleep(500)
  await shot('theme-inspector.png')

  await clickByLabel('打开设置')
  await sleep(450)
  await shot('theme-dialog.png')
  await clickByLabel('关闭设置与帮助')
  await sleep(250)

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('nav[aria-label="素材库导航"] button[aria-label]')]
      .find((node) => node.getAttribute('aria-label')?.startsWith('白板'))
    if (!button) throw new Error('Whiteboard navigation button not found')
    button.click()
    return true
  })()`)
  await sleep(900)
  const boardReady = await evaluate(`!!document.querySelector('select[aria-label="切换白板"]')`)
  if (!boardReady.result.value) throw new Error('Whiteboard did not enter dedicated workspace')
  await shot('theme-board.png')

  await clickByText('全部素材')
  ws.close()
  process.stdout.write(['theme-home.png', 'theme-inspector.png', 'theme-dialog.png', 'theme-board.png'].map((name) => path.join(outDir, name)).join('\n'))
  setImmediate(() => process.exit(0))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
