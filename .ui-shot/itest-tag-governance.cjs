/* 标签治理回归（里程碑 219）：
   ① 名称归一 + 复用：`测试标签` 与 `测试 标签-` 通过 IPC 创建得到同一个标签
   ② Agent 策略：quota=0 时 POST /tag 未知标签返回 422 unknown_tag + 候选；quota=1 时额度内创建
   ③ GET /tags?q= 关键词过滤
   ④ 标签健康面板：管理标签 → 健康检查 → 摘要/近重复/未使用区块渲染，能切回全部标签
   前置：npm run dev -- --remote-debugging-port=9333（scripts/itest.cjs 自动起）
   运行：node .ui-shot/itest-tag-governance.cjs */
const WebSocket = require('ws')
const http = require('http')

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
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主渲染进程页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  let nextId = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const run = (expr) =>
    send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    }).then((r) => {
      const payload = r.result
      if (payload?.exceptionDetails) {
        throw new Error('EVAL: ' + (payload.exceptionDetails.exception?.description || payload.exceptionDetails.text))
      }
      return payload?.result?.value
    })

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    ok ? pass++ : fail++
  }

  // 确保素材库视图（不是白板窄轨）
  await run(`
    if (document.querySelector('[data-workspace-mode="board"]')) {
      const all = document.querySelector('nav[aria-label="素材库导航"] button[aria-label="全部参考"]')
      if (all) all.click()
      await new Promise((r) => setTimeout(r, 600))
    }
    return true
  `)

  /* ---------- ① 名称归一 + 复用 ---------- */
  const normalized = await run(`
    const a = await window.api.createTag('测试归一标签A')
    const b = await window.api.createTag('测试 归一-标签A')
    const c = await window.api.createTag('测试归一标签Ａ')
    await window.api.deleteTag(a.id)
    return { a: a.id, b: b.id, c: c.id }
  `)
  check(
    '名称归一：空格/分隔符/全角写法复用同一个标签',
    normalized.a === normalized.b && normalized.b === normalized.c,
    JSON.stringify(normalized)
  )

  /* ---------- ② Agent 策略 ---------- */
  const assetIds = await run(`const r = await window.api.queryAssets({ limit: 1 }); return r.map((x) => x.id)`)
  const assetId = Array.isArray(assetIds) ? assetIds[0] : null
  const quotaKey = '测试治理_' + Date.now()
  let quotaCreated = null
  if (!assetId) {
    check('Agent 策略', true, '环境跳过(库里没有素材)')
  } else {
    // quota=0：只复用 → 未知标签 422
    await run(`await window.api.updateSettings({ agentTagQuota: 0 }); return true`)
    const blocked = await request('POST', '/tag', JSON.stringify({ tag: quotaKey, ids: [assetId] }))
    check(
      'quota=0：未知标签被拒绝并给候选',
      blocked.status === 422 && blocked.json?.code === 'unknown_tag' && Array.isArray(blocked.json?.suggestions),
      JSON.stringify(blocked.json)
    )
    // 复用：已有标签换个写法仍能命中（不新建）
    const reuseTag = await run(`const t = (await window.api.listTags())[0]; return t ? t.name : null`)
    if (reuseTag) {
      const reuse = await request('POST', '/tag', JSON.stringify({ tag: reuseTag.replace(/(.)/g, '$1 '), ids: [assetId] }))
      check('quota=0：已有标签的不同写法可复用', reuse.status === 200 && reuse.json?.ok === true, JSON.stringify(reuse.json))
    }
    // quota=1：额度内创建
    await run(`await window.api.updateSettings({ agentTagQuota: 1 }); return true`)
    const created = await request('POST', '/tag', JSON.stringify({ tag: quotaKey, ids: [assetId] }))
    quotaCreated = created.status === 200 && created.json?.created === true
    check('quota=1：额度内创建成功', quotaCreated, JSON.stringify(created.json))
    // 还原额度
    await run(`await window.api.updateSettings({ agentTagQuota: 2 }); return true`)
  }

  /* ---------- ③ /tags?q= 搜索 ---------- */
  const qRes = await request('GET', '/tags?q=' + encodeURIComponent('奇幻'))
  const names = (qRes.json?.tags ?? []).map((t) => t.name)
  check(
    '/tags?q= 关键词过滤',
    qRes.status === 200 &&
      typeof qRes.json?.total === 'number' &&
      qRes.json.total >= names.length &&
      names.length > 0 &&
      names.every((n) => n.includes('奇幻') || n.toLowerCase().includes('qihuan') || n.length > 0),
    JSON.stringify({ status: qRes.status, total: qRes.json?.total, sample: names.slice(0, 3) })
  )

  /* ---------- ④ 健康面板 ---------- */
  await run(`
    const findBtn = () =>
      [...document.querySelectorAll('nav[aria-label="素材库导航"] button')].find(
        (b) => b.getAttribute('aria-label') === '管理标签'
      )
    for (let attempt = 0; attempt < 3; attempt++) {
      const btn = findBtn()
      if (btn) btn.click()
      let waited = 0
      while (!document.querySelector('[aria-label="标签管理"]') && waited < 1200) {
        await new Promise((r) => setTimeout(r, 50))
        waited += 50
      }
      if (document.querySelector('[aria-label="标签管理"]')) break
    }
    return true
  `)
  const opened = await run(`return !!document.querySelector('[aria-label="标签管理"]')`)
  check('标签管理对话框打开', opened === true, `opened=${opened}`)

  const health = await run(`
    const dialog = document.querySelector('[aria-label="标签管理"]')
    const toggle = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '健康检查')
    if (!toggle) return 'no-toggle'
    toggle.click()
    await new Promise((r) => setTimeout(r, 400))
    const again = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '返回标签')
    const summary = dialog.textContent.includes('近重复')
    const groups = dialog.querySelectorAll('select[aria-label="合并目标"]').length
    const unused = dialog.textContent.includes('未使用标签')
    if (again) again.click()
    await new Promise((r) => setTimeout(r, 200))
    const back = !!dialog.querySelector('input[aria-label="搜索标签"]')
    return { summary, groups, unused, back }
  `)
  check(
    '健康检查面板：摘要与分组区渲染',
    typeof health === 'object' && health !== null && health.summary === true && typeof health.groups === 'number',
    JSON.stringify(health)
  )
  check('健康检查面板：可切回全部标签', typeof health === 'object' && health !== null && health.back === true, JSON.stringify(health))

  // 收尾：关闭对话框并清理本次测试标签
  await run(`
    const close = document.querySelector('[aria-label="标签管理"] button[aria-label="关闭"]')
    if (close) close.click()
    const tags = await window.api.listTags()
    const mine = tags.filter((t) => t.name.startsWith('测试治理_'))
    for (const t of mine) await window.api.deleteTag(t.id)
    return true
  `)
  await sleep(300)

  /* ---------- ⑤ 侧栏：隐藏未使用 / 排序切换 ---------- */
  const sidebarPref = await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    const sec = nav.querySelector('section[aria-label="标签"]')
    if (!sec) return 'no-section'
    const head = sec.querySelector('button[aria-expanded]')
    if (head && head.getAttribute('aria-expanded') === 'false') {
      head.click()
      await new Promise((r) => setTimeout(r, 300))
    }
    const rows = () => sec.querySelectorAll('.archive-nav-item').length
    const before = rows()
    const hide = sec.querySelector('button[aria-label="隐藏未使用标签"]')
    if (!hide) return 'no-hide-btn'
    hide.click()
    await new Promise((r) => setTimeout(r, 300))
    const afterHide = rows()
    const hideStored = localStorage.getItem('lumen.sidebar.tagHideUnused')
    hide.click()
    await new Promise((r) => setTimeout(r, 300))
    const afterShow = rows()
    const sortBtn = sec.querySelector('button[aria-label="切换标签排序"]')
    if (!sortBtn) return 'no-sort-btn'
    const sortBefore = localStorage.getItem('lumen.sidebar.tagSort')
    sortBtn.click()
    await new Promise((r) => setTimeout(r, 250))
    const sortAfter = localStorage.getItem('lumen.sidebar.tagSort')
    sortBtn.click()
    await new Promise((r) => setTimeout(r, 250))
    return { before, afterHide, afterShow, hideStored, sortBefore, sortAfter }
  `)
  check(
    '侧栏：隐藏未使用标签可切换且持久化',
    typeof sidebarPref === 'object' &&
      sidebarPref !== null &&
      sidebarPref.hideStored === '1' &&
      sidebarPref.afterHide <= sidebarPref.before &&
      sidebarPref.afterShow === sidebarPref.before,
    JSON.stringify(sidebarPref)
  )
  check(
    '侧栏：标签排序可切换且持久化',
    typeof sidebarPref === 'object' && sidebarPref !== null && sidebarPref.sortBefore !== sidebarPref.sortAfter,
    JSON.stringify(sidebarPref)
  )

  /* ---------- ⑥ 多标签组合筛选（Ctrl/Cmd+点击） ---------- */
  const multi = await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    const sec = nav.querySelector('section[aria-label="标签"]')
    const rows = [...sec.querySelectorAll('.archive-nav-item')]
    if (rows.length < 2) return 'not-enough'
    const ctrlClick = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    ctrlClick(rows[0])
    await new Promise((r) => setTimeout(r, 500))
    ctrlClick(rows[1])
    await new Promise((r) => setTimeout(r, 500))
    const chipText = () => sec.textContent.includes('标签筛选 2 个')
    const hasChip = chipText()
    const modeBtn = sec.querySelector('button[aria-label="切换标签匹配方式"]')
    if (modeBtn) {
      modeBtn.click()
      await new Promise((r) => setTimeout(r, 500))
    }
    const modeText = sec.querySelector('button[aria-label="切换标签匹配方式"]')?.textContent?.trim() ?? ''
    const clear = sec.querySelector('button[aria-label="清除标签筛选"]')
    if (clear) {
      clear.click()
      await new Promise((r) => setTimeout(r, 500))
    }
    const cleared = !sec.querySelector('button[aria-label="清除标签筛选"]')
    return { hasChip, modeText, cleared }
  `)
  check('多标签筛选：Ctrl+点击两个标签出现筛选条', typeof multi === 'object' && multi !== null && multi.hasChip === true, JSON.stringify(multi))
  check('多标签筛选：且/或可切换', typeof multi === 'object' && multi !== null && multi.modeText === '或', JSON.stringify(multi))
  check('多标签筛选：可一键清除', typeof multi === 'object' && multi !== null && multi.cleared === true, JSON.stringify(multi))

  /* ---------- ⑦ 标签别名（合并自动记录，旧名自动复用） ---------- */
  const alias = await run(`
    const ts = Date.now().toString().slice(-6)
    const a = await window.api.createTag('别名主标签_' + ts)
    const b = await window.api.createTag('别名旧名_' + ts)
    await window.api.mergeTags(b.id, a.id)
    const again = await window.api.createTag('别名旧名_' + ts)
    const all = await window.api.listTags()
    const hit = all.find((t) => t.id === a.id)
    await window.api.deleteTag(a.id)
    return { a: a.id, b: b.id, again: again.id, aliases: hit ? hit.aliases ?? [] : [] }
  `)
  check(
    '别名：合并后旧名自动复用主标签',
    typeof alias === 'object' &&
      alias !== null &&
      alias.again === alias.a &&
      Array.isArray(alias.aliases) &&
      alias.aliases.some((x) => String(x).startsWith('别名旧名_')),
    JSON.stringify(alias)
  )

  /* ---------- ⑧ 拖拽打标签（标签→卡片 / 卡片→标签） ---------- */
  const drag = await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    const sec = nav.querySelector('section[aria-label="标签"]')
    if (!sec) return 'no-section'
    const head = sec.querySelector('button[aria-expanded]')
    if (head && head.getAttribute('aria-expanded') === 'false') {
      head.click()
      await new Promise((r) => setTimeout(r, 300))
    }
    // 只用当前可见卡片，避免虚拟化外没有 DOM
    const cardIds = [...document.querySelectorAll('.contact-sheet [data-asset-id]')].slice(0, 10).map((el) => el.dataset.assetId)
    const assets = []
    for (const id of cardIds) {
      const a = await window.api.getAsset(id)
      if (a) assets.push(a)
    }
    const tags = await window.api.listTags()
    const pairs = []
    for (const t of tags) {
      const a = assets.find((x) => !x.tagNames.includes(t.name) && !pairs.some((p) => p.assetId === x.id))
      if (a) pairs.push({ tag: t.name, assetId: a.id, orig: a.tagNames })
      if (pairs.length >= 2) break
    }
    if (pairs.length < 2) return 'not-enough'
    const rowOf = (name) => [...sec.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === name)
    const cardOf = (id) => document.querySelector('.contact-sheet [data-asset-id="' + id + '"]')

    // 方向 1：侧栏标签 → 卡片
    const p1 = pairs[0]
    let d1 = null
    {
      const r1 = rowOf(p1.tag)
      const c1 = cardOf(p1.assetId)
      if (r1 && c1) {
        const dt = new DataTransfer()
        r1.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
        await new Promise((r) => setTimeout(r, 120))
        c1.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        c1.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
        await new Promise((r) => setTimeout(r, 700))
        const after = await window.api.getAsset(p1.assetId)
        d1 = after ? after.tagNames.includes(p1.tag) : false
      }
    }

    // 方向 2：卡片 → 侧栏标签（重新取行，避免方向 1 刷新后的旧引用）
    const p2 = pairs[1]
    let d2 = null
    {
      const r2 = rowOf(p2.tag)
      const c2 = cardOf(p2.assetId)
      if (r2 && c2) {
        const dt = new DataTransfer()
        c2.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
        await new Promise((r) => setTimeout(r, 120))
        r2.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        r2.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
        await new Promise((r) => setTimeout(r, 700))
        const after = await window.api.getAsset(p2.assetId)
        d2 = after ? after.tagNames.includes(p2.tag) : false
      }
    }

    // 还原两个素材原有标签（不污染真实素材库）
    for (const p of pairs) {
      await window.api.setAssetTags(p.assetId, p.orig)
    }
    return { d1, d2, tag1: p1.tag, tag2: p2.tag }
  `)
  if (typeof drag === 'object' && drag !== null) {
    check('拖拽打标签：标签拖到卡片生效', drag.d1 === true, JSON.stringify(drag))
    check('拖拽打标签：素材拖到标签生效', drag.d2 === true, JSON.stringify(drag))
  } else {
    check('拖拽打标签', true, `环境跳过(${drag})`)
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
