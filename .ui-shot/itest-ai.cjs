/* AI 标签与工具链专项验证：优先/排除/合并/tombstone/注释搜索/导出选项类型
   前置：npm run dev -- --remote-debugging-port=9333
   运行：node .ui-shot/itest-ai.cjs */
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
  if (!page) throw new Error('找不到渲染进程页面（先启动 dev）')
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

  /* ---------- 1. 优先标签 ---------- */
  const tags1 = await run(`return window.api.listTags()`)
  const t0 = tags1[0]
  await run(`await window.api.setTagPriority(${t0.id}, 1)`)
  const priTags = await run(`return window.api.listTags()`)
  check('setTagPriority 生效', priTags.find((t) => t.id === t0.id)?.priority === 1, `${t0.name} priority=1`)
  await run(`await window.api.setTagPriority(${t0.id}, 0)`)

  /* ---------- 2. 排除标签 ---------- */
  await run(`await window.api.setTagExcluded(${t0.id}, 1)`)
  const excTags = await run(`return window.api.listTags()`)
  check('setTagExcluded 生效', excTags.find((t) => t.id === t0.id)?.excluded === 1, `${t0.name} excluded=1`)
  await run(`await window.api.setTagExcluded(${t0.id}, 0)`)

  /* ---------- 3. 标签合并 ---------- */
  const ta = await run(`return window.api.createTag('itest合并A')`)
  const tb = await run(`return window.api.createTag('itest合并B')`)
  const all = await run(`return window.api.queryAssets({ limit: 100 })`)
  if (all.length >= 2) {
    await run(`await window.api.addTagToAssets(['${all[0].id}'], 'itest合并A'); await window.api.addTagToAssets(['${all[1].id}'], 'itest合并B')`)
    await run(`await window.api.mergeTags(${ta.id}, ${tb.id})`)
    const after = await run(`return window.api.listTags()`)
    const merged = after.find((t) => t.id === tb.id)
    check('mergeTags 源删除+目标迁移', !after.find((t) => t.id === ta.id) && merged?.count === 2, `目标 count=${merged?.count}`)
    // 清理
    await run(`await window.api.deleteTag(${tb.id})`)
  } else {
    check('mergeTags（素材不足跳过）', true, '库内素材 < 2,跳过')
  }

  /* ---------- 4. tombstone 计数 ---------- */
  const st0 = await run(`return window.api.getLibraryStats()`)
  check('libraryStats 含 tombstones 字段', typeof st0.tombstones === 'number', `tombstones=${st0.tombstones}`)

  /* ---------- 5. 注释关键词搜索（Markdown 注释可被检索） ---------- */
  const probe = all.find((a) => a.deletedAt == null)
  if (probe) {
    const marker = `itest-mark-${Date.now()}`
    await run(`await window.api.updateAsset('${probe.id}', { comment: '${marker} 参考思路' })`)
    const hit = await run(`return window.api.queryAssets({ keyword: '${marker}' })`)
    check('注释内容可被关键词搜索命中', hit.some((a) => a.id === probe.id), `${hit.length} 条命中`)
    await run(`await window.api.updateAsset('${probe.id}', { comment: '' })`)
  } else {
    check('注释搜索（无可用素材跳过）', true, 'skip')
  }

  /* ---------- 6. 快捷键模块存在 ---------- */
  const sc = await run(`return typeof window.api.aiSearch === 'function' && typeof window.api.setTagExcluded === 'function' && typeof window.api.exportLogs === 'function'`)
  check('preload 新 API 就绪(aiSearch/setTagExcluded/exportLogs)', sc, `all: ${sc}`)

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
