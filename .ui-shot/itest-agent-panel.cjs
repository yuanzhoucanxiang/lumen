/* 找图助手（里程碑 161）验证：
   ① UI:工具栏「找图」按钮打开右侧面板,空态示例可见,再点关闭
   ② agentSearch 条件执行(不经过模型,确定性):
      - keyword 命中刚导入的测试素材
      - source=agent 只回 agent 来源 / source=manual 只回手动来源(空 source)
      - untagged 只回无标签素材
      - tag 命中 + 不存在的标签回空
      - 非法/空条件不崩溃且回空
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-agent-panel.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const PORT = 45678
const AUTH = { 'x-lumen-client': 'lumen-clip/1', 'content-type': 'application/json' }

/** 端口守卫:45678 被正式版 LUMEN 占用时,HTTP 请求会打到那个实例(并发写库风险 + 断言失真)。
 *  详见 itest-agent-api.cjs 同名函数的说明。 */
function assertClipPortOwnedByDev() {
  if (process.platform !== 'win32') return
  let out = ''
  try {
    out = execSync('netstat -ano', { encoding: 'utf-8' })
  } catch {
    return
  }
  const pidOf = (port) => {
    const line = out.split(/\r?\n/).find((l) => new RegExp(`:${port}\\s`).test(l) && l.includes('LISTENING'))
    return line ? line.trim().split(/\s+/).pop() : null
  }
  const cdpPid = pidOf(9333)
  const clipPid = pidOf(PORT)
  if (cdpPid && clipPid && cdpPid !== clipPid) {
    throw new Error(
      `端口 ${PORT} 被另一 LUMEN 实例占用(PID ${clipPid} ≠ dev 实例 PID ${cdpPid})。请先关闭已安装的 LUMEN 再跑本测试。`
    )
  }
}

