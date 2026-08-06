/* CDP 驱动:连接 9333 端口,在渲染进程执行 JS 表达式并输出结果
 * 用法: node scripts/cdp-eval.cjs "表达式"
 * 表达式执行结果需可 JSON 序列化(或返回 undefined)
 */
const expr = process.argv[2]
if (!expr) {
  console.error('用法: node scripts/cdp-eval.cjs "<js表达式>"')
  process.exit(1)
}

async function main() {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('未找到 page 目标')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  }
  await new Promise((res) => (ws.onopen = res))

  const r = await send('Runtime.evaluate', {
    expression: `(async () => { try { return await (${expr}) } catch (e) { return { __err: String(e && e.stack || e) } } })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  const val = r.result?.value
  if (val && val.__err) {
    console.error('ERROR:', val.__err)
    process.exitCode = 1
  } else {
    console.log(val === undefined ? 'undefined' : JSON.stringify(val, null, 1))
  }
  ws.close()
}
main().catch((e) => {
  console.error('CDP FAIL:', e.message)
  process.exit(1)
})
