// 助手面板三主题截图验收（对话视图/记录视图/逐项明细）
// 用法：npm run dev -- --remote-debugging-port=9333 后 node scripts/capture-agent-panel-theme.cjs
// 输出：.ui-shot/theme-shots/*.png（gitignore，本地验收产物）
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const path = require('path')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const THEMES = ['silver-gelatin', 'pixel-glitch', 'cyber-glitch']
const OUT = path.join(__dirname, '..', '.ui-shot', 'theme-shots')
fs.mkdirSync(OUT, { recursive: true })

function connect() {
  return new Promise((resolve, reject) => {
    http
      .get('http://127.0.0.1:9333/json/list', (r) => {
        let d = ''
        r.on('data', (c) => (d += c))
        r.on('end', () => {
          const page = JSON.parse(d).find((t) => t.type === 'page' && !t.url.includes('floating'))
          if (!page) return reject(new Error('no page'))
          const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
          let id = 0
          const pending = new Map()
          ws.on('message', (m) => {
            const msg = JSON.parse(m.toString())
            if (msg.id && pending.has(msg.id)) {
              pending.get(msg.id)(msg)
              pending.delete(msg.id)
            }
          })
          ws.on('open', () => {
            const send = (method, params) =>
              new Promise((res) => {
                const mid = ++id
                pending.set(mid, (msg) => res(msg.result))
                ws.send(JSON.stringify({ id: mid, method, params }))
              })
            const run = (expr) =>
              send('Runtime.evaluate', {
                expression: `(async () => { ${expr} })()`,
                returnByValue: true,
                awaitPromise: true
              }).then((r2) => (r2?.exceptionDetails ? 'EXC:' + r2.exceptionDetails.text : r2?.result?.value))
            resolve({ ws, send, run })
          })
          ws.on('error', reject)
        })
      })
      .on('error', reject)
  })
}

;(async () => {
  const { ws, send, run } = await connect()
  for (const theme of THEMES) {
    // 切换主题并重载
    await run(`localStorage.setItem('lumen.theme', ${JSON.stringify(theme)}); return true`)
    await send('Page.reload', {})
    await sleep(3500)

    // 打开助手面板
    await run(`
      const nav = document.querySelector('nav[aria-label="素材库导航"]')
      const btn = nav ? [...nav.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === '助手') : null
      if (btn && !document.querySelector('[data-testid="agent-panel"]')) btn.click()
      await new Promise((r) => setTimeout(r, 500))
      return !!document.querySelector('[data-testid="agent-panel"]')
    `)
    await sleep(400)
    let shot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, `${theme}-chat.png`), Buffer.from(shot.data, 'base64'))

    // 切到操作记录视图
    await run(`
      const btn = [...document.querySelectorAll('[data-testid="agent-panel"] button')].find((b) => (b.getAttribute('aria-label') || '') === '操作记录')
      if (btn) btn.click()
      await new Promise((r) => setTimeout(r, 900))
      return true
    `)
    await sleep(500)
    shot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, `${theme}-ops.png`), Buffer.from(shot.data, 'base64'))

    // 展开第一条有明细的记录(验证明细样式)
    if (theme === 'pixel-glitch') {
      await run(`
        const btn = [...document.querySelectorAll('[data-testid="agent-ops"] button')].find((b) => (b.textContent || '').includes('展开明细'))
        if (btn) btn.click()
        await new Promise((r) => setTimeout(r, 500))
        return true
      `)
      await sleep(400)
      shot = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT, `${theme}-ops-expanded.png`), Buffer.from(shot.data, 'base64'))
    }
    console.log(theme, '已完成')
  }
  ws.close()
  process.exit(0)
})().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