function request(method, reqPath, body, headers = AUTH) {
  return new Promise((resolve, reject) => {
    const h = { host: '127.0.0.1', port: PORT, path: reqPath, method, agent: false, headers: { ...headers } }
    if (body != null) h.headers['Content-Length'] = Buffer.byteLength(body)
    const req = http.request(h, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(d) } catch { /* 非 JSON 留 null */ }
        resolve({ status: res.statusCode, raw: d, json })
      })
    })
    req.on('error', reject)
    req.end(body ?? undefined)
  })
}

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
  assertClipPortOwnedByDev()
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- 准备:导入带标签/不带标签的测试素材各一(真实 PNG 且内容互异,避免哈希查重跳过) ---------- */
  const PNG_1X1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const PNG_2X2_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGM4YaNxwkaDAUIBACNeBLHVZQG1AAAAAElFTkSuQmCC'
  const tag = 'agentpanel-' + Date.now().toString(36)
  const TAG_NAME = `${tag}-标签`
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agentpanel-'))
  const taggedPng = path.join(tmpDir, `${tag}-tagged.png`)
  const plainPng = path.join(tmpDir, `${tag}-plain.png`)
  fs.writeFileSync(taggedPng, Buffer.from(PNG_1X1_B64, 'base64'))
  fs.writeFileSync(plainPng, Buffer.from(PNG_2X2_B64, 'base64'))
  const rImp1 = await request('POST', '/import', JSON.stringify({ paths: [taggedPng], tags: [TAG_NAME] }))
  const rImp2 = await request('POST', '/import', JSON.stringify({ paths: [plainPng] }))
  check('准备:测试素材导入(带标签/不带标签)', rImp1.json?.imported === 1 && rImp2.json?.imported === 1,
    `imp1=${rImp1.json?.imported} imp2=${rImp2.json?.imported}`)

  /* ---------- CDP 会话 ---------- */
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  let id = 0
  const pending = new Map()
  ws.on('message', (m) => {
    const msg = JSON.parse(m.toString())
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  const evalJs = (expression) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)))
      ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
  const run = async (expr) => {
    const r = await evalJs(`(async () => { ${expr} })()`)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }

  /* ---------- 1. UI:面板开关 + 空态 ---------- */
  // 等工具栏渲染就绪(dev 首屏可能稍慢;找不到时输出按钮标题便于自诊断)
  let opened = { found: false }
  for (let attempt = 0; attempt < 20 && !opened.found; attempt++) {
    opened = await run(`
      const btns = [...document.querySelectorAll('button')]
      const btn = btns.find((b) => (b.getAttribute('title') || '').includes('找图助手'))
      if (!btn) return { found: false, count: btns.length, titles: btns.map((b) => b.getAttribute('title')).filter(Boolean).slice(0, 15) }
      btn.click()
      return { found: true }
    `)
    if (!opened.found) await sleep(500)
  }
  await sleep(250)
  const panelState = await run(`
    const panel = document.querySelector('[data-testid="agent-panel"]')
    if (!panel) return { exists: false }
    const text = panel.textContent || ''
    return {
      exists: true,
      hasTitle: text.includes('找图助手'),
      hasHint: text.includes('用一句话描述你想找的素材'),
      exampleChips: [...panel.querySelectorAll('button')].filter((b) => (b.textContent || '').includes('最近一周')).length
    }
  `)
  check('工具栏「找图」按钮打开助手面板', opened.found && panelState.exists && panelState.hasTitle,
    JSON.stringify({ ...opened, ...panelState }))
  check('面板空态含引导语与示例', panelState.hasHint && panelState.exampleChips >= 1, JSON.stringify(panelState))

  /* ---------- 2. agentSearch 条件执行(确定性) ---------- */
  const byKeyword = await run(`return await window.api.agentSearch({ keyword: ${JSON.stringify(tag)} })`)
  const kwOk = byKeyword.assets.length === 2 && byKeyword.assets.every((a) => a.name.includes(tag))
  check('agentSearch keyword 命中 2 个测试素材', kwOk, `total=${byKeyword.total} names=${byKeyword.assets.map((a) => a.name).join(',')}`)

  const taggedOnly = await run(`return await window.api.agentSearch({ keyword: ${JSON.stringify(tag)}, tags: [${JSON.stringify(TAG_NAME)}] })`)
  const tagOk = taggedOnly.total === 1 && taggedOnly.matchedTags.includes(TAG_NAME) && taggedOnly.assets[0].tags.includes(TAG_NAME)
  check('agentSearch 标签条件命中且回传 matchedTags', tagOk, JSON.stringify({ total: taggedOnly.total, matchedTags: taggedOnly.matchedTags }))

  const noSuchTag = await run(`return await window.api.agentSearch({ keyword: ${JSON.stringify(tag)}, tags: ['绝对不存在的标签xyz'] })`)
  check('agentSearch 不存在的标签回空(不退化为全库)', noSuchTag.total === 0 && noSuchTag.matchedTags.length === 0, `total=${noSuchTag.total}`)

  const byAgent = await run(`return await window.api.agentSearch({ keyword: ${JSON.stringify(tag)}, source: 'agent' })`)
  const byManual = await run(`return await window.api.agentSearch({ keyword: ${JSON.stringify(tag)}, source: 'manual' })`)
  check('agentSearch source=agent 只回 agent 来源', byAgent.total === 2 && byAgent.assets.every((a) => a.source === 'agent'),
    `total=${byAgent.total} sources=${[...new Set(byAgent.assets.map((a) => a.source))].join(',')}`)
  check('agentSearch source=manual 只回手动来源(空 source)', byManual.total === 0 && byManual.assets.length === 0,
    `total=${byManual.total}`)

  const untaggedHits = await run(`return await window.api.agentSearch({ keyword: ${JSON.stringify(tag)}, untagged: true })`)
  const untaggedOk = untaggedHits.total === 1 && untaggedHits.assets.every((a) => a.tags.length === 0)
  check('agentSearch untagged 只回无标签素材', untaggedOk, JSON.stringify({ total: untaggedHits.total, tags: untaggedHits.assets.map((a) => a.tags) }))

  const squareHits = await run(`return await window.api.agentSearch({ keyword: ${JSON.stringify(tag)}, shape: 'square' })`)
  check('agentSearch shape=square 命中方图', squareHits.total === 2, `total=${squareHits.total}`)

  const badConds = await run(`
    const a = await window.api.agentSearch(null)
    const b = await window.api.agentSearch({ withinDays: -5, starMin: 999, exts: [123], shape: 'nope' })
    const c = await window.api.agentSearch({ keyword: ${JSON.stringify(tag)}, withinDays: 99999 })
    return { empty: a.total, cleaned: b.total, clamped: c.total }
  `)
  check('agentSearch 非法条件消毒(不崩溃/越界钳制)', badConds.empty === 0 && badConds.cleaned === 0 && badConds.clamped === 2,
    JSON.stringify(badConds))

  /* ---------- 3. 关闭面板 ---------- */
  await run(`
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('找图助手'))
    btn?.click()
  `)
  const closedAfter = await run(`return !document.querySelector('[data-testid="agent-panel"]')`)
  check('再次点击关闭面板', panelState.exists && closedAfter, `panelExisted=${panelState.exists} closedAfter=${closedAfter}`)

  /* ---------- 清理 ---------- */
  const cleanup = await run(`
    const all = await window.api.queryAssets({ limit: 5000 })
    const ids = all.filter((a) => a.name.startsWith('agentpanel-')).map((a) => a.id)
    if (ids.length > 0) await window.api.deleteAssets(ids, false)
    const tags = await window.api.listTags()
    const tids = tags.filter((x) => x.name.includes('agentpanel-')).map((x) => x.id)
    for (const tid of tids) await window.api.deleteTag(tid)
    const folders = await window.api.listFolders()
    const defFolder = folders.find((x) => x.name === 'Agent 导入')
    if (defFolder) await window.api.deleteFolder(defFolder.id)
    return { deleted: ids.length, tags: tids.length }
  `)
  check('清理:测试素材与标签已删', cleanup.deleted >= 2 && cleanup.tags >= 1, JSON.stringify(cleanup))
  fs.rmSync(tmpDir, { recursive: true, force: true })

  console.log('')
  console.log(pass + ' PASS / ' + fail + ' FAIL')
  ws.close()
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
