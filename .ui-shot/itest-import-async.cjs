/* 导入管线异步化专项验证(里程碑 82 / 后端优化阶段 1):
   ①canvas 生成 5 张真实 PNG -> Node 写入临时目录 -> window.api.importFromPaths 真实导入;
   ②导入期间并发 20 次 getAppVersion(),断言每次返回合法版本号且延迟 < 500ms(主进程不被同步 IO 阻塞);
   ③断言收到 3+ 次 import:progress 事件(阶段 A 逐文件 + 阶段 B commit);
   ④断言 5 条记录真实入库(尺寸/哈希由 sharp 管线产出),结束时软删除清理,不污染用户库。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-import-async.cjs */
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

/** 删临时目录:Windows Defender 可能短暂锁定新文件,重试几次 */
function rmTempDir(dir) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    } catch {
      /* 重试 */
    }
  }
  return false
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
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- 0. 渲染进程 canvas 生成 5 张不同色调 PNG(1600x1200,给导入留出耗时) ---------- */
  const dataUrls = await run(`return (() => {
    const out = []
    for (let i = 0; i < 5; i++) {
      const c = document.createElement('canvas')
      c.width = 1600; c.height = 1200
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, 1600, 1200)
      grad.addColorStop(0, 'hsl(' + (i * 72) + ', 85%, 55%)')
      grad.addColorStop(1, 'hsl(' + ((i * 72 + 120) % 360) + ', 70%, 30%)')
      g.fillStyle = grad
      g.fillRect(0, 0, 1600, 1200)
      for (let k = 0; k < 8; k++) {
        g.fillStyle = 'hsla(' + ((i * 40 + k * 33) % 360) + ', 90%, 60%, 0.65)'
        g.beginPath()
        g.arc(200 + k * 170, 300 + ((k * 271) % 700), 60 + ((k * 29) % 50), 0, Math.PI * 2)
        g.fill()
      }
      out.push(c.toDataURL('image/png'))
    }
    return out
  })()`)
  check('canvas 生成 5 张测试 PNG', Array.isArray(dataUrls) && dataUrls.length === 5 && dataUrls.every((d) => d.startsWith('data:image/png;base64,')), `${dataUrls.length} 张`)

  /* ---------- 1. 写入临时目录(文件名带时间戳,避免命中查重快速路径) ---------- */
  const stamp = Date.now()
  const prefix = 'lumen-ia-' + stamp
  const tmpDir = path.join(os.tmpdir(), 'lumen-itest-import-async-' + stamp)
  fs.mkdirSync(tmpDir, { recursive: true })
  const files = []
  for (let i = 0; i < 5; i++) {
    const f = path.join(tmpDir, prefix + '-' + i + '.png')
    fs.writeFileSync(f, Buffer.from(dataUrls[i].split(',')[1], 'base64'))
    files.push(f)
  }
  check('测试图片写入临时目录', files.every((f) => fs.existsSync(f) && fs.statSync(f).size > 1000), tmpDir)

  /* ---------- 2. 真实导入 + 期间并发 20 次 getAppVersion(测主进程不被阻塞) ---------- */
  const res = await run(`return (async () => {
    window.__itestImportProgress = []
    if (!window.__itestIaReg) {
      window.__itestIaReg = true
      window.api.onImportProgress((p) => window.__itestImportProgress.push(p))
    }
    const t0 = performance.now()
    const importPromise = window.api.importFromPaths(${JSON.stringify(files)})
    const lat = await Promise.all(Array.from({ length: 20 }, async () => {
      const s = performance.now()
      const v = await window.api.getAppVersion()
      return { v, ms: performance.now() - s }
    }))
    const r = await importPromise
    // import:progress 事件经 IPC 派发可能晚于 invoke 返回值到达渲染进程,
    // 轮询等待终态 commit 事件(最多 3s),避免竞态漏采
    const tEnd = Date.now() + 3000
    while (Date.now() < tEnd) {
      const arr = window.__itestImportProgress
      const last = arr[arr.length - 1]
      if (last && last.phase === 'commit') break
      await new Promise((rr) => setTimeout(rr, 100))
    }
    return { r, lat, importMs: performance.now() - t0, prog: window.__itestImportProgress }
  })()`)

  check('①真实导入成功(5 张全部入库,0 失败)', res.r.imported === 5 && res.r.failed === 0,
    `imported=${res.r.imported} skipped=${res.r.skipped} failed=${res.r.failed} 耗时=${Math.round(res.importMs)}ms`)

  const okVersion = res.lat.every((x) => typeof x.v === 'string' && /^[0-9]+[.][0-9]+[.][0-9]+$/.test(x.v))
  const maxMs = Math.max(...res.lat.map((x) => x.ms))
  check('②导入期间 20 次并发 getAppVersion 全部正常返回(<500ms)', okVersion && res.lat.length === 20 && maxMs < 500,
    `20/20 ok=${okVersion} 最大延迟=${Math.round(maxMs)}ms`)

  const prepareEvts = res.prog.filter((p) => p.phase === 'prepare')
  const commitEvts = res.prog.filter((p) => p.phase === 'commit')
  check('③收到 3+ 次 import:progress 事件', res.prog.length >= 3,
    `共 ${res.prog.length} 次(prepare=${prepareEvts.length}, commit=${commitEvts.length})`)
  check('③-2 阶段 A 逐文件进度完整(5/5)且终态为 commit',
    prepareEvts.length === 5 && prepareEvts.every((p) => p.total === 5) && commitEvts.some((p) => p.done === p.total && p.total === 5),
    `最后一次=${JSON.stringify(res.prog[res.prog.length - 1])}`)

  /* ---------- 3. 落库校验(尺寸证明 sharp 管线真实跑过;hash 不出渲染层,不校验) + 软删除清理 ---------- */
  const clean = await run(`return (async () => {
    const assets = await window.api.queryAssets({ limit: 2000 })
    const mine = assets.filter((a) => a.name.startsWith('${prefix}'))
    const dimsOk = mine.length === 5 && mine.every((a) => a.width === 1600 && a.height === 1200)
    const sample = mine[0] ? mine[0].width + 'x' + mine[0].height : 'none'
    const ids = mine.map((a) => a.id)
    if (ids.length > 0) await window.api.deleteAssets(ids, false)
    return { found: mine.length, dimsOk, sample, deleted: ids.length }
  })()`)
  check('④5 条记录真实落库且缩略图管线产出尺寸', clean.found === 5 && clean.dimsOk,
    `found=${clean.found} dimsOk=${clean.dimsOk} sample=${clean.sample}`)
  check('④-2 测试素材软删除清理', clean.deleted === clean.found, `软删除 ${clean.deleted} 条`)

  const rmOk = rmTempDir(tmpDir)
  check('④-3 临时目录清理', rmOk || !fs.existsSync(tmpDir), tmpDir)

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
