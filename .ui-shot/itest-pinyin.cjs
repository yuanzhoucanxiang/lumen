/* 拼音/模糊搜索专项验证(里程碑 98,对标 Eagle):
   ①中文名素材导入后,全拼/首字母/混合关键词均可检索命中;
   ②中文关键词(名称 LIKE)不回归;
   ③改名到英文 → 拼音检索失效(name LIKE 生效);改回中文 → 拼音重算恢复;
   ④无关拼音关键词不误命中本素材;
   ⑤清理软删,不污染用户库。
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-pinyin.cjs */
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

function rmTempDir(dir) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    } catch {
      /* Windows Defender 可能短暂锁定,重试 */
    }
  }
  return false
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面(先启动 dev)')
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
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }

  /* ---------- 0. 生成中文名测试图并导入 ---------- */
  const dataUrl = await run(`return (() => {
    const c = document.createElement('canvas')
    c.width = 300; c.height = 200
    const g = c.getContext('2d')
    g.fillStyle = '#3a7'
    g.fillRect(0, 0, 300, 200)
    return c.toDataURL('image/png')
  })()`)
  const stamp = Date.now()
  const tmpDir = path.join(os.tmpdir(), 'lumen-itest-pinyin-' + stamp)
  fs.mkdirSync(tmpDir, { recursive: true })
  const zhName = `拼音检索-城堡-${stamp}`
  const imgFile = path.join(tmpDir, `${zhName}.png`)
  fs.writeFileSync(imgFile, Buffer.from(dataUrl.split(',')[1], 'base64'))
  const imported = await run(`return window.api.importFromPaths(${JSON.stringify([imgFile])})`)
  check('①中文名素材真实导入', imported.imported === 1 && imported.importedIds.length === 1, `imported=${imported.imported}`)
  const assetId = imported.importedIds[0]

  const searchIds = (kw) => `(async () => {
    const r = await window.api.queryAssets({ keyword: ${JSON.stringify(kw)}, limit: 2000 })
    return r.some((a) => a.id === '${assetId}')
  })()`

  /* ---------- 1. 拼音检索(全拼/首字母/混合) ---------- */
  check('②首字母检索 pyjs 命中', await run(`return ${searchIds('pyjs')}`), '拼音检索 → pyjs')
  check('③全拼检索 chengbao 命中', await run(`return ${searchIds('chengbao')}`), '城堡 → chengbao')
  check('④首字母组合 pyjscb 命中', await run(`return ${searchIds('pyjscb')}`), '拼音检索城堡 → pyjscb')
  check('⑤长全拼 pinyinjiansuo 命中', await run(`return ${searchIds('pinyinjiansuo')}`), '拼音检索 → pinyinjiansuo')
  check('⑥中文关键词 城堡 命中(名称 LIKE 不回归)', await run(`return ${searchIds('城堡')}`), 'name LIKE 路径')
  check('⑦无关拼音 zzzqqq 不误命中本素材', !(await run(`return ${searchIds('zzzqqq')}`)), '')

  /* ---------- 2. 改名维护拼音(updateAsset 重算) ---------- */
  const enName = `lumen-py-rename-${stamp}.png`
  await run(`await window.api.updateAsset('${assetId}', { name: ${JSON.stringify(enName)} })`)
  const afterEn = await run(`return {
    hitOld: await ${searchIds('chengbao')},
    hitNew: await ${searchIds('lumen-py-rename')}
  }`)
  check('⑧改英文名后拼音检索失效', !afterEn.hitOld, `chengbao hit=${afterEn.hitOld}`)
  check('⑨改英文名后 name LIKE 生效', afterEn.hitNew, `hit=${afterEn.hitNew}`)

  const zhName2 = `城堡重命名-${stamp}.png`
  await run(`await window.api.updateAsset('${assetId}', { name: ${JSON.stringify(zhName2)} })`)
  const afterZh = await run(`return {
    hit: await ${searchIds('chengbao')},
    hitInit: await ${searchIds('cbzmm')}
  }`)
  check('⑩改回中文名拼音重算恢复', afterZh.hit && afterZh.hitInit, `chengbao=${afterZh.hit} cbzmm=${afterZh.hitInit}`)

  /* ---------- 3. 清理 ---------- */
  await run(`await window.api.deleteAssets(['${assetId}'], false)`)
  const rmOk = rmTempDir(tmpDir)
  check('⑪清理(软删+临时目录)', rmOk, `tmp=${rmOk}`)

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
