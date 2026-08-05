/* 用 CDP 检查正式版是否弹出「发现新版本」卡片 */
const WebSocket = require('ws')
const http = require('http')

function getJson(url) {
  return new Promise((res, rej) =>
    http
      .get(url, (r) => {
        let d = ''
        r.on('data', (c) => (d += c))
        r.on('end', () => res(JSON.parse(d)))
      })
      .on('error', rej)
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 等应用启动 + 8 秒静默检查 + 网络往返
  await sleep(14000)
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('page not found')
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
    new Promise((resolve) => {
      const mid = ++id
      pending.set(mid, (msg) => resolve(msg.result))
      ws.send(
        JSON.stringify({
          id: mid,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true }
        })
      )
    })

  const found = (await evalJs(`document.body.textContent.includes('发现新版本')`)).result.value
  const version = (await evalJs(`window.api.getAppVersion()`)).result.value
  const state = (await evalJs(`window.api.checkUpdate ? 'api-ok' : 'api-missing'`)).result.value
  console.log('running version:', version)
  console.log('updater api:', state)
  console.log('update card visible:', found)
  ws.close()
  process.exit(0)
}
main().catch((e) => {
  console.error('ERR:', e.message || e)
  process.exit(2)
})
