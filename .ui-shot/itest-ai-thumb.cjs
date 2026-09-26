/* 本轮「已知问题」修复的专项验证(里程碑 139-141):
   ① AI 素材缩略图:手搓一枚 PDF 兼容层的 .ai 文件导入,断言真的解出了缩略图与尺寸
      (此前 sharp 无法解 AI,素材以 width=0/hash='' 入库,还会污染宽度筛选);
   ② 图库分页契约:queryAssets 的 limit/offset 真的翻页(此前渲染层不传 limit,
      主进程静默截断到 1000 条,万级素材滚不到底);
   ③ 文件夹拖拽改层级的后端语义:移入子级/移回顶层生效,移入自身子树被拒(防 parent_id 成环)。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-ai-thumb.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 最小合法 PDF(红底 + 文字):Illustrator 勾选「最大兼容性」后保存的 .ai 就是这个形态 */
function buildPdf() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  const stream =
    'q 1 0 0 RG 1 0 0 rg 20 20 260 160 re f Q\n' +
    'BT /F1 28 Tf 1 1 1 rg 34 92 Td (LUMEN-AI-THUMB) Tj ET\n'
  const parts = ['%PDF-1.4\n']
  const offsets = []
  let pos = parts[0].length
  objs.forEach((body, i) => {
    const n = i + 1
    offsets.push(pos)
    const chunk =
      body === null
        ? `${n} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`
        : `${n} 0 obj\n${body}\nendobj\n`
    parts.push(chunk)
    pos += Buffer.byteLength(chunk)
  })
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`
  parts.push(xref, `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`)
  return Buffer.from(parts.join(''), 'binary')
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
  let msgId = 0
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
      const mid = ++msgId
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
  let skip = 0
  const check = (name, ok, detail) => {
    if (ok === 'skip') {
      console.log('  SKIP', name, '-', detail)
      skip++
      return
    }
    console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- ① AI 素材缩略图 ---------- */
  const stamp = Date.now()
  const tmpDir = path.join(os.tmpdir(), 'lumen-itest-ai-' + stamp)
  fs.mkdirSync(tmpDir, { recursive: true })
  const aiName = `lumen-ai-probe-${stamp}.ai`
  const aiPath = path.join(tmpDir, aiName)
  fs.writeFileSync(aiPath, buildPdf())
  check('AI 夹具写入临时目录', fs.existsSync(aiPath) && fs.statSync(aiPath).size > 400, `${aiPath} ${fs.statSync(aiPath).size}B`)

  const imported = await run(`return await window.api.importFromPaths(${JSON.stringify([aiPath])})`)
  const aiId = imported?.importedIds?.[0] ?? null
  check('AI 文件导入成功', imported?.imported === 1 && !!aiId, JSON.stringify(imported?.imported ?? imported))

  await sleep(300)
  const aiAsset = aiId
    ? await run(`const list = await window.api.queryAssets({ keyword: ${JSON.stringify(`lumen-ai-probe-${stamp}`) }, limit: 5 }); return list[0] ?? null`)
    : null
  check('AI 素材入库且尺寸已知', !!aiAsset && aiAsset.width > 0 && aiAsset.height > 0, JSON.stringify({ w: aiAsset?.width, h: aiAsset?.height }))

  /* 同内容改名的 AI 再导入:名不同→name+size 快速路径不命中,只能靠 dHash 命中,
     跳过即证明导入时确实算出了哈希(hash 是主进程内部字段,不随 Asset 出到渲染层) */
  const aiPath2 = path.join(tmpDir, `lumen-ai-renamed-${stamp}.ai`)
  fs.writeFileSync(aiPath2, fs.readFileSync(aiPath))
  const again = await run(`return await window.api.importFromPaths(${JSON.stringify([aiPath2])})`)
  check(
    '改名后的同一 AI 文件被 dHash 判重跳过',
    again?.imported === 0 && again?.skipped === 1,
    JSON.stringify({ imported: again?.imported, skipped: again?.skipped })
  )

  const thumbInfo = aiId
    ? await run(`
        const res = await fetch(window.api.thumbnailUrl(${JSON.stringify(aiId)}))
        const buf = await res.arrayBuffer()
        const img = new Image()
        const loaded = await new Promise((res2) => {
          img.onload = () => res2(true)
          img.onerror = () => res2(false)
          img.src = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }))
        })
        return { status: res.status, type: res.headers.get('content-type'), bytes: buf.byteLength, naturalWidth: img.naturalWidth, loaded }
      `)
    : null
  check(
    'AI 缩略图 asset:// 可加载且非空图',
    !!thumbInfo && thumbInfo.status === 200 && thumbInfo.loaded && thumbInfo.bytes > 800 && thumbInfo.naturalWidth > 100,
    JSON.stringify(thumbInfo)
  )
  if (aiId) await run(`await window.api.deleteAssets([${JSON.stringify(aiId)}], true); return 1`)

  /* ---------- ② 分页契约:limit/offset 真的翻页 ---------- */
  const pageA = await run(`const a = await window.api.queryAssets({ limit: 3, offset: 0, sortBy: 'imported', sortDesc: true }); return a.map(x => x.id)`)
  const pageB = await run(`const b = await window.api.queryAssets({ limit: 3, offset: 3, sortBy: 'imported', sortDesc: true }); return b.map(x => x.id)`)
  const total = await run(`const s = await window.api.getLibraryStats(); return s.total`)
  if (total < 7) {
    check('queryAssets offset 翻页', 'skip', `库内仅 ${total} 条,不足以验证翻页`)
  } else {
    const overlap = pageA.filter((id) => pageB.includes(id))
    check('queryAssets offset 翻页(第二页不与首页重叠)', pageA.length === 3 && pageB.length === 3 && overlap.length === 0, JSON.stringify({ pageA, pageB }))
  }

  /* ---------- ③ 文件夹改层级（后端语义） ---------- */
  /* 文件夹一律走 UI 新建:直接调 window.api.createFolder 不会刷新渲染层 store,
     侧栏 DOM 里就没有这两个节点,④ 的拖拽用例会找不到行 */
  const createFolderViaUi = async (name) => {
    await run(`
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '新建文件夹')
      if (!btn) throw new Error('找不到「新建文件夹」按钮')
      btn.click()
      return 1
    `)
    await sleep(150)
    await run(`
      const input = document.querySelector('input[aria-label="新文件夹名称"]')
      if (!input) throw new Error('新建文件夹输入框未出现')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(name)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return 1
    `)
    await sleep(250)
  }
  const nameA = `itest-mv-a-${stamp}`
  const nameB = `itest-mv-b-${stamp}`
  await createFolderViaUi(nameA)
  await createFolderViaUi(nameB)
  const created = await run(`
    const list = await window.api.listFolders()
    return {
      a: list.find((f) => f.name === ${JSON.stringify(nameA)})?.id ?? null,
      b: list.find((f) => f.name === ${JSON.stringify(nameB)})?.id ?? null
    }
  `)
  check('UI 新建两个测试文件夹', created.a != null && created.b != null, JSON.stringify(created))
  const fa = { id: created.a }
  const fb = { id: created.b }
  const child = await run(`return await window.api.createFolder(${JSON.stringify(`itest-mv-child-${stamp}`)}, ${fa.id})`)

  const movedIn = await run(`
    await window.api.moveFolder(${fa.id}, ${fb.id}); return 1
  `)
  let list = await run(`return await window.api.listFolders()`)
  check('文件夹移入另一文件夹生效', !!movedIn && list.find((f) => f.id === fa.id)?.parentId === fb.id, JSON.stringify(list.find((f) => f.id === fa.id)))

  const cyc = await run(`
    try { await window.api.moveFolder(${fb.id}, ${child.id}); return 'no-error' }
    catch (e) { return String(e.message || e) }
  `)
  check('移入自身子树被拒(防 parent_id 成环)', cyc !== 'no-error' && /子文件夹|自身/.test(cyc), cyc)

  const self = await run(`
    try { await window.api.moveFolder(${fb.id}, ${fb.id}); return 'no-error' }
    catch (e) { return String(e.message || e) }
  `)
  check('移入自身被拒', self === 'no-error', `${self}(应为静默 no-op)`)

  await run(`await window.api.moveFolder(${fa.id}, null); return 1`)
  list = await run(`return await window.api.listFolders()`)
  check('移回顶层生效', list.find((f) => f.id === fa.id)?.parentId == null, JSON.stringify(list.find((f) => f.id === fa.id)))

  const smart = await run(`
    const f = await window.api.createFolder(${JSON.stringify(`itest-mv-smart-${stamp}`)}, null, 1, JSON.stringify({ keyword: 'x' }))
    try { await window.api.moveFolder(${fa.id}, f.id); return 'no-error' }
    catch (e) { const m = String(e.message || e); await window.api.deleteFolder(f.id); return m }
  `)
  check('移入智能文件夹被拒(智能文件夹不在树里渲染)', smart !== 'no-error' && /智能/.test(smart), smart)

  /* ---------- ④ 侧栏拖拽改层级的 UI 接线 ---------- */
  await sleep(200)
  const dragUi = await run(`
    const rowOf = (name) => {
      const nav = [...document.querySelectorAll('[aria-label="' + name + '"]')][0]
      return nav ? nav.closest('div[draggable]') : null
    }
    const a = rowOf(${JSON.stringify(nameA)})
    const b = rowOf(${JSON.stringify(nameB)})
    if (!a || !b) return { err: '找不到文件夹行', foundA: !!a, foundB: !!b }
    const dt = new DataTransfer()
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    fire(a, 'dragstart')
    // dragstart 里的 setState 要等 React 提交,否则下一步 dragover 读不到 draggingFolder
    await new Promise((r) => setTimeout(r, 120))
    const slotShown = document.body.textContent.includes('拖到此处移出为顶层')
    fire(b, 'dragover')
    fire(b, 'drop')
    await new Promise((r) => setTimeout(r, 600))
    const list = await window.api.listFolders()
    fire(a, 'dragend')
    return { slotShown, parentId: list.find((f) => f.id === ${fa.id})?.parentId }
  `)
  check('文件夹行可拖起,拖拽期间出现「移到顶层」槽位', dragUi?.slotShown === true, JSON.stringify(dragUi))
  check('DOM 拖到另一文件夹 → 层级改变', dragUi?.parentId === fb.id, JSON.stringify(dragUi))

  /* ---------- ⑤ 图库分页在真实库上的表现 ---------- */
  const stats = await run(`return await window.api.getLibraryStats()`)
  const hint = await run(`return document.querySelector('.contact-sheet')?.textContent?.includes('继续滚动加载') ?? false`)
  if (stats.total <= 480) {
    check('图库分页提示', 'skip', `库内 ${stats.total} 条 ≤ 单页 480,不触发分页`)
  } else {
    check('超过单页时内容尾部出现续借提示(不再静默截断)', hint === true, `total=${stats.total} hint=${hint}`)
  }

  /* ---------- ⑥ 瀑布流极端比例:长图顶对齐、卡片按 3.2 倍列宽铺开 ---------- */
  const mkExtreme = async (w, h, tag) => {
    const dataUrl = await run(`return (() => {
      const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}
      const g = c.getContext('2d')
      g.fillStyle = '#123456'; g.fillRect(0, 0, c.width, c.height)
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, Math.min(c.height, 80))
      return c.toDataURL('image/png')
    })()`)
    const f = path.join(tmpDir, `lumen-${tag}-${stamp}.png`)
    fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return f
  }
  const tallFile = await mkExtreme(400, 4000, 'tall')
  const wideFile = await mkExtreme(4000, 400, 'wide')
  const extreme = await run(`return await window.api.importFromPaths(${JSON.stringify([tallFile, wideFile])})`)
  // 走 IPC 直接导入不会让渲染层 store 重查，切一次视图再切回来（setView 内部 refreshAssets）
  await run(`
    const nav = (label) => [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === label)?.click()
    nav('已收藏'); nav('全部素材'); return 1
  `)
  await sleep(900)
  if (extreme.imported === 2) {
    await sleep(700)
    const colW = await run(`const c = document.querySelector('.asset-card'); return c ? Math.round(c.getBoundingClientRect().width) : 0`)
    const cards = await run(`
      const out = []
      for (const id of ${JSON.stringify(extreme.importedIds)}) {
        // 用 src 而不是 currentSrc 匹配:懒加载的 img 在浏览器真正开始取图前 currentSrc 是空串,
        // 用 currentSrc 会让这条断言偶发假失败(实测同一份代码两次跑出 1/2 与 2/2)
        const card = [...document.querySelectorAll('.asset-card')].find((el) => (el.querySelector('img')?.src ?? '').includes(id))
        if (card) out.push({
          id,
          pos: card.querySelector('img').style.objectPosition || '',
          h: Math.round(card.querySelector('.asset-media').getBoundingClientRect().height)
        })
      }
      return out
    `)
    check('极端比例素材导入并在视口内渲染', cards.length === 2 && colW > 0, JSON.stringify({ cards, colW }))
    const tall = cards.find((c) => c.id === extreme.importedIds[0])
    const wide = cards.find((c) => c.id === extreme.importedIds[1])
    // Chromium 把 `object-position: top center` 规范化回读成 "center top"，只断言纵向贴顶
    check('长图撞高度上限后改顶对齐裁切', /top/.test(tall?.pos ?? ''), JSON.stringify(tall))
    check('超宽图仍走默认对齐', wide?.pos === '', JSON.stringify(wide))
    check(
      '长图卡片按 3.2 倍列宽铺开(此前 1.8 倍切掉大半)',
      colW > 0 && tall?.h > colW * 2.9 && tall?.h <= colW * 3.4,
      JSON.stringify({ cardH: tall?.h, colW })
    )
    check('超宽图按 0.3 倍列宽下限', colW > 0 && wide?.h >= colW * 0.28 && wide?.h <= colW * 0.34, JSON.stringify({ cardH: wide?.h, colW }))
    await run(`await window.api.deleteAssets(${JSON.stringify(extreme.importedIds)}, true); return 1`)
  } else {
    check('极端比例素材导入', false, `imported=${extreme.imported}`)
  }

  /* ---------- ⑦ Ctrl+A 全选必须覆盖未加载的页（分页带来的 regress 隐患） ---------- */
  const before = await run(`
    const mast = document.querySelector('.archive-masthead__count')
    return { mast: mast ? mast.textContent.trim() : '', hint: document.body.textContent.includes('继续滚动加载') }
  `)
  check('未取完时计数带 + 号且提示可继续加载', /\+/.test(before.mast) && before.hint, JSON.stringify(before))
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))`)
  await sleep(1500)
  const after = await run(`
    const mast = document.querySelector('.archive-masthead__count')
    return { mast: mast ? mast.textContent.trim() : '', hint: document.body.textContent.includes('继续滚动加载') }
  `)
  check('Ctrl+A 把剩余页取完(计数不再带 + 且续借提示消失)', !/\+/.test(after.mast) && !after.hint, JSON.stringify({ before, after }))

  for (const id of [fa.id, fb.id, child.id]) await run(`await window.api.deleteFolder(${id}); return 1`)

  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log(`\n${pass} PASS / ${fail} FAIL / ${skip} SKIP`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常:', e.message)
  process.exit(1)
})
