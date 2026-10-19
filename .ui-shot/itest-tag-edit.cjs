/* 标签交互回归（里程碑 208）：
   ① 图库滚动位置在打标签后不被顶回上方（就地更新，不重查列表）
   ② 预览信息面板可以直接加/删标签（放大看图时不必回详情栏）
   ③ 预览快捷键不会误伤标签输入框（在输入框里打 i 不应切换面板）
   前置：npm run dev -- --remote-debugging-port=9333；运行：node .ui-shot/itest-tag-edit.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PORT = Number(process.env.LUMEN_CLIP_PORT) || 45678
const AUTH = { 'x-lumen-client': 'lumen-clip/1', 'content-type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
function request(method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const h = { host: '127.0.0.1', port: PORT, path: reqPath, method, agent: false, headers: { ...AUTH } }
    if (body != null) h.headers['Content-Length'] = Buffer.byteLength(body)
    const req = http.request(h, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        let json = null
        try {
          json = JSON.parse(d)
        } catch {
          /* 非 JSON 留 null */
        }
        resolve({ status: res.statusCode, json })
      })
    })
    req.on('error', reject)
    req.end(body ?? undefined)
  })
}

async function main() {
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
    if (ok) pass++
    else fail++
  }

  const tag = 'tagedit-' + Date.now().toString(36)
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
      pending.set(mid, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)))
      ws.send(
        JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })
      )
    })
  const run = async (expr) => {
    const r = await evalJs(`(async () => { ${expr} })()`)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }

  // 准备：导入两张图（内容随机，避免与库内素材命中判重）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-tagedit-'))
  const head = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  fs.writeFileSync(path.join(dir, `${tag}-a.png`), Buffer.concat([head, require('crypto').randomBytes(16)]))
  fs.writeFileSync(path.join(dir, `${tag}-b.png`), Buffer.concat([head, require('crypto').randomBytes(16)]))
  const imp = await request('POST', '/import', JSON.stringify({ paths: [dir] }))
  check('准备两张素材', imp.status === 200 && imp.json?.imported === 2, `imported=${imp.json?.imported}`)

  // 切到「全部素材」并等待图库就绪
  await run(`
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '全部素材')
    if (btn) btn.click()
  `)
  for (let i = 0; i < 20; i++) {
    const ready = await run(`return !!document.querySelector('.asset-card')`)
    if (ready) break
    await sleep(300)
  }

  // ① 滚动位置：滚到下方 → 详情栏加标签 → 滚动位置保持
  const scrollInfo = await run(`
    const card = document.querySelector('.asset-card')
    const el = card ? card.closest('.modal-scroll') : null
    if (!el) return { ok: false, reason: 'no scroll container' }
    el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, 400))
    await new Promise((r) => setTimeout(r, 250))
    return { ok: el.scrollHeight > el.clientHeight + 10 && el.scrollTop > 0, top: el.scrollTop }
  `)
  if (!scrollInfo.ok) {
    check('图库可滚动(素材不足或已在顶部则跳过滚动断言)', true, `跳过:${JSON.stringify(scrollInfo)}`)
  } else {
    await run(`document.querySelector('.asset-card')?.click()`)
    await sleep(400)
    const added = await run(`
      const input = document.querySelector('#tag-input') || document.querySelector('.archive-inspector input[type="text"]')
      if (!input) return { ok: false, reason: 'no tag input' }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(tag + '-scrolltag')})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise((r) => setTimeout(r, 800))
      const card = document.querySelector('.asset-card')
      const el = card ? card.closest('.modal-scroll') : null
      return { ok: true, top: el ? el.scrollTop : -1 }
    `)
    check('打标签后图库滚动位置没被顶回上方', added.ok && added.top === scrollInfo.top, `before=${scrollInfo.top} after=${added.top}`)
    const tagged = await request('GET', `/assets?tag=${encodeURIComponent(tag + '-scrolltag')}&limit=5`)
    check('标签已写入库', (tagged.json?.count ?? 0) >= 1, `count=${tagged.json?.count}`)
  }

  // ①b 批量打标签（选区操作条）同样不能把滚动顶回上方
  const batchTag = tag + '-batchtag'
  const batch = await run(`
    const cards = [...document.querySelectorAll('.asset-card')]
    if (cards.length < 2) return { ok: false, reason: 'less than 2 cards' }
    const el = cards[0].closest('.modal-scroll')
    if (!el) return { ok: false, reason: 'no scroll container' }
    el.scrollTop = Math.max(el.scrollTop, 200)
    await new Promise((r) => setTimeout(r, 200))
    // 先点空白清空选择，否则点"已选中的单张"会把它取消掉（toggle 语义）
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    cards[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await new Promise((r) => setTimeout(r, 400))
    const openBtn = document.querySelector('button[aria-label="为所选素材添加标签"]')
    if (!openBtn) return { ok: false, reason: 'no selection bar tag button' }
    openBtn.click()
    await new Promise((r) => setTimeout(r, 200))
    const input = document.querySelector('input[aria-label="批量标签名"]')
    if (!input) return { ok: false, reason: 'no batch tag input' }
    const topBefore = el.scrollTop
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(batchTag)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((r) => setTimeout(r, 900))
    return { ok: true, topBefore, topAfter: el.scrollTop, cards: document.querySelectorAll('.asset-card').length }
  `)
  check('批量打标签后滚动位置保持不变', batch.ok && batch.topAfter === batch.topBefore, JSON.stringify(batch))
  const batchCount = await request('GET', `/assets?tag=${encodeURIComponent(batchTag)}&limit=10`)
  check('批量标签已写入两件素材', (batchCount.json?.count ?? 0) === 2, `count=${batchCount.json?.count}`)
  await run(`document.querySelector('button[aria-label="清除选择"]')?.click()`)

  // ② 预览信息面板：加标签 / 输入框打字不触发快捷键 / 删标签
  const preview = await run(`
    const card = document.querySelector('.asset-card')
    if (!card) return { ok: false, stage: 'no card' }
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 700))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }))
    await new Promise((r) => setTimeout(r, 350))
    const input = document.querySelector('input[aria-label="添加标签"]')
    if (!input) return { ok: false, stage: 'no preview tag input' }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(tag + '-previewtag')})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // 在输入框里打 i：面板不应被快捷键切走
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }))
    await new Promise((r) => setTimeout(r, 250))
    const stillOpen = !!document.querySelector('input[aria-label="添加标签"]')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((r) => setTimeout(r, 800))
    const delBtn = document.querySelector('button[aria-label="删除标签 ${tag}-previewtag"]')
    return { ok: true, stillOpen, hasChip: !!delBtn }
  `)
  check('预览信息面板有标签输入且打字不触发快捷键', preview.ok && preview.stillOpen, JSON.stringify(preview))
  const previewTagged = await request('GET', `/assets?tag=${encodeURIComponent(tag + '-previewtag')}&limit=5`)
  check('预览里加的标签已写入库且显示为可删 chip', (previewTagged.json?.count ?? 0) >= 1 && preview.hasChip, `count=${previewTagged.json?.count}`)
  const removed = await run(`
    const btn = document.querySelector('button[aria-label="删除标签 ${tag}-previewtag"]')
    if (!btn) return { ok: false }
    btn.click()
    await new Promise((r) => setTimeout(r, 800))
    return { ok: true, gone: !document.querySelector('button[aria-label="删除标签 ${tag}-previewtag"]') }
  `)
  const previewTagLeft = await request('GET', `/assets?tag=${encodeURIComponent(tag + '-previewtag')}&limit=5`)
  check('预览里删标签生效', removed.ok && removed.gone && (previewTagLeft.json?.count ?? 0) === 0, JSON.stringify({ removed, left: previewTagLeft.json?.count }))
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  // ③ 方向键翻到很后面再关预览 → 瀑布流跟到最后看的那张（里程碑 210）
  const nav = await run(`
    const cards = [...document.querySelectorAll('.asset-card')]
    if (!cards.length) return { ok: false, reason: 'no cards' }
    const el = cards[0].closest('.modal-scroll')
    if (!el) return { ok: false, reason: 'no scroll container' }
    el.scrollTop = 0
    await new Promise((r) => setTimeout(r, 250))
    cards[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 700))
    for (let i = 0; i < 40; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await new Promise((r) => setTimeout(r, 40))
    }
    await new Promise((r) => setTimeout(r, 300))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 600))
    const card = document.querySelector('.asset-card')
    const sc = card ? card.closest('.modal-scroll') : el
    return { ok: true, top: sc ? sc.scrollTop : -1, cards: document.querySelectorAll('.asset-card').length }
  `)
  check('方向键翻页后关闭预览，瀑布流跟到最后看的那张', nav.ok && nav.top > 0 && nav.cards > 0, JSON.stringify(nav))

  // 清理：软删测试素材 + 删测试标签
  const cleanup = await run(`
    const all = await window.api.queryAssets({ limit: 5000 })
    const ids = all.filter((x) => x.name.startsWith('tagedit-')).map((x) => x.id)
    if (ids.length > 0) await window.api.deleteAssets(ids, false)
    const tags = await window.api.listTags()
    const tids = tags.filter((x) => x.name.startsWith('tagedit-')).map((x) => x.id)
    for (const tid of tids) await window.api.deleteTag(tid)
    return { assets: ids.length, tags: tids.length }
  `)
  check('清理测试素材与标签', cleanup.assets >= 2, JSON.stringify(cleanup))
  fs.rmSync(dir, { recursive: true, force: true })

  console.log('')
  console.log(`${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(2)
})
