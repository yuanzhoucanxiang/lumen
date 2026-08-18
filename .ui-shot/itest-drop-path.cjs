/* 拖拽导入链路修复专项验证(debug 发现:主进程无 webUtils,import:fileObjects 从未真正导入过):
   修复后 File->路径 在 preload 完成。本测试用 DOM.setFileInputFiles 注入真实磁盘文件
   (唯一能让渲染进程持有"带真实路径 File"的手段,模拟真实 OS 拖放),验证:
   ① window.api.getFilePaths 能解析出真实路径(证明 preload 的 webUtils 可用);
   ② importFileObjects 真实导入成功并返回 importedIds;
   ③ 合成 File(无真实路径)优雅返回空数组不崩溃。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-drop-path.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const getJson = (url) => new Promise((res, rej) => http.get(url, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))) }).on('error', rej))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  let id = 0
  const pending = new Map()
  ws.on('message', (m) => { const msg = JSON.parse(m.toString()); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } })
  const cmd = (method, params) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params: params || {} })) })
  const ev = async (expression) => {
    // 与其它 itest 一致:包 async IIFE,允许裸 return
    const r = await cmd('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails
      throw new Error(d.exception?.description || d.text || 'unknown eval error')
    }
    return r.result?.result?.value
  }
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '-', detail)
    if (ok) pass++
    else fail++
  }

  // 不设独立就绪门:页面 api 未就绪时下面的断言会自然失败并带出错信息,
  // 就绪门此前在冷启动窗口内误报,增加无价值的 flake
  await sleep(1500)

  // 真实 PNG(1x1 有效)
  const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-drop-e2e-'))
  const png = path.join(dir, 'drop-e2e.png')
  fs.writeFileSync(png, pngBuf)

  // 注入 input[type=file] 并用 CDP 塞入真实文件
  await ev(`(() => { const i = document.createElement('input'); i.type='file'; i.id='__dropInput'; document.body.appendChild(i) })()`)
  const doc = await cmd('DOM.getDocument', { depth: -1 })
  const q = await cmd('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#__dropInput' })
  await cmd('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [png] })
  await sleep(300)
  await ev(`window.__dropFile = document.querySelector('#__dropInput').files[0]`)

  // ① getFilePaths 解析真实路径(preload webUtils)
  const paths = await ev(`return window.api.getFilePaths([window.__dropFile])`)
  check('getFilePaths 解析出真实磁盘路径', Array.isArray(paths) && paths.length === 1 && path.basename(paths[0]) === 'drop-e2e.png', JSON.stringify(paths))

  // ② importFileObjects 真实导入 + importedIds
  const r = await ev(`return window.api.importFileObjects([window.__dropFile])`)
  check('importFileObjects 真实导入成功', r.imported === 1 && Array.isArray(r.importedIds) && r.importedIds.length === 1, JSON.stringify(r))

  // ③ 合成 File 无真实路径 -> 空数组不崩溃
  const synth = await ev(`return window.api.getFilePaths([new File(['x'], 's.png', { type: 'image/png' })])`)
  check('合成 File 优雅返回空路径数组', Array.isArray(synth) && synth.length === 0, JSON.stringify(synth))

  // 清理:软删导入素材 + 删临时文件
  await ev(`(async () => { const a = await window.api.queryAssets({ limit: 1000 }); const ids = a.filter((x) => x.name === 'drop-e2e.png').map((x) => x.id); if (ids.length) await window.api.deleteAssets(ids, false) })()`)
  fs.rmSync(dir, { recursive: true, force: true })

  console.log('')
  console.log(pass + ' PASS / ' + fail + ' FAIL')
  ws.close()
  if (fail > 0) process.exit(1)
}
main().catch((e) => { console.error('TEST CRASH:', e.message); process.exit(1) })
