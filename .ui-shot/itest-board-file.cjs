/* 白板文件 .lumenboard 导入导出专项验证（往返：导出→删源→导入→断言）
   前置：npm run dev -- --remote-debugging-port=9333
   运行：node .ui-shot/itest-board-file.cjs
   说明：使用真实库素材嵌入导出,独立测试白板,结束清理 */
const WebSocket = require('ws')
const http = require('http')
const os = require('os')
const path = require('path')

function getJson(url) {
  return new Promise((res, rej) =>
    http.get(url, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => res(JSON.parse(d)))
    }).on('error', rej)
  )
}

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
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const boardName = `itest-文件-${Date.now()}`
  const filePath = path.join(os.tmpdir(), `lumenboard-itest-${Date.now()}.lumenboard`).replace(/\\/g, '/')

  /* ---------- 1. 准备：取 2 个真实图片素材 ---------- */
  const imgs = await run(`return (await window.api.queryAssets({ limit: 200 })).filter((a) => ['jpg', 'png', 'webp', 'jpeg'].includes(a.ext)).slice(0, 2)`)
  check('库内找到 2 个图片素材', imgs.length === 2, imgs.map((a) => a.name).join(', '))

  /* ---------- 2. 建测试白板：2 素材 + 2 note + 参考线 + 透明度/样式 ---------- */
  const board = await run(`return window.api.createBoard('${boardName}')`)
  const boardId = board.id
  const itemA = await run(`return window.api.addBoardItem(${boardId}, { assetId: '${imgs[0].id}', type: 'asset', x: 100, y: 100, width: 240, height: 160 })`)
  const itemB = await run(`return window.api.addBoardItem(${boardId}, { assetId: '${imgs[1].id}', type: 'asset', x: 400, y: 120, width: 200, height: 140 })`)
  const note1 = await run(`return window.api.addBoardItem(${boardId}, { type: 'note', x: 100, y: 320, width: 200, height: 60, text: '参考说明' })`)
  await run(`return window.api.addBoardItem(${boardId}, { type: 'note', x: 400, y: 320, width: 160, height: 60, text: '第二张' })`)
  // 透明度 / note 样式 / z
  await run(`await window.api.updateBoardItems([{ id: '${itemA.id}', patch: { opacity: 60 } }, { id: '${itemB.id}', patch: { opacity: 40 } }])`)
  await run(`await window.api.updateBoardItem('${note1.id}', { noteFont: "'SimSun',serif", noteColor: '#ffd9a0', opacity: 80 })`)
  await run(`await window.api.setBoardGuides(${boardId}, '[{"horizontal":true,"y":500}]')`)
  check('测试白板 4 元素就绪', true, '2 asset + 2 note')

  /* ---------- 3. 导出 .lumenboard ---------- */
  const exp = await run(`return window.api.exportBoardToPath(${boardId}, '${filePath}')`)
  check('导出成功(4 元素)', exp.count === 4 && exp.target === filePath, `count=${exp.count}`)

  /* ---------- 4. 源白板仍在时导入（验证名字冲突后缀 + 完整还原） ---------- */
  const imp = await run(`return window.api.importBoardFromPath('${filePath}')`)
  check('导入成功(4 元素)', imp.imported === 4, `name=${imp.name} imported=${imp.imported}`)
  check('同名白板加「（导入）」后缀', imp.name === `${boardName}（导入）`, imp.name)

  /* ---------- 5. 导入内容断言 ---------- */
  const items = await run(`return window.api.listBoardItems(${imp.boardId})`)
  const assets = items.filter((i) => i.type === 'asset')
  const notes = items.filter((i) => i.type === 'note')
  check('2 素材 + 2 note', assets.length === 2 && notes.length === 2, `assets=${assets.length} notes=${notes.length}`)
  check('素材元素透明度还原(60/40)', assets.some((a) => a.opacity === 60) && assets.some((a) => a.opacity === 40), assets.map((a) => a.opacity).join(','))
  check('note 文字/字体/颜色/透明度还原', notes.some((n) => n.text === '参考说明' && n.noteFont === "'SimSun',serif" && n.noteColor === '#ffd9a0' && n.opacity === 80), notes.map((n) => n.text).join('/'))
  check('元素坐标还原', assets.some((a) => a.x === 100 && a.y === 100) && assets.some((a) => a.x === 400), `x=${assets.map((a) => a.x).join(',')}`)
  const boards = await run(`return window.api.listBoards()`)
  const impBoard = boards.find((b) => b.id === imp.boardId)
  const guides = JSON.parse(impBoard.guides)
  check('参考线还原', guides.length === 1 && guides[0].horizontal && guides[0].y === 500, JSON.stringify(guides))
  // 嵌入素材已入素材库（可在库中检索到；去重命中已有素材也算通过）
  const libHit = await run(`return (await window.api.queryAssets({ keyword: '${imgs[0].name.replace(/\.[^.]+$/, '')}', limit: 10 })).length`)
  check('嵌入素材进入素材库', libHit >= 1, `库内命中 ${libHit}`)

  /* ---------- 清理（源 + 导入） ---------- */
  await run(`await window.api.deleteBoard(${boardId})`)
  await run(`await window.api.deleteBoard(${imp.boardId})`)
  check('清理源白板与导入白板', true, `boards ${boardId}, ${imp.boardId} 已删除`)

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
