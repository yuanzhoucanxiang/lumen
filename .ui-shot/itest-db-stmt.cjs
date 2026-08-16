/* 语句缓存 + 切库安全专项验证(里程碑 83 / 后端优化阶段 2a):
   核心回归点:stmtCache 的 statement 绑定在 Database 实例上,closeDb() 后缓存若
   未清理,后续查询会拿到指向已关闭实例的 statement 抛 "database connection is closed"。
   触发路径:library:remove 移除唯一库时,removeLibrary 自动回退默认库并真实执行
   closeDb -> ensureLibrary 重开(同一 db 文件、全新 Database 实例),纯现有 IPC 无对话框。
   断言:重开前后 stats/listTags/listBoards(全部走 stmt 缓存)结果一致不抛错,
   且重开后 INSERT/DELETE 语句(addBoardItem)同样可用。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-db-stmt.cjs */
const WebSocket = require('ws')
const http = require('http')

function getJson(url) {
  return new Promise((res, rej) =>
    http.get(url, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => res(JSON.parse(d)))
    }).on('error', rej)
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面')
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
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, (msg) => {
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      })
      ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
  const run = async (expr) => {
    const r = await evalJs(`(async () => { ${expr} })()`)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- 0. 就绪 ---------- */
  let ready = false
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    ready = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (ready) break
  }
  check('应用就绪', ready, '')

  /* ---------- 1. 重开前基线(预热 stmt 缓存) ---------- */
  const before = await run(`return {
    stats: await window.api.getLibraryStats(),
    tags: (await window.api.listTags()).length,
    boards: (await window.api.listBoards()).length,
    lib: await window.api.getLibraryInfo()
  }`)
  check('基线查询可用(缓存预热)', before.stats.total >= 0 && before.lib.path.length > 0, `total=${before.stats.total} path=${before.lib.path}`)

  /* ---------- 2. 触发 closeDb -> 重开:移除唯一库,removeLibrary 自动回退默认库并重开 ---------- */
  const removed = await run(`return await window.api.removeLibrary(${JSON.stringify(before.lib.path)})`)
  check('library:remove 返回配置', removed && Array.isArray(removed.libraries), `libraries=${removed?.libraries?.length}`)
  await sleep(600)
  const afterLib = await run(`return await window.api.getLibraryInfo()`)
  check('库已重开(同一路径,全新 Database 实例)', afterLib.path === before.lib.path, `${afterLib.path}`)

  /* ---------- 3. 重开后同批查询(全部命中 stmt 缓存路径,若缓存未清必抛 connection closed) ---------- */
  const after = await run(`return {
    stats: await window.api.getLibraryStats(),
    tags: (await window.api.listTags()).length,
    boards: (await window.api.listBoards()).length
  }`)
  check('重开后查询不抛错且数据一致', after.stats.total === before.stats.total && after.tags === before.tags, `total ${before.stats.total}->${after.stats.total}, tags ${before.tags}->${after.tags}`)

  /* ---------- 4. 重开后写路径(INSERT/DELETE 语句同样跨实例重建) ---------- */
  const scratch = await run(`return await window.api.createBoard('itest-stmt-临时')`)
  const item = await run(`return await window.api.addBoardItem(${scratch.id}, { type: 'note', x: 10, y: 10, width: 80, height: 40, text: 'stmt' })`)
  const items = await run(`return await window.api.listBoardItems(${scratch.id})`)
  await run(`await window.api.deleteBoard(${scratch.id})`)
  check('重开后增删语句可用(白板建/加/删)', items.length === 1 && item.text === 'stmt', `items=${items.length}`)

  console.log('')
  console.log(pass + ' PASS / ' + fail + ' FAIL')
  ws.close()
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
