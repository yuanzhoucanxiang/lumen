/* 助手——对话式找图（里程碑 161/162）验证：
   ① UI:左侧栏「助手」入口打开右侧面板,空态示例可见,再点关闭
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
const zlib = require('zlib')
const { execSync } = require('child_process')

/**
 * 生成指定纯色的合法 PNG(width×height)。
 * 夹具要求:①每次运行随机颜色 => 字节唯一,不会被跨轮遗留素材的哈希查重跳过;
 * ②两张夹具必须**不同尺寸**——纯色图的 dHash 恒为零且同尺寸 PNG 结构相同(文件大小也相同),
 *   同尺寸会命中 hash+size 查重导致第二张被跳过(实测:2x2+2x2 => imported 只剩 1);
 * ③宽高相等才能命中 shape=square 断言。
 */
function makeUniquePng(W, H) {
  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // RGB
  const r = Math.floor(Math.random() * 256)
  const g = Math.floor(Math.random() * 256)
  const b = Math.floor(Math.random() * 256)
  const raw = []
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3)
    for (let x = 0; x < W; x++) {
      row[1 + x * 3] = r
      row[2 + x * 3] = g
      row[3 + x * 3] = b
    }
    raw.push(row)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(raw))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const PORT = Number(process.env.LUMEN_CLIP_PORT) || 45678
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

  /* ---------- 准备:导入带标签/不带标签的测试素材各一(每次运行随机色 => 字节唯一、可解码) ---------- */
  const tag = 'agentpanel-' + Date.now().toString(36)
  const TAG_NAME = `${tag}-标签`
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agentpanel-'))
  const taggedPng = path.join(tmpDir, `${tag}-tagged.png`)
  const plainPng = path.join(tmpDir, `${tag}-plain.png`)
  fs.writeFileSync(taggedPng, makeUniquePng(2, 2))
  fs.writeFileSync(plainPng, makeUniquePng(4, 4))
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
      const btn = btns.find((b) => (b.getAttribute('title') || '').includes('助手：对话式找图'))
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
      hasTitle: text.includes('对话式找图'),
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

  /* ---------- 3b. 沉淀:全量结果 + 智能文件夹(含来源条件,里程碑 163) ---------- */
  const full = await run(`return await window.api.agentSearchFull({ keyword: ${JSON.stringify(tag)} })`)
  check('agentSearchFull 回传完整素材(含 tagNames)',
    full.length === 2 && full.every((a) => a.name.includes(tag) && Array.isArray(a.tagNames)),
    `count=${full.length}`)

  /* ---------- 3c. 打标签沉淀(agentTag,里程碑 166) ---------- */
  const BATCH_TAG = `${TAG_NAME}-批量`
  const rTagged = await run(`
    const r = await window.api.agentTag({ keyword: ${JSON.stringify(tag)} }, ${JSON.stringify(BATCH_TAG)})
    const assets = await window.api.queryAssets({ limit: 5000 })
    const mine = assets.filter((a) => a.name.includes(${JSON.stringify(tag)}))
    return { tagged: r.tagged, mine: mine.length, withTag: mine.filter((a) => (a.tagNames || []).includes(${JSON.stringify(BATCH_TAG)})).length }
  `)
  check('agentTag 按条件给全部命中素材打标签', rTagged.tagged === 2 && rTagged.withTag === 2 && rTagged.mine === 2,
    JSON.stringify(rTagged))
  const rTagAgain = await run(`return await window.api.agentTag({ keyword: ${JSON.stringify(tag)} }, ${JSON.stringify(BATCH_TAG)})`)
  check('agentTag 幂等(重复打不报错不重复)', rTagAgain.tagged === 2, `tagged=${rTagAgain.tagged}`)
  const rTagEmpty = await run(`return await window.api.agentTag({ keyword: ${JSON.stringify(tag)} }, '   ')`)
  check('agentTag 空标签名返回 0', rTagEmpty.tagged === 0, `tagged=${rTagEmpty.tagged}`)

  const SMART_NAME = `${tag}-智能夹`
  const SMART_EMPTY = `${tag}-空夹`
  // 注意:run() 自带 async IIFE 包裹,这里直接写语句,不要再包一层 (async () => {}) —— 否则返回 undefined
  const smartMade = await run(`
    const f1 = await window.api.createFolder(${JSON.stringify(SMART_NAME)}, null, 1, JSON.stringify({ keyword: ${JSON.stringify(tag)}, source: 'agent' }))
    const f2 = await window.api.createFolder(${JSON.stringify(SMART_EMPTY)}, null, 1, JSON.stringify({ keyword: ${JSON.stringify(tag)}, source: 'manual' }))
    return { f1: f1.id, f2: f2.id }
  `)
  const foldersNow = await run(`return await window.api.listFolders()`)
  const sf1 = foldersNow.find((f) => f.name === SMART_NAME)
  const sf2 = foldersNow.find((f) => f.name === SMART_EMPTY)
  const sf1Conds = sf1 ? JSON.parse(sf1.conditions) : {}
  check('智能文件夹按来源条件过滤(source=agent 命中 2)',
    sf1?.isSmart === 1 && sf1?.count === 2 && sf1Conds.source === 'agent' && sf1Conds.keyword === tag,
    `count=${sf1?.count} source=${sf1Conds.source}`)
  check('智能文件夹 source=manual 命中 0(来源条件真正生效)',
    sf2?.isSmart === 1 && sf2?.count === 0,
    `count=${sf2?.count}`)
  await run(`
    if (Number.isInteger(${JSON.stringify(smartMade.f1)})) await window.api.deleteFolder(${JSON.stringify(smartMade.f1)})
    if (Number.isInteger(${JSON.stringify(smartMade.f2)})) await window.api.deleteFolder(${JSON.stringify(smartMade.f2)})
  `)

  /* ---------- 3a. 以图搜图（里程碑 178）：dHash 相似检索 ---------- */
  // 夹具用"有结构的图案"（教训：纯色图的 dHash 恒为零，无法区分相似/不相似）
  const sharp = require('sharp')
  const mk = async (name, svg) => {
    const p = path.join(tmpDir, name)
    await sharp(Buffer.from(svg)).png().toFile(p)
    return p
  }
  const simA = await mk(`${tag}-simA.png`, '<svg width="256" height="256"><rect width="256" height="256" fill="#fff"/><rect x="0" y="0" width="160" height="256" fill="#000"/></svg>')
  const simB = await mk(`${tag}-simB.png`, '<svg width="256" height="256"><rect width="256" height="256" fill="#fff"/><rect x="0" y="0" width="150" height="256" fill="#000"/></svg>')
  const simC = await mk(`${tag}-simC.png`, '<svg width="256" height="256"><rect width="256" height="256" fill="#fff"/><rect x="0" y="0" width="256" height="150" fill="#000"/></svg>')
  await request('POST', '/import', JSON.stringify({ paths: [simA, simB, simC] }))
  const simIds = await run(`return (await window.api.queryAssets({ limit: 5000 })).filter((a) => a.name.startsWith(${JSON.stringify(tag + '-sim')})).map((a) => ({ id: a.id, name: a.name }))`)
  const idA = simIds.find((x) => x.name.includes('simA'))?.id
  const idB = simIds.find((x) => x.name.includes('simB'))?.id
  const idC = simIds.find((x) => x.name.includes('simC'))?.id
  check('以图搜图夹具就位(三张图案图)', !!idA && !!idB && !!idC, JSON.stringify(simIds.map((x) => x.name)))

  const sim = await run(`return await window.api.agentSimilar({ assetId: ${JSON.stringify(idA)} })`)
  const hitB = sim.assets.find((a) => a.id === idB)
  const hitC = sim.assets.find((a) => a.id === idC)
  check('agentSimilar 命中相似图 B(高相似度)', !!hitB && (hitB.matchPct ?? 0) >= 80, `B=${JSON.stringify(hitB)}`)
  check('agentSimilar 不命中结构不同的 C', !hitC, `C=${JSON.stringify(hitC)} matchPct=${hitC?.matchPct}`)
  check('agentSimilar 结果不含参考图自身', !sim.assets.some((a) => a.id === idA), `total=${sim.total}`)

  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(simA).toString('base64')
  const sim2 = await run(`return await window.api.agentSimilar({ dataUrl: ${JSON.stringify(dataUrl)} })`)
  const selfHit = sim2.assets.find((a) => a.id === idA)
  check('agentSimilar 支持外部图片 dataUrl(自匹配 100%)', !!selfHit && selfHit.matchPct === 100, `self=${JSON.stringify(selfHit)}`)

  const simEmpty = await run(`return await window.api.agentSimilar({})`)
  check('agentSimilar 空来源返回空', simEmpty.total === 0, JSON.stringify(simEmpty))

  /* ---------- 3. 关闭面板 ---------- */
  await run(`
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('助手：对话式找图'))
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
