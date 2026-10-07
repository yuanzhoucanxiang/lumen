// 服务商档案端到端验证：保存/切换/Key 恢复/删除（用临时 Key 验证，结束时恢复真实配置）
const WebSocket = require('ws')
const http = require('http')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
http.get('http://127.0.0.1:9333/json/list', (r) => {
  let d = ''
  r.on('data', (c) => (d += c))
  r.on('end', () => {
    const page = JSON.parse(d).find((t) => t.type === 'page' && !t.url.includes('floating'))
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
    let id = 0
    const pending = new Map()
    ws.on('message', (m) => {
      const msg = JSON.parse(m.toString())
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    })
    const run = (expr) =>
      new Promise((res) => {
        const mid = ++id
        pending.set(mid, (msg) => res(msg.result?.exceptionDetails ? 'EXC:' + (msg.result.exceptionDetails.exception?.description ?? '') : msg.result?.result?.value))
        ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true } }))
      })
    ws.on('open', async () => {
      let pass = 0, fail = 0
      const check = (name, ok, detail) => { console.log(ok ? '  PASS' : '  FAIL', name, detail ? '- ' + detail : ''); ok ? pass++ : fail++ }

      const before = await run(`const s = await window.api.getSettings(); return { baseUrl: s.aiBaseUrl, model: s.aiModel, tail: s.aiKeyTail, profiles: s.aiProfiles }`)
      console.log('当前配置:', JSON.stringify({ baseUrl: before.baseUrl, model: before.model, tail: before.tail, profiles: before.profiles?.length }))

      // 1) 把当前(真实)配置存为「DeepSeek 正式」
      const s1 = await run(`return await window.api.aiProfileSave('DeepSeek 正式')`)
      const p1 = s1.aiProfiles?.find((p) => p.name === 'DeepSeek 正式')
      check('保存当前配置为档案(含 Key 尾号)', !!p1 && p1.hasKey === true && p1.keyTail === before.tail, JSON.stringify(p1))

      // 2) 换成 OpenCode Go(临时 Key)并另存档案;同时把刚才的 DeepSeek 档案名改成正式名
      await run(`return await window.api.updateSettings({ aiBaseUrl: 'https://opencode.ai/zen/go/v1', aiModel: 'glm-5.3-flash', aiApiKey: 'sk-test-only-1234' })`)
      const s2 = await run(`return await window.api.aiProfileSave('OpenCode Go 测试')`)
      check('第二档案已保存(2 个)', (s2.aiProfiles?.length ?? 0) === 2, `count=${s2.aiProfiles?.length}`)

      // 3) 切回 DeepSeek 档案 -> Key 尾号应恢复为真实 Key 的尾号
      const s3 = await run(`return await window.api.aiProfileActivate('DeepSeek 正式')`)
      check('切回 DeepSeek: baseUrl/model/Key 全部恢复', s3.aiBaseUrl === before.baseUrl && s3.aiModel === before.model && s3.aiKeyTail === before.tail,
        `baseUrl=${s3.aiBaseUrl} model=${s3.aiModel} tail=${s3.aiKeyTail} expectTail=${before.tail}`)

      // 4) 再切到 OpenCode Go(测试) -> 尾号变 1234
      const s4 = await run(`return await window.api.aiProfileActivate('OpenCode Go 测试')`)
      check('切到 OpenCode Go 测试档案(Key 尾号 1234)', s4.aiKeyTail === '1234' && s4.aiBaseUrl.includes('opencode.ai/zen/go'), `tail=${s4.aiKeyTail} base=${s4.aiBaseUrl}`)

      // 5) 恢复真实配置并删除测试档案
      const s5 = await run(`return await window.api.aiProfileActivate('DeepSeek 正式')`)
      check('恢复真实配置(尾号回到原值)', s5.aiKeyTail === before.tail, `tail=${s5.aiKeyTail}`)
      const s6 = await run(`return await window.api.aiProfileDelete('OpenCode Go 测试')`)
      check('测试档案已删除(剩 1 个)', (s6.aiProfiles?.length ?? 0) === 1 && !s6.aiProfiles.some((p) => p.name === 'OpenCode Go 测试'), JSON.stringify(s6.aiProfiles?.map((p) => p.name)))

      console.log('')
      console.log(`${pass} PASS / ${fail} FAIL`)
      ws.close()
      process.exit(fail > 0 ? 1 : 0)
    })
  })
})
