/* 手动触发更新检查并观察 DOM 反馈 */
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
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page')
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

  const before = (await evalJs(`window.api.getAppVersion()`)).result.value
  console.log('version:', before)
  const ret = (await evalJs(`window.api.checkUpdate()`)).result.value
  console.log('checkUpdate returned:', JSON.stringify(ret))
  for (let i = 0; i < 6; i++) {
    await sleep(1500)
    const txt = (await evalJs(`document.body.textContent`)).result.value
    const hits = ['发现新版本', '已是最新', '更新检查失败', '正在下载'].filter((k) => txt.includes(k))
    console.log(`t+${((i + 1) * 1.5).toFixed(1)}s:`, hits.length ? hits.join(',') : '(no signal)')
    if (hits.length) break
  }
  ws.close()
  process.exit(0)
}
main().catch((e) => {
  console.error('ERR:', e.message || e)
  process.exit(2)
})
