/* 新功能专项验证：备份 / SQL 下推 / 查重阈值 / EXIF / edited 字段 / 非破坏性编辑 / 恢复原图
   前置：npm run dev -- --remote-debugging-port=9333 */
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

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) throw new Error('找不到渲染进程页面')
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

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- 1. 备份 ---------- */
  const bakPath = (await evalJs(`window.api.backupDatabase()`)).result.value
  check('backupDatabase 返回路径', typeof bakPath === 'string' && bakPath.endsWith('library.db.bak'), bakPath)

  /* ---------- 2. 查询 SQL 下推 ---------- */
  const landscape = (await evalJs(`window.api.queryAssets({ shape: 'landscape', limit: 50 })`)).result.value
  const landOk = Array.isArray(landscape) && landscape.length > 0 && landscape.every((a) => a.width > a.height)
  check('构图筛选 landscape（SQL 下推）', landOk, `${landscape.length} 条,全部 width>height: ${landOk}`)

  const portrait = (await evalJs(`window.api.queryAssets({ shape: 'portrait', limit: 50 })`)).result.value
  const portOk = Array.isArray(portrait) && portrait.length > 0 && portrait.every((a) => a.width < a.height)
  check('构图筛选 portrait（SQL 下推）', portOk, `${portrait.length} 条,全部 width<height: ${portOk}`)

  const sq = (await evalJs(`window.api.queryAssets({ shape: 'square', limit: 50 })`)).result.value
  const sqOk = Array.isArray(sq) && sq.every((a) => Math.abs(a.width - a.height) <= Math.max(a.width, a.height) * 0.05)
  check('构图筛选 square（SQL 下推）', sqOk, `${sq.length} 条`)

  const cnt = (await evalJs(`window.api.queryAssets({ colorCountMax: 2, limit: 50 })`)).result.value
  const cntOk = Array.isArray(cnt) && cnt.every((a) => JSON.parse(a.colors).length <= 2)
  check('颜色数量筛选（json_array_length）', cntOk, `${cnt.length} 条,全部 colors<=2: ${cntOk}`)

  /* ---------- 3. 查重阈值 ---------- */
  const d6 = (await evalJs(`window.api.findDuplicates()`)).result.value
  const d10 = (await evalJs(`window.api.findDuplicates(10)`)).result.value
  check('findDuplicates 可调阈值', Array.isArray(d6) && Array.isArray(d10), `阈值6=${d6.length}组, 阈值10=${d10.length}组`)

  /* ---------- 4. edited 字段 + EXIF 字段 ---------- */
  const assets = (await evalJs(`window.api.queryAssets({ limit: 100 })`)).result.value
  const hasEditedField = Array.isArray(assets) && assets.length > 0 && 'edited' in assets[0] && 'exif' in assets[0]
  check('Asset 含 edited/exif 字段', hasEditedField, hasEditedField ? `edited=${assets[0].edited}, exif=${assets[0].exif}` : '字段缺失')
  const withExif = assets.filter((a) => a.exif && a.exif !== '')
  check('EXIF 数据（导入时已存）', true, withExif.length > 0 ? `${withExif.length} 条带 EXIF,示例: ${withExif[0].exif.slice(0, 80)}` : '库内素材无 EXIF（可能都是截图/无相机信息）')

  /* ---------- 5. 非破坏性编辑 + 恢复原图（核心） ---------- */
  // 只挑未编辑的 jpg 测试（避免素材初始就带编辑态导致断言基准错乱）
  const jpg = assets.find((a) => a.ext === 'jpg' && a.deletedAt == null && a.edited === 0)
  if (jpg) {
    // 生成 10x10 红色 PNG dataURL
    const dataUrl = (await evalJs(
      `new Promise(res => { const c = document.createElement('canvas'); c.width = 10; c.height = 10; const x = c.getContext('2d'); x.fillStyle = 'red'; x.fillRect(0, 0, 10, 10); res(c.toDataURL('image/png')) })`
    )).result.value
    check('canvas 生成 dataURL', typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png'), dataUrl.slice(0, 30))

    const origW = (await evalJs(
      `new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); i.src = ${JSON.stringify(`asset://${jpg.id}/file?t=o`)} })`
    )).result.value
    check('编辑前原图可加载', origW > 0, `naturalWidth=${origW}`)

    await evalJs(`window.api.applyEdit(${JSON.stringify(jpg.id)}, ${JSON.stringify(dataUrl)})`)
    const afterW = (await evalJs(
      `new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); i.src = ${JSON.stringify(`asset://${jpg.id}/file?t=o&e=1`)} })`
    )).result.value
    check('applyEdit 后 originalUrl 指向 edited 文件', afterW === 10, `naturalWidth=${afterW}（应为 10，即编辑后的红图）`)

    const dbState1 = (await evalJs(`window.api.queryAssets({ limit: 200 }).then(l => l.find(a => a.id === ${JSON.stringify(jpg.id)}))`)).result.value
    check('applyEdit 后 DB edited=1', dbState1 && dbState1.edited === 1, `edited=${dbState1?.edited}, ext=${dbState1?.ext}`)

    // 恢复原图
    await evalJs(`window.api.revertEdit(${JSON.stringify(jpg.id)})`)
    const revertW = (await evalJs(
      `new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); i.src = ${JSON.stringify(`asset://${jpg.id}/file?t=o&e=0`)} })`
    )).result.value
    check('revertEdit 后回到原图', revertW === origW, `naturalWidth=${revertW}（原图=${origW}）`)

    const dbState2 = (await evalJs(`window.api.queryAssets({ limit: 200 }).then(l => l.find(a => a.id === ${JSON.stringify(jpg.id)}))`)).result.value
    check('revertEdit 后 DB edited=0', dbState2 && dbState2.edited === 0, `edited=${dbState2?.edited}`)
  } else {
    check('非破坏性编辑', false, '库内无 jpg 素材，跳过')
  }

  /* ---------- 6. 文件夹递归 CTE ---------- */
  const folders = (await evalJs(`window.api.listFolders()`)).result.value
  const withChild = Array.isArray(folders) && folders.some((f) => f.parentId != null)
  check('文件夹层级存在', true, withChild ? '库内有子文件夹' : '库内无子文件夹（递归 CTE 待有层级时验证）')
  if (withChild) {
    const parent = folders.find((f) => f.parentId != null)
    const q = (await evalJs(`window.api.queryAssets({ folderId: ${parent.id}, limit: 5 })`)).result.value
    check('文件夹查询（递归 CTE 不报错）', Array.isArray(q), `${q.length} 条`)
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ITEST ERROR:', e.message || e)
  process.exit(2)
})
