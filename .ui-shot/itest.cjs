/* 真机集成测试：通过 CDP 驱动 dev 实例的渲染进程，用真实素材库断言 IPC 全链路
   前置：npm run dev -- --remote-debugging-port=9333 */
const WebSocket = require('ws')
const http = require('http')

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

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) throw new Error('找不到渲染进程页面（dev 未就绪？）')

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
      ws.send(
        JSON.stringify({
          id: mid,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true }
        })
      )
    })

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }

  const stats = (await evalJs(`window.api.getLibraryStats()`)).result.value
  check('getLibraryStats', stats && typeof stats.total === 'number', JSON.stringify(stats))

  const assets = (await evalJs(`window.api.queryAssets({ limit: 5 })`)).result.value
  check('queryAssets', Array.isArray(assets), `${Array.isArray(assets) ? assets.length : '?'} 条`)

  const tags = (await evalJs(`window.api.listTags()`)).result.value
  check('listTags', Array.isArray(tags), `${Array.isArray(tags) ? tags.length : '?'} 个`)

  const groups = (await evalJs(`window.api.listTagGroups()`)).result.value
  check('listTagGroups', Array.isArray(groups), `${Array.isArray(groups) ? groups.length : '?'} 个`)

  const folders = (await evalJs(`window.api.listFolders()`)).result.value
  check('listFolders', Array.isArray(folders), `${Array.isArray(folders) ? folders.length : '?'} 个`)

  const dupes = (await evalJs(`window.api.findDuplicates()`)).result.value
  check('findDuplicates', Array.isArray(dupes), `${Array.isArray(dupes) ? dupes.length : '?'} 组`)

  if (Array.isArray(assets) && assets.length > 0) {
    const id0 = assets[0].id
    const sim = (await evalJs(`window.api.findSimilar(${JSON.stringify(id0)})`)).result.value
    check('findSimilar', Array.isArray(sim), `${Array.isArray(sim) ? sim.length : '?'} 个`)

    // 用 <img> 真实加载路径验证 asset: 协议（fetch 不支持自定义 scheme）
    const thumbUrl = (await evalJs(`window.api.thumbnailUrl(${JSON.stringify(id0)})`)).result.value
    const st = (
      await evalJs(
        `new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); i.src = ${JSON.stringify(thumbUrl)} })`
      )
    ).result.value
    check('asset:// 缩略图可加载', st > 0, `naturalWidth=${st}`)

    const origUrl = (await evalJs(`window.api.originalUrl(${JSON.stringify(id0)})`)).result.value
    const st2 = (
      await evalJs(
        `new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); i.src = ${JSON.stringify(origUrl)} })`
      )
    ).result.value
    check('asset:// 原图可加载', st2 > 0, `naturalWidth=${st2}`)
  } else {
    check('findSimilar', false, '库内无素材，跳过')
    check('asset:// 缩略图', false, '库内无素材，跳过')
    check('asset:// 原图', false, '库内无素材，跳过')
  }

  const settings = (await evalJs(`window.api.getSettings()`)).result.value
  check('getSettings', !!settings && Array.isArray(settings.watchDirs), JSON.stringify(settings))

  const libs = (await evalJs(`window.api.listLibraries()`)).result.value
  check('listLibraries', !!libs && typeof libs.current === 'string', libs && libs.current)

  const version = (await evalJs(`window.api.getAppVersion()`)).result.value
  check('getAppVersion', typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version), version)

  const upd = (await evalJs(`window.api.checkUpdate()`)).result.value
  check('checkUpdate(dev)', upd && upd.state === 'dev', JSON.stringify(upd))

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ITEST ERROR:', e.message || e)
  process.exit(2)
})
