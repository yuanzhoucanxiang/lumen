/* Agent 本地 API 专项验证(clipServer 的 /import /tags /folders /status + 技能安装):
   ① 无鉴权头 POST /import -> 403(与 /clip 同一鉴权面)
   ② GET /status -> ok + version + library 字段(供 agent 探测服务可用性)
   ③ POST /import 临时目录(2 张图) -> imported=2 且 importedIds=2 + files 明细一致;原样重导 -> skipped=2 + matchedIds 回填
   ④ POST /import 带 tags+folder -> 标签/文件夹自动创建(GET /tags /folders 可查到,folderId 回传)
   ④b 多级 folder 路径 -> 缺失层级自动逐级创建,子级 parentId 指向父级
   ④c 幂等补打标签:重导库内已有素材换新标签 -> skipped=1 且新标签 count>=1
   ⑤ POST /import 不存在路径 -> ok=true 且 missing 回传;paths 为空 -> 400
   ⑥ window.api.installAgentSkill() -> 技能文件落到 ~/.agents/skills/lumen
   ⑦ note 备注存档(CDP 查 comment) / checkSimilar 回传库内相似素材 / GET /assets 关键词+备注+标签查询
   前置:npm run dev -- --remote-debugging-port=9333
   运行:node .ui-shot/itest-agent-api.cjs */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const PORT = Number(process.env.LUMEN_CLIP_PORT) || 45678
const AUTH = { 'x-lumen-client': 'lumen-clip/1', 'content-type': 'application/json' }

/**
 * 端口守卫(2026-10-06 实测踩坑):若已安装的正式版 LUMEN 正在运行,它会占住 45678,
 * dev 实例的剪藏服务静默绑定失败(EADDRINUSE),本测试的 HTTP 请求全部打到正式版——
 * 两者共享同一素材库存在并发写风险,且渲染层事件断言必然失真(事件推给正式版窗口)。
 * Windows 下用 netstat 比对 CDP(9333, dev 主进程)与剪藏服务(45678)的属主 PID;
 * 其他平台/取不到时放行(CI 无桌面环境不受此坑影响)。
 */
function assertClipPortOwnedByDev() {
  if (process.platform !== 'win32') return
  let out = ''
  try {
    out = execSync('netstat -ano', { encoding: 'utf-8' })
  } catch {
    return // netstat 不可用不阻断
  }
  const pidOf = (port) => {
    const line = out.split(/\r?\n/).find((l) => new RegExp(`:${port}\\s`).test(l) && l.includes('LISTENING'))
    return line ? line.trim().split(/\s+/).pop() : null
  }
  const cdpPid = pidOf(9333)
  const clipPid = pidOf(PORT)
  if (cdpPid && clipPid && cdpPid !== clipPid) {
    throw new Error(
      `端口 ${PORT} 被另一 LUMEN 实例占用(PID ${clipPid} ≠ dev 实例 PID ${cdpPid})。` +
        `请先关闭已安装的 LUMEN(或残留进程)再跑本测试——否则请求会打到那个实例,存在并发写库风险且断言失真。`
    )
  }
}

/** node 直发 HTTP(绕开 CORS,直接验证服务状态码与响应体) */
function request(method, reqPath, body, headers = AUTH) {
  return new Promise((resolve, reject) => {
    const h = { host: '127.0.0.1', port: PORT, path: reqPath, method, agent: false, headers: { ...headers } }
    if (body != null) h.headers['Content-Length'] = Buffer.byteLength(body)
    const req = http.request(h, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(d) } catch { /* 非 JSON 响应留 null */ }
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

  /* ---------- 0. CDP 会话(开头就建:后面的写库用例要先改设置) ---------- */
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

  // 本套件要往多个测试文件夹写(里程碑 183 起 Agent 可写范围默认只含「Agent 导入」),
  // 故先打开"不限制"逃生门,结束时还原;范围限制本身在 9f 段专门验证
  const prevScopeCfg = await run(`const s = await window.api.getSettings(); return { u: s.agentScopeUnrestricted === true, f: s.agentWriteFolders ?? [] }`)
  await run(`await window.api.updateSettings({ agentScopeUnrestricted: true })`)

  /* ---------- 1. 鉴权:无鉴权头 -> 403 ---------- */
  const r403 = await request('POST', '/import', JSON.stringify({ paths: ['C:/nonexistent.png'] }), { 'content-type': 'application/json' })
  check('无鉴权头 POST /import 返回 403', r403.status === 403, `status=${r403.status}`)

  /* ---------- 2. GET /status:探测服务 + 库路径 ---------- */
  const rStatus = await request('GET', '/status')
  check('/status 返回 ok+version+library', rStatus.status === 200 && rStatus.json?.ok === true && !!rStatus.json?.version && !!rStatus.json?.library,
    `status=${rStatus.status} version=${rStatus.json?.version} library=${rStatus.json?.library}`)

  /* ---------- 3. 按目录导入 2 张图 + 原样重导查重 ---------- */
  // 唯一前缀:历史测试垃圾已入过库的同名文件会被查重跳过,导致断言失真
  const tag = 'agentapi-' + Date.now().toString(36)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agent-'))
  for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(tmpDir, `${tag}-${i}.png`), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i, i + 1, i + 2]))
  const rImport = await request('POST', '/import', JSON.stringify({ paths: [tmpDir] }))
  check('目录导入 imported=2 且回传 importedIds', rImport.status === 200 && rImport.json?.imported === 2 && rImport.json?.importedIds?.length === 2,
    `status=${rImport.status} body=${rImport.raw.slice(0, 120)}`)
  const filesOk = rImport.json?.files?.length === 2 && rImport.json.files.every((f) => f.status === 'imported' && f.id && rImport.json.importedIds.includes(f.id))
  check('逐文件明细 files 与 importedIds 一致', !!filesOk, `files=${JSON.stringify(rImport.json?.files)?.slice(0, 180)}`)
  const defFolderOk = Number.isInteger(rImport.json?.folderId) && ((await request('GET', '/folders')).json?.folders ?? []).some((f) => f.name === 'Agent 导入')
  check('未指定 folder 自动归入「Agent 导入」专属文件夹', !!defFolderOk, `folderId=${rImport.json?.folderId}`)
  const rAgain = await request('POST', '/import', JSON.stringify({ paths: [tmpDir] }))
  check('原样重导 skipped=2(name+size 查重)', rAgain.status === 200 && rAgain.json?.imported === 0 && rAgain.json?.skipped === 2,
    `imported=${rAgain.json?.imported} skipped=${rAgain.json?.skipped}`)
  check('重导 skipped 回传 matchedIds(命中库内素材)', rAgain.json?.matchedIds?.length === 2 && rAgain.json?.files?.every((f) => f.status === 'skipped' && f.id),
    `matchedIds=${JSON.stringify(rAgain.json?.matchedIds)}`)

  /* ---------- 4. 带 tags+folder 导入:自动建标签/文件夹 ---------- */
  const TAG_NAME = `${tag}-标签`
  const FOLDER_NAME = `${tag}-汇集`
  const singleFile = path.join(tmpDir, `${tag}-single.png`)
  fs.writeFileSync(singleFile, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]))
  const rTagged = await request('POST', '/import', JSON.stringify({ paths: [singleFile], tags: [TAG_NAME], folder: FOLDER_NAME }))
  const folderId = rTagged.json?.folderId
  check('带 tags+folder 导入 imported=1 且 folderId 回传', rTagged.status === 200 && rTagged.json?.imported === 1 && Number.isInteger(folderId),
    `status=${rTagged.status} body=${rTagged.raw.slice(0, 160)}`)
  const rTags = await request('GET', '/tags')
  const rFolders = await request('GET', '/folders')
  check('GET /tags 可查到新标签', rTags.json?.tags?.some((t) => t.name === TAG_NAME), `tags=${rTags.json?.tags?.length}`)
  check('GET /folders 可查到新文件夹', rFolders.json?.folders?.some((f) => f.name === FOLDER_NAME), `folders=${rFolders.json?.folders?.length}`)

  /* ---------- 4b. 多级文件夹路径:缺失层级自动逐级创建 ---------- */
  const nestedFile = path.join(tmpDir, `${tag}-nested.png`)
  fs.writeFileSync(nestedFile, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 8, 8, 8]))
  const rNested = await request('POST', '/import', JSON.stringify({ paths: [nestedFile], folder: `${FOLDER_NAME}/子级` }))
  const nestedId = rNested.json?.folderId
  const foldersAfter = (await request('GET', '/folders')).json?.folders ?? []
  const child = foldersAfter.find((f) => f.id === nestedId)
  check('多级 folder 路径自动逐级创建且子级 parentId 指向父级',
    rNested.status === 200 && rNested.json?.imported === 1 && Number.isInteger(nestedId) && nestedId !== folderId && child?.parentId === folderId,
    `folderId=${nestedId} parentId=${child?.parentId} folders=${foldersAfter.length}`)

  /* ---------- 4c. 幂等补打标签:重导库内已有素材换新标签 -> skipped 但标签生效 ---------- */
  const TAG2_NAME = `${tag}-补打`
  const rRetag = await request('POST', '/import', JSON.stringify({ paths: [singleFile], tags: [TAG2_NAME] }))
  const tagCount = ((await request('GET', '/tags')).json?.tags ?? []).find((t) => t.name === TAG2_NAME)?.count ?? 0
  check('重导已有素材换新标签 skipped=1 且新标签 count>=1', rRetag.status === 200 && rRetag.json?.imported === 0 && rRetag.json?.skipped === 1 && tagCount >= 1,
    `skipped=${rRetag.json?.skipped} tagCount=${tagCount}`)

  /* ---------- 5. 边界:不存在路径回传 missing;空 paths -> 400 ---------- */
  const ghost = path.join(tmpDir, `${tag}-ghost.png`)
  const rMissing = await request('POST', '/import', JSON.stringify({ paths: [ghost] }))
  check('不存在路径 ok=true 且 missing 回传', rMissing.status === 200 && rMissing.json?.ok === true && rMissing.json?.imported === 0 && rMissing.json?.missing?.length === 1,
    `body=${rMissing.raw.slice(0, 120)}`)
  const rEmpty = await request('POST', '/import', JSON.stringify({ paths: [] }))
  check('空 paths 返回 400', rEmpty.status === 400, `status=${rEmpty.status}`)

  /* ---------- 5b. 防御与边界:重叠路径/相对路径/folder 校验时序/tags 字符串/move ---------- */
  // 重叠路径:目录 + 目录内同一文件同批提交 -> collectFiles 去重后只导 2 个(修复前会把同文件入库两次)
  const dupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agent-dup-'))
  for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(dupDir, `${tag}-dup-${i}.png`), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i, 7, 7]))
  const rOverlap = await request('POST', '/import', JSON.stringify({ paths: [dupDir, path.join(dupDir, `${tag}-dup-0.png`)] }))
  check('重叠路径(目录+目录内文件)去重后 imported=2', rOverlap.status === 200 && rOverlap.json?.imported === 2 && rOverlap.json?.files?.length === 2,
    `imported=${rOverlap.json?.imported} files=${rOverlap.json?.files?.length}`)

  // 相对路径:明确 400(相对路径按主进程 CWD 解析语义不可预期)
  const rRel = await request('POST', '/import', JSON.stringify({ paths: ['relative/dir.png'] }))
  check('相对路径 400 且提示须绝对路径', rRel.status === 400 && String(rRel.json?.error || '').includes('absolute'), `status=${rRel.status} error=${rRel.json?.error}`)

  // 空 folder 名('///' 消毒后为空) -> 400,且校验发生在导入之前(同文件随后可正常首导,证明没有半完成)
  const freshFile = path.join(dupDir, `${tag}-dup-fresh.png`)
  fs.writeFileSync(freshFile, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 7, 7]))
  const rEmptyFolder = await request('POST', '/import', JSON.stringify({ paths: [freshFile], folder: '///' }))
  check('空 folder 名 400(校验先于导入)', rEmptyFolder.status === 400, `status=${rEmptyFolder.status}`)
  const rAfter = await request('POST', '/import', JSON.stringify({ paths: [freshFile] }))
  check('folder 校验失败未半完成(同文件随后首导 imported=1)', rAfter.status === 200 && rAfter.json?.imported === 1,
    `imported=${rAfter.json?.imported}`)

  // tags 兼容单个字符串形式;对库内已有素材(freshFile 已在上面首导)补标签 -> matchedIds 生效
  const TAG_STR = `${tag}-字符串标签`
  const rStrTag = await request('POST', '/import', JSON.stringify({ paths: [freshFile], tags: TAG_STR }))
  const strTagOk = ((await request('GET', '/tags')).json?.tags ?? []).some((t) => t.name === TAG_STR && t.count >= 1)
  check('tags 传单个字符串也生效(补到已有素材)', rStrTag.status === 200 && strTagOk, `status=${rStrTag.status} skipped=${rStrTag.json?.skipped}`)

  // move=true 现需显式授权(里程碑 182):未授权 -> 403 且源文件纹丝不动;
  // 授权后的完整路径在 9e 权限段验证(那里会跑完再还原设置)
  const moveSrc = path.join(dupDir, `${tag}-move-src.png`)
  fs.writeFileSync(moveSrc, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 8, 7, 7]))
  const rMoveDenied = await request('POST', '/import', JSON.stringify({ paths: [moveSrc], move: true }))
  check('move 未授权返回 403 且源文件保留', rMoveDenied.status === 403 && fs.existsSync(moveSrc),
    `status=${rMoveDenied.status} srcKept=${fs.existsSync(moveSrc)}`)

  /* ---------- 5c. 真实图片管线 + /clip 通道 + 并发串行化 + 路径上限 ---------- */
  // 真实 1x1 PNG:覆盖缩略图/宽高解码管线(此前测试全是假字节,宽高恒 0)
  const REAL_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const realPng = path.join(dupDir, `${tag}-real.png`)
  fs.writeFileSync(realPng, Buffer.from(REAL_PNG_B64, 'base64'))
  const rReal = await request('POST', '/import', JSON.stringify({ paths: [realPng] }))
  check('真实 PNG 导入 imported=1', rReal.status === 200 && rReal.json?.imported === 1, `imported=${rReal.json?.imported}`)
  // /clip 单图 dataUrl 通道(与浏览器剪藏同一条路径):用不同内容的 2x2 PNG
  const CLIP_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGM4YaNxwkaDAUIBACNeBLHVZQG1AAAAAElFTkSuQmCC'
  const rClip = await request('POST', '/clip', JSON.stringify({ dataUrl: `data:image/png;base64,${CLIP_PNG_B64}`, filename: `${tag}-clip.png` }))
  check('/clip dataUrl 导入成功', rClip.status === 200 && rClip.json?.ok === true && rClip.json?.imported === 1,
    `status=${rClip.status} body=${rClip.raw.slice(0, 80)}`)
  // 同内容再次剪藏(不同文件名):感知哈希命中 -> 不重复入库
  const rClip2 = await request('POST', '/clip', JSON.stringify({ dataUrl: `data:image/png;base64,${CLIP_PNG_B64}`, filename: `${tag}-clip-again.png` }))
  check('/clip 同内容改文件名再剪藏 imported=0(hash 查重)', rClip2.status === 200 && rClip2.json?.imported === 0,
    `imported=${rClip2.json?.imported}`)

  // 并发串行化:两个相同请求同时发出,经 importQueue 排队后第一笔 imported=2、第二笔 skipped=2(不双导入)
  const concurDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agent-con-'))
  for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(concurDir, `${tag}-con-${i}.png`), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i, 6, 6]))
  const [rC1, rC2] = await Promise.all([
    request('POST', '/import', JSON.stringify({ paths: [concurDir] })),
    request('POST', '/import', JSON.stringify({ paths: [concurDir] }))
  ])
  const conImported = (rC1.json?.imported ?? 0) + (rC2.json?.imported ?? 0)
  const conSkipped = (rC1.json?.skipped ?? 0) + (rC2.json?.skipped ?? 0)
  check('并发同批请求串行化(合计 imported=2 不双导入)', conImported === 2 && conSkipped === 2,
    `c1=${rC1.json?.imported}/${rC1.json?.skipped} c2=${rC2.json?.imported}/${rC2.json?.skipped}`)

  // paths 超 1000 上限 -> 400
  const rOver = await request('POST', '/import', JSON.stringify({ paths: Array(1001).fill('C:/x.png') }))
  check('paths 超 1000 返回 400', rOver.status === 400, `status=${rOver.status}`)

  /* ---------- 5d. note 备注存档 + checkSimilar 相似检测 + GET /assets 查询 ---------- */
  const NOTE_TEXT = `prompt: 一只赛博朋克风格的乌鸦 模型: test-model seed: 42 唯一标识 ${tag}`
  const notedPng = path.join(dupDir, `${tag}-noted.png`)
  fs.writeFileSync(notedPng, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 5, 5, 5]))
  const rNote = await request('POST', '/import', JSON.stringify({ paths: [notedPng], note: NOTE_TEXT }))
  check('带 note 导入 imported=1', rNote.status === 200 && rNote.json?.imported === 1, `imported=${rNote.json?.imported}`)

  // 3x3 均匀色块:与库内 1x1/2x2 均匀图 dHash 相同(距离 0)但字节不同 -> 新素材且相似可检出
  const SIM_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAEElEQVR4nGPQCDgBQQxYWACjPgtBNso21AAAAABJRU5ErkJggg=='
  const simPng = path.join(dupDir, `${tag}-sim.png`)
  fs.writeFileSync(simPng, Buffer.from(SIM_PNG_B64, 'base64'))
  const rSim = await request('POST', '/import', JSON.stringify({ paths: [simPng], checkSimilar: true }))
  check('checkSimilar 回传库内相似素材', rSim.status === 200 && (rSim.json?.similar?.length ?? 0) >= 1 && rSim.json.similar[0].matches.length >= 1,
    `similar=${JSON.stringify(rSim.json?.similar)?.slice(0, 150)}`)

  // GET /assets:关键词命中 / 备注关键词命中(prompt 可搜) / 标签过滤 / 不存在标签回空
  const rQ = await request('GET', `/assets?q=${encodeURIComponent(tag)}&limit=10`)
  check('GET /assets 关键词命中导入素材', rQ.status === 200 && (rQ.json?.count ?? 0) >= 1 && rQ.json.assets.every((a) => a.name.toLowerCase().includes(tag)),
    `count=${rQ.json?.count}`)
  const rNoteQ = await request('GET', `/assets?q=${encodeURIComponent('唯一标识')}`)
  check('GET /assets 备注关键词命中(prompt 可搜)', (rNoteQ.json?.assets ?? []).some((a) => a.name === `${tag}-noted.png`),
    `count=${rNoteQ.json?.count}`)
  const rTagQ = await request('GET', `/assets?tag=${encodeURIComponent(TAG_NAME)}&limit=10`)
  check('GET /assets 标签过滤命中', rTagQ.status === 200 && (rTagQ.json?.count ?? 0) >= 1, `count=${rTagQ.json?.count}`)
  const rTagNone = await request('GET', `/assets?tag=${encodeURIComponent(tag + '-不存在')}`)
  check('GET /assets 不存在的标签回空结果', rTagNone.status === 200 && rTagNone.json?.count === 0, `count=${rTagNone.json?.count}`)

  /* ---------- 5e. validate 试运行 + GET /stats 汇总 ---------- */
  const dryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agent-dry-'))
  for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(dryDir, `${tag}-dry-${i}.png`), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i, 4, 4]))
  const rDry = await request('POST', '/import', JSON.stringify({ paths: [dryDir], validate: true }))
  check('dry-run 预估 fileCount=2 wouldImport=2 且不入库', rDry.status === 200 && rDry.json?.validate === true && rDry.json?.fileCount === 2 && rDry.json?.wouldImport === 2 && rDry.json?.imported === 0,
    `body=${rDry.raw.slice(0, 150)}`)
  // 真实导入后,再 dry-run 同目录:name+size 预估应全部跳过
  const rDryReal = await request('POST', '/import', JSON.stringify({ paths: [dryDir] }))
  check('dry 目录真实导入 imported=2', rDryReal.status === 200 && rDryReal.json?.imported === 2, `imported=${rDryReal.json?.imported}`)
  const rDry2 = await request('POST', '/import', JSON.stringify({ paths: [dryDir], validate: true }))
  check('真实导入后 dry-run wouldSkip=2', rDry2.status === 200 && rDry2.json?.wouldImport === 0 && rDry2.json?.wouldSkip === 2,
    `wouldImport=${rDry2.json?.wouldImport} wouldSkip=${rDry2.json?.wouldSkip}`)

  const rStats = await request('GET', '/stats')
  check('GET /stats 返回库汇总(agentImported>=1)', rStats.status === 200 && rStats.json?.ok === true && rStats.json?.assets > 0 && (rStats.json?.agentImported ?? 0) >= 1 && Number.isInteger(rStats.json?.tags),
    `assets=${rStats.json?.assets} agentImported=${rStats.json?.agentImported} tags=${rStats.json?.tags}`)

  /* ---------- 5f. source 来源 + boardId 校验 + autoTag 启动标记 ---------- */
  const rSrc = await request('GET', `/assets?q=${encodeURIComponent(tag)}&limit=1`)
  check('GET /assets 回传 source=agent', rSrc.json?.assets?.[0]?.source === 'agent', `source=${rSrc.json?.assets?.[0]?.source}`)
  const rNoBoard = await request('POST', '/import', JSON.stringify({ paths: [simPng], boardId: 99999999 }))
  check('boardId 不存在返回 400(校验先于导入)', rNoBoard.status === 400, `status=${rNoBoard.status}`)
  const autoPng = path.join(dupDir, `${tag}-auto.png`)
  fs.writeFileSync(autoPng, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 7, 3, 3]))
  const rAuto = await request('POST', '/import', JSON.stringify({ paths: [autoPng], autoTag: true }))
  // autoTag 会把缩略图发给所配置的模型(外部调用 + 可能计费),故默认关闭,未授权整批拒绝(里程碑 182)
  check('autoTag 未授权返回 403(默认不把图片发给外部模型)', rAuto.status === 403 && String(rAuto.json?.error || '').includes('autoTag'),
    `status=${rAuto.status} error=${String(rAuto.json?.error).slice(0, 60)}`)
  const rAutoNoHalf = await request('POST', '/import', JSON.stringify({ paths: [autoPng] }))
  check('被拒的 autoTag 请求没有半完成(同文件随后首导 imported=1)', rAutoNoHalf.status === 200 && rAutoNoHalf.json?.imported === 1,
    `imported=${rAutoNoHalf.json?.imported}`)

  /* ---------- 5g. HTTP /tag /untag /asset /assets source+offset(里程碑 169) ---------- */
  // 条件命中数先行统计(本轮测试已导入多个同前缀素材,tagged 应等于条件命中数而非固定值)
  const beforeCount = (await request('GET', `/assets?q=${encodeURIComponent(tag)}&limit=500`)).json?.count ?? 0
  const BATCH_TAG2 = `${TAG_NAME}-HTTP`
  const rHttpTag = await request('POST', '/tag', JSON.stringify({ conditions: { keyword: tag }, tag: BATCH_TAG2 }))
  const httpTagCheck = await request('GET', `/assets?tag=${encodeURIComponent(BATCH_TAG2)}&limit=500`)
  check('/tag 按条件打标签(命中全部条件素材)', rHttpTag.status === 200 && rHttpTag.json?.tagged === beforeCount && httpTagCheck.json?.count === beforeCount,
    `tagged=${rHttpTag.json?.tagged} before=${beforeCount} queryCount=${httpTagCheck.json?.count}`)
  const firstId = rImport.json?.importedIds?.[0]
  const rHttpTagIds = await request('POST', '/tag', JSON.stringify({ ids: [firstId], tag: `${BATCH_TAG2}-单` }))
  check('/tag 按 ids 打标签(命中 1)', rHttpTagIds.status === 200 && rHttpTagIds.json?.tagged === 1, `tagged=${rHttpTagIds.json?.tagged}`)
  const rHttpUntag = await request('POST', '/untag', JSON.stringify({ conditions: { keyword: tag }, tag: BATCH_TAG2 }))
  const untagCheck = await request('GET', `/assets?tag=${encodeURIComponent(BATCH_TAG2)}&limit=500`)
  check('/untag 按条件摘标签(全部摘除,查询归 0)', rHttpUntag.json?.removed === beforeCount && untagCheck.json?.count === 0,
    `removed=${rHttpUntag.json?.removed} left=${untagCheck.json?.count}`)
  const rHttpTagBad = await request('POST', '/tag', JSON.stringify({ conditions: { keyword: tag } }))
  check('/tag 缺 tag 名返回 400', rHttpTagBad.status === 400, `status=${rHttpTagBad.status}`)

  const rAsset = await request('GET', `/asset?id=${firstId}`)
  const rAsset404 = await request('GET', '/asset?id=0000000000000000')
  const rAssetBad = await request('GET', '/asset?id=not-an-id')
  check('/asset 返回详情(含 source/标签)',
    rAsset.status === 200 && rAsset.json?.asset?.id === firstId && rAsset.json.asset.source === 'agent' && Array.isArray(rAsset.json.asset.tags),
    `body=${rAsset.raw.slice(0, 140)}`)
  check('/asset 404(不存在)与非法 id 404', rAsset404.status === 404 && rAssetBad.status === 404,
    `404=${rAsset404.status} bad=${rAssetBad.status}`)

  const rSrcAgent = await request('GET', `/assets?q=${encodeURIComponent(tag)}&source=agent&limit=500`)
  const rSrcManual = await request('GET', `/assets?q=${encodeURIComponent(tag)}&source=manual&limit=500`)
  // 本轮有 1 个素材来自 /clip（剪藏不标 source => 手动导入），故 agent = 总数-1、manual = 1
  check('/assets source=agent 命中全部减剪藏那 1 个', rSrcAgent.json?.count === beforeCount - 1, `count=${rSrcAgent.json?.count} before=${beforeCount}`)
  check('/assets source=manual 命中剪藏导入的 1 个', rSrcManual.json?.count === 1, `count=${rSrcManual.json?.count}`)
  const rPage1 = await request('GET', `/assets?q=${encodeURIComponent(tag)}&limit=1&offset=0`)
  const rPage2 = await request('GET', `/assets?q=${encodeURIComponent(tag)}&limit=1&offset=1`)
  check('/assets offset 分页(两页不重不漏)',
    rPage1.json?.count === 1 && rPage2.json?.count === 1 && rPage1.json.assets[0].id !== rPage2.json.assets[0].id,
    `p1=${rPage1.json?.assets?.[0]?.id} p2=${rPage2.json?.assets?.[0]?.id}`)

  /* ---------- 5h. 新操作端点 /folder /star /note + 操作记录与回退(里程碑 171) ---------- */
  const rFolder = await request('POST', '/folder', JSON.stringify({ conditions: { keyword: tag }, folder: `${tag}-归档夹` }))
  check('/folder 按条件归档(moved=全部,回传 folderId)',
    rFolder.status === 200 && rFolder.json?.moved === beforeCount && Number.isInteger(rFolder.json?.folderId),
    `moved=${rFolder.json?.moved} folderId=${rFolder.json?.folderId} before=${beforeCount}`)
  const rStar = await request('POST', '/star', JSON.stringify({ ids: [firstId], star: 4 }))
  const starNow = (await request('GET', `/asset?id=${firstId}`)).json?.asset?.star
  check('/star 设置星级(4 星)', rStar.status === 200 && rStar.json?.updated === 1 && starNow === 4, `updated=${rStar.json?.updated} star=${starNow}`)
  const rStarBad = await request('POST', '/star', JSON.stringify({ ids: [firstId], star: 9 }))
  check('/star 越界值 400', rStarBad.status === 400, `status=${rStarBad.status}`)
  const rNote2 = await request('POST', '/note', JSON.stringify({ ids: [firstId], note: 'AI 追加备注测试', mode: 'append' }))
  const noteNow = (await request('GET', `/asset?id=${firstId}`)).json?.asset?.comment
  check('/note append 追加备注', rNote2.status === 200 && rNote2.json?.updated === 1 && String(noteNow).includes('AI 追加备注测试'),
    `comment=${String(noteNow).slice(0, 60)}`)

  const opsList = (await request('GET', '/ops?limit=50')).json?.ops ?? []
  const actions = new Set(opsList.map((o) => o.action))
  check('/ops 记录含各动作(folder/star/note/tag)',
    opsList.length >= 4 && ['folder', 'star', 'note', 'tag'].every((a) => actions.has(a)),
    `count=${opsList.length} actions=${[...actions].join(',')}`)

  const starOp = opsList.find((o) => o.action === 'star' && !o.undone)
  const rUndo = starOp ? await request('POST', '/undo', JSON.stringify({ id: starOp.id })) : null
  const starAfterUndo = (await request('GET', `/asset?id=${firstId}`)).json?.asset?.star
  check('/undo 回退星级(恢复 0 星)', rUndo?.json?.ok === true && starAfterUndo === 0,
    `ok=${rUndo?.json?.ok} msg=${rUndo?.json?.message} star=${starAfterUndo}`)
  const rUndoAgain = starOp ? await request('POST', '/undo', JSON.stringify({ id: starOp.id })) : null
  check('/undo 重复回退 400(一次性)', rUndoAgain?.status === 400, `status=${rUndoAgain?.status} msg=${rUndoAgain?.json?.message}`)
  const rUndoBad = await request('POST', '/undo', JSON.stringify({ id: 999999 }))
  check('/undo 不存在的 id 400', rUndoBad.status === 400, `status=${rUndoBad.status}`)
  const folderOp = opsList.find((o) => o.action === 'folder' && !o.undone)
  if (folderOp) await request('POST', '/undo', JSON.stringify({ id: folderOp.id }))
  const taggedOp = opsList.find((o) => o.action === 'tag' && !o.undone)
  const rUndoTag = taggedOp ? await request('POST', '/undo', JSON.stringify({ id: taggedOp.id })) : null
  const tagGone = (await request('GET', `/asset?id=${firstId}`)).json?.asset?.tags ?? []
  check('/undo 回退打标签(标签消失)', rUndoTag?.json?.ok === true && !tagGone.includes(taggedOp?.tag ?? ''),
    `msg=${rUndoTag?.json?.message} tags=${tagGone.join(',')}`)

  /* ---------- 5i. 逐项明细与逐项回退(里程碑 172) ---------- */
  // 新打一个覆盖多素材的标签,验证 items 明细 + 部分回退 + 进度
  const PART_TAG = `${TAG_NAME}-逐项`
  await request('POST', '/tag', JSON.stringify({ conditions: { keyword: tag }, tag: PART_TAG }))
  const opsAfterTag = (await request('GET', '/ops?limit=10')).json?.ops ?? []
  const partOp = opsAfterTag.find((o) => o.action === 'tag' && o.summary.includes('逐项'))
  check('/ops 记录含逐项明细(items 与素材数一致)',
    !!partOp && Array.isArray(partOp.items) && partOp.items.length === beforeCount && partOp.items.every((i) => i.id && i.name) && partOp.undoneCount === 0,
    `items=${partOp?.items?.length} undoneCount=${partOp?.undoneCount} before=${beforeCount}`)

  // 只回退其中 1 项:该项标签消失、其余仍在,记录未完结且进度=1/N
  const oneItem = partOp?.items?.[0]
  const rPartUndo = oneItem ? await request('POST', '/undo', JSON.stringify({ id: partOp.id, itemIds: [oneItem.id] })) : null
  const oneTags = oneItem ? (await request('GET', `/asset?id=${oneItem.id}`)).json?.asset?.tags ?? [] : []
  const otherId = partOp?.items?.[1]?.id
  const otherTags = otherId ? (await request('GET', `/asset?id=${otherId}`)).json?.asset?.tags ?? [] : []
  check('/undo 逐项回退(仅撤销 1 项,其余保留,返回剩余数)',
    rPartUndo?.json?.ok === true && rPartUndo.json.undoneCount === 1 && rPartUndo.json.remaining === beforeCount - 1 &&
      !oneTags.includes(PART_TAG) && otherTags.includes(PART_TAG),
    `undone=${rPartUndo?.json?.undoneCount} remaining=${rPartUndo?.json?.remaining} oneHas=${oneTags.includes(PART_TAG)} otherHas=${otherTags.includes(PART_TAG)}`)
  const opsMid = (await request('GET', '/ops?limit=10')).json?.ops ?? []
  const partOpMid = opsMid.find((o) => o.id === partOp?.id)
  check('记录未完结且进度正确(1/N)', partOpMid?.undone === false && partOpMid?.undoneCount === 1,
    `undone=${partOpMid?.undone} count=${partOpMid?.undoneCount}/${partOpMid?.items?.length}`)

  // 全部回退剩余项:记录自动完结
  const rRestUndo = partOp ? await request('POST', '/undo', JSON.stringify({ id: partOp.id })) : null
  const opsEnd = (await request('GET', '/ops?limit=10')).json?.ops ?? []
  const partOpEnd = opsEnd.find((o) => o.id === partOp?.id)
  const otherTagsEnd = otherId ? (await request('GET', `/asset?id=${otherId}`)).json?.asset?.tags ?? [] : []
  check('/undo 全部回退剩余项后记录自动完结',
    rRestUndo?.json?.ok === true && rRestUndo.json.remaining === 0 && partOpEnd?.undone === true && !otherTagsEnd.includes(PART_TAG),
    `remaining=${rRestUndo?.json?.remaining} undone=${partOpEnd?.undone} otherHas=${otherTagsEnd.includes(PART_TAG)}`)
  const rUndoDone = partOp ? await request('POST', '/undo', JSON.stringify({ id: partOp.id })) : null
  check('回退已完结记录 400', rUndoDone?.status === 400, `status=${rUndoDone?.status}`)

  /* ---------- 5k. HTTP /similar(里程碑 178) ---------- */
  const rSimBad = await request('GET', '/similar')
  check('/similar 缺 id 返回 400', rSimBad.status === 400, `status=${rSimBad.status}`)
  const rSimMiss = await request('GET', '/similar?id=0000000000000000')
  check('/similar 不存在的素材返回空结果', rSimMiss.status === 200 && rSimMiss.json?.total === 0, `total=${rSimMiss.json?.total}`)

  /* ---------- 5j. 批次键:同一次请求的多条记录共享 groupKey(里程碑 174) ---------- */
  // 新文件走完整 /import(带标签+归档)-> 一次请求产生 import/folder/tag 多条记录
  const gkFile = path.join(dupDir, `${tag}-gk.png`)
  fs.writeFileSync(gkFile, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 3, 3, 3]))
  await request('POST', '/import', JSON.stringify({ paths: [gkFile], tags: [`${TAG_NAME}-批次`], folder: `${tag}-批次夹` }))
  const opsGk = (await request('GET', '/ops?limit=20')).json?.ops ?? []
  check('/ops 记录带 groupKey(批次键非空)', opsGk.length > 0 && opsGk.every((o) => typeof o.groupKey === 'string') && opsGk[0].groupKey.length > 0,
    `sample=${opsGk.slice(0, 3).map((o) => o.groupKey).join(',')}`)
  const gk = opsGk[0]?.groupKey ?? ''
  const fromSame = opsGk.filter((o) => o.groupKey === gk)
  check('同请求的多条记录共享同一 groupKey(可归纳成组)', gk.length > 0 && fromSame.length >= 3,
    `count=${fromSame.length} actions=${fromSame.map((o) => o.action).join(',')}`)

  /* ---------- 6. (CDP 会话已在开头建立,此处起断言都走渲染层) ---------- */
  /* ---------- 7. 技能安装(设置页一键安装走的主进程逻辑) ---------- */
  // 真实 PNG 解码宽高断言(走 CDP 查库)
  const realSize = await run(`
    const all = await window.api.queryAssets({ limit: 5000 })
    const a = all.find((x) => x.name === ${JSON.stringify(tag + '-real.png')})
    return a ? { w: a.width, h: a.height } : null
  `)
  check('真实 PNG 解码宽高正确(1x1)', realSize?.w === 1 && realSize?.h === 1, `w=${realSize?.w} h=${realSize?.h}`)
  const notedComment = await run(`
    const all = await window.api.queryAssets({ limit: 5000 })
    const a = all.find((x) => x.name === ${JSON.stringify(tag + '-noted.png')})
    return a ? a.comment : null
  `)
  check('note 已写入素材备注(仅新导入)', notedComment === NOTE_TEXT, `comment=${String(notedComment).slice(0, 60)}`)
  const rInstall = await run(`return await window.api.installAgentSkill()`)
  check('installAgentSkill 返回至少 1 个安装目录', Array.isArray(rInstall?.installed) && rInstall.installed.length >= 1,
    `installed=${JSON.stringify(rInstall?.installed)}`)
  // 装完即最新:状态比对须在 installAgentSkill 之后(此前旧版未同步时 upToDate=false 是正确行为)
  const skillSt = await run(`return await window.api.agentSkillStatus()`)
  check('agentSkillStatus 已安装且版本最新', skillSt?.installed === true && skillSt?.upToDate === true, JSON.stringify(skillSt)?.slice(0, 120))

  /* ---------- 8. boardId 直送白板 + 进度推送(走渲染层验证) ---------- */
  const board = await run(`return await window.api.createBoard('agentapi-board')`)
  const bid = board?.id
  const boardPng = path.join(dupDir, `${tag}-board.png`)
  fs.writeFileSync(boardPng, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 6, 6, 6]))
  const rBoard = await request('POST', '/import', JSON.stringify({ paths: [boardPng], boardId: bid }))
  const boardItems = Number.isInteger(bid) ? (await run(`return (await window.api.listBoardItems(${bid})).length`)) : 0
  check('boardId 直送白板(新素材已上板)', rBoard.status === 200 && rBoard.json?.boardId === bid && boardItems >= 1,
    `boardId=${rBoard.json?.boardId} items=${boardItems}`)

  await run(`(() => { window.__itestProgEvents = 0; window.api.onImportProgress(() => window.__itestProgEvents++) })()`)
  const progPng = path.join(dupDir, `${tag}-prog.png`)
  fs.writeFileSync(progPng, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 6, 3, 3]))
  await request('POST', '/import', JSON.stringify({ paths: [progPng] }))
  await sleep(400)
  const progEvents = await run(`return window.__itestProgEvents`)
  check('Agent 导入进度经 import:progress 推送到渲染层', progEvents >= 1, `events=${progEvents}`)
  const skillMd = path.join(os.homedir(), '.agents', 'skills', 'lumen', 'SKILL.md')
  const skillOk = fs.existsSync(skillMd) && fs.readFileSync(skillMd, 'utf-8').includes('/import')
  check('技能文件已落到 ~/.agents/skills/lumen 且含 /import 文档', skillOk, `SKILL.md=${skillMd}`)

  /* ---------- 9. 里程碑 182:回退只撤本次改动 / 精确查重 / 危险动作权限 ---------- */
  // 9a. 素材先由"用户"打上标签(走渲染层 IPC,不经 Agent 通道 -> 不产生操作记录)
  const PRE_TAG = `${tag}-原有标签`
  const guardPng = path.join(dupDir, `${tag}-guard.png`)
  fs.writeFileSync(guardPng, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2, 2, 2]))
  const rGuard = await request('POST', '/import', JSON.stringify({ paths: [guardPng] }))
  const guardId = rGuard.json?.importedIds?.[0]
  await run(`await window.api.addTagToAssets([${JSON.stringify(guardId)}], ${JSON.stringify(PRE_TAG)})`)
  const opsBeforeGuard = ((await request('GET', '/ops?limit=100')).json?.ops ?? []).length
  const rTagExisting = await request('POST', '/tag', JSON.stringify({ ids: [guardId], tag: PRE_TAG }))
  const opsAfterGuard = ((await request('GET', '/ops?limit=100')).json?.ops ?? []).length
  check('已有标签的素材再 /tag:changed=0 且不新增操作记录', rTagExisting.json?.changed === 0 && opsAfterGuard === opsBeforeGuard,
    `changed=${rTagExisting.json?.changed} ops ${opsBeforeGuard}->${opsAfterGuard}`)
  // 再打一个新标签(产生记录),回退它 -> 用户原有的标签必须还在
  const NEW_TAG = `${tag}-新增标签`
  await request('POST', '/tag', JSON.stringify({ ids: [guardId], tag: NEW_TAG }))
  const opsTagNew = ((await request('GET', '/ops?limit=30')).json?.ops ?? []).find(
    (o) => o.action === 'tag' && (o.items ?? []).some((it) => it.id === guardId)
  )
  const rUndoNewTag = opsTagNew ? await request('POST', '/undo', JSON.stringify({ id: opsTagNew.id })) : null
  const guardTags = (await request('GET', `/asset?id=${guardId}`)).json?.asset?.tags ?? []
  check('回退新标签后原有标签仍在(不再摘掉用户的整理)',
    rUndoNewTag?.json?.ok === true && guardTags.includes(PRE_TAG) && !guardTags.includes(NEW_TAG),
    `tags=${JSON.stringify(guardTags)}`)

  // 9b. 归档同理:先在文件夹里的素材,回退 Agent 的归档不会把它移出
  const PRE_FOLDER = `${tag}-原有夹`
  const rPreFolder = await request('POST', '/folder', JSON.stringify({ ids: [guardId], folder: PRE_FOLDER }))
  const preFolderId = rPreFolder.json?.folderId
  const opsBeforeFolder = ((await request('GET', '/ops?limit=100')).json?.ops ?? []).length
  const rFolderAgain = await request('POST', '/folder', JSON.stringify({ ids: [guardId], folder: PRE_FOLDER }))
  const opsAfterFolder = ((await request('GET', '/ops?limit=100')).json?.ops ?? []).length
  check('已在该文件夹的素材再 /folder:changed=0 且不新增记录',
    rFolderAgain.json?.changed === 0 && opsAfterFolder === opsBeforeFolder,
    `changed=${rFolderAgain.json?.changed} ops ${opsBeforeFolder}->${opsAfterFolder}`)
  // 再归档到另一个文件夹(产生记录),回退它 -> 原有文件夹归属必须还在
  const NEW_FOLDER = `${tag}-新增夹`
  await request('POST', '/folder', JSON.stringify({ ids: [guardId], folder: NEW_FOLDER }))
  const opsFolderNew = ((await request('GET', '/ops?limit=30')).json?.ops ?? []).find(
    (o) => o.action === 'folder' && (o.items ?? []).some((it) => it.id === guardId)
  )
  const rUndoFolder = opsFolderNew ? await request('POST', '/undo', JSON.stringify({ id: opsFolderNew.id })) : null
  const inFolders = await run(`
    const all = await window.api.queryAssets({ folderId: ${JSON.stringify(preFolderId)}, limit: 5000 })
    return all.map((x) => x.id)
  `)
  check('回退新归档后原有文件夹归属仍在', rUndoFolder?.json?.ok === true && (inFolders ?? []).includes(guardId),
    `该夹内=${JSON.stringify((inFolders ?? []).slice(0, 3))} 含目标=${(inFolders ?? []).includes(guardId)}`)

  // 9c. 备注回退不覆盖用户后来重写的备注
  const undoPng = path.join(dupDir, `${tag}-undo-note.png`)
  fs.writeFileSync(undoPng, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2, 5, 5]))
  const rUndoNote = await request('POST', '/import', JSON.stringify({ paths: [undoPng] }))
  const undoNoteId = rUndoNote.json?.importedIds?.[0]
  const AGENT_NOTE = `agent 写的备注 ${tag}`
  const USER_NOTE = `用户后来重写的备注 ${tag}`
  await request('POST', '/note', JSON.stringify({ ids: [undoNoteId], note: AGENT_NOTE }))
  const noteOp = ((await request('GET', '/ops?limit=30')).json?.ops ?? []).find(
    (o) => o.action === 'note' && (o.items ?? []).some((it) => it.id === undoNoteId)
  )
  await run(`await window.api.updateAsset(${JSON.stringify(undoNoteId)}, { comment: ${JSON.stringify(USER_NOTE)} })`)
  const rUndoNoteBack = noteOp ? await request('POST', '/undo', JSON.stringify({ id: noteOp.id })) : null
  const noteAfterUndo = (await request('GET', `/asset?id=${undoNoteId}`)).json?.asset?.comment
  check('回退备注不覆盖用户后来的修改(消息提示保持不动)',
    rUndoNoteBack?.json?.ok === true && noteAfterUndo === USER_NOTE && String(rUndoNoteBack.json.message).includes('保持不动'),
    `comment=${String(noteAfterUndo).slice(0, 40)} msg=${String(rUndoNoteBack?.json?.message)}`)

  // 9d. 精确查重:同名同大小但内容不同 -> 两张都入库;内容完全相同(含改名)-> 仍然跳过
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agent-sha-a-'))
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agent-sha-b-'))
  const sameName = `${tag}-same.png`
  const head = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  fs.writeFileSync(path.join(d1, sameName), Buffer.concat([head, Buffer.alloc(64, 1)]))
  fs.writeFileSync(path.join(d2, sameName), Buffer.concat([head, Buffer.alloc(64, 2)]))
  const rShaA = await request('POST', '/import', JSON.stringify({ paths: [path.join(d1, sameName)] }))
  const rShaB = await request('POST', '/import', JSON.stringify({ paths: [path.join(d2, sameName)] }))
  check('同名同大小但内容不同 -> 第二张不被误判重复', rShaA.json?.imported === 1 && rShaB.json?.imported === 1 && rShaA.json?.skipped === 0 && rShaB.json?.skipped === 0,
    `a=${rShaA.json?.imported}/${rShaA.json?.skipped} b=${rShaB.json?.imported}/${rShaB.json?.skipped}`)
  const renamedCopy = path.join(d2, `${tag}-renamed-copy.png`)
  fs.copyFileSync(path.join(d2, sameName), renamedCopy)
  const rRenamed = await request('POST', '/import', JSON.stringify({ paths: [renamedCopy] }))
  check('内容相同仅改名 -> 仍跳过(sha256 命中)', rRenamed.json?.imported === 0 && rRenamed.json?.skipped === 1,
    `imported=${rRenamed.json?.imported} skipped=${rRenamed.json?.skipped}`)

  // 9e. 危险动作权限:授权后 move 才生效;autoTag 授权后放行(用重复文件,不触发真实模型调用);最后还原设置
  const prevPerm = await run(`const s = await window.api.getSettings(); return { m: s.agentAllowMove === true, a: s.agentAllowAutoTag === true }`)
  await run(`await window.api.updateSettings({ agentAllowMove: true })`)
  const rMoveOk = await request('POST', '/import', JSON.stringify({ paths: [moveSrc], move: true }))
  check('授权后 move=true 生效(导入成功且源文件删除)',
    rMoveOk.status === 200 && rMoveOk.json?.imported === 1 && !fs.existsSync(moveSrc),
    `status=${rMoveOk.status} imported=${rMoveOk.json?.imported} srcGone=${!fs.existsSync(moveSrc)}`)
  await run(`await window.api.updateSettings({ agentAllowAutoTag: true })`)
  const rAutoAllowed = await request('POST', '/import', JSON.stringify({ paths: [autoPng], autoTag: true }))
  check('授权后 autoTag 请求放行(对重复文件无新导入,不触发模型调用)',
    rAutoAllowed.status === 200 && rAutoAllowed.json?.imported === 0 && rAutoAllowed.json?.skipped === 1,
    `status=${rAutoAllowed.status} imported=${rAutoAllowed.json?.imported} skipped=${rAutoAllowed.json?.skipped}`)
  await run(`await window.api.updateSettings({ agentAllowMove: ${prevPerm.m}, agentAllowAutoTag: ${prevPerm.a} })`)
  const restoredPerm = await run(`const s = await window.api.getSettings(); return { m: s.agentAllowMove === true, a: s.agentAllowAutoTag === true }`)
  check('测试后权限设置已还原(不污染用户配置)', restoredPerm.m === prevPerm.m && restoredPerm.a === prevPerm.a,
    `before=${JSON.stringify(prevPerm)} after=${JSON.stringify(restoredPerm)}`)

  // 9f. 可写范围(里程碑 183):默认只允许「Agent 导入」;勾选后其子文件夹同样放行;范围外一律拒绝
  const scopeFile = path.join(dupDir, `${tag}-scope.png`)
  fs.writeFileSync(scopeFile, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 9, 9]))
  await run(`await window.api.updateSettings({ agentScopeUnrestricted: false })`)
  const rScopeDenied = await request('POST', '/import', JSON.stringify({ paths: [scopeFile], folder: `${tag}-项目` }))
  check('范围外文件夹被拒(403 且提示去设置页勾选)',
    rScopeDenied.status === 403 && String(rScopeDenied.json?.error || '').includes('可写范围'),
    `status=${rScopeDenied.status} error=${String(rScopeDenied.json?.error).slice(0, 50)}`)
  const rScopeNoHalf = await request('POST', '/import', JSON.stringify({ paths: [scopeFile] }))
  check('被拒的范围内导入没有半完成(不带 folder 仍可导,落「Agent 导入」)',
    rScopeNoHalf.status === 200 && rScopeNoHalf.json?.imported === 1,
    `status=${rScopeNoHalf.status} imported=${rScopeNoHalf.json?.imported}`)
  // 建一个"项目夹"并加入范围:它自身与其子文件夹都放行,别的顶层夹仍被拒
  const scopeRootName = `${tag}-项目夹`
  const scopeRootFolder = await run(`return await window.api.createFolder(${JSON.stringify(scopeRootName)}, null)`)
  await run(`await window.api.updateSettings({ agentWriteFolders: [${scopeRootFolder.id}] })`)
  const scopeFile2 = path.join(dupDir, `${tag}-scope2.png`)
  fs.writeFileSync(scopeFile2, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 8, 9]))
  const rScopeOk = await request('POST', '/import', JSON.stringify({ paths: [scopeFile2], folder: scopeRootName }))
  check('勾选的文件夹放行(范围内导入成功且归档进去)',
    rScopeOk.status === 200 && rScopeOk.json?.imported === 1 && Number.isInteger(rScopeOk.json?.folderId),
    `status=${rScopeOk.status} imported=${rScopeOk.json?.imported} folderId=${rScopeOk.json?.folderId}`)
  const scopeFile3 = path.join(dupDir, `${tag}-scope3.png`)
  fs.writeFileSync(scopeFile3, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 7, 9]))
  const rScopeChild = await request('POST', '/import', JSON.stringify({ paths: [scopeFile3], folder: `${scopeRootName}/参考/底片` }))
  const childFolder = ((await request('GET', '/folders')).json?.folders ?? []).find((f) => f.name === '底片')
  check('范围内子文件夹自动建且层级正确(父夹=项目夹)',
    rScopeChild.status === 200 && rScopeChild.json?.imported === 1 && childFolder?.parentId != null,
    `status=${rScopeChild.status} imported=${rScopeChild.json?.imported} childParent=${childFolder?.parentId}`)
  const scopeFile4 = path.join(dupDir, `${tag}-scope4.png`)
  fs.writeFileSync(scopeFile4, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 6, 9]))
  const rScopeOther = await request('POST', '/import', JSON.stringify({ paths: [scopeFile4], folder: `${tag}-别的夹` }))
  check('范围外的另一个文件夹仍被拒(403)',
    rScopeOther.status === 403,
    `status=${rScopeOther.status} error=${String(rScopeOther.json?.error).slice(0, 40)}`)
  const rScopeFolderOp = await request('POST', '/folder', JSON.stringify({ ids: [guardId], folder: `${tag}-范围外归档` }))
  check('/folder 归档到范围外同样被拒(403)', rScopeFolderOp.status === 403,
    `status=${rScopeFolderOp.status} error=${String(rScopeFolderOp.json?.error).slice(0, 40)}`)
  const rScopeFolderIn = await request('POST', '/folder', JSON.stringify({ ids: [guardId], folder: scopeRootName }))
  check('/folder 归档到范围内放行', rScopeFolderIn.status === 200 && rScopeFolderIn.json?.moved === 1,
    `status=${rScopeFolderIn.status} moved=${rScopeFolderIn.json?.moved}`)
  // 还原用户原有范围设置(连同 182 的两个开关一起)
  await run(`await window.api.updateSettings({ agentScopeUnrestricted: ${prevScopeCfg.u}, agentWriteFolders: ${JSON.stringify(prevScopeCfg.f)} })`)
  const restoredScope = await run(`const s = await window.api.getSettings(); return { u: s.agentScopeUnrestricted === true, f: s.agentWriteFolders ?? [] }`)
  check('测试后可写范围设置已还原', restoredScope.u === prevScopeCfg.u && JSON.stringify(restoredScope.f) === JSON.stringify(prevScopeCfg.f),
    `before=${JSON.stringify(prevScopeCfg)} after=${JSON.stringify(restoredScope)}`)

  /* ---------- 8. 清理:软删导入素材 + 删测试标签/文件夹 ---------- */
  // 注意:run() 会把语句包进 async IIFE,这里直接写语句,不要再包一层 (async () => {})
  // 通用清理:标签/文件夹/素材都按 agentapi- 前缀匹配(含历史被中断测试留下的同类垃圾);
  // 多级用例建的子级文件夹(名字不含前缀)按 id 先删
  const cleanup = await run(`
    const all = await window.api.queryAssets({ limit: 5000 })
    const ids = all.filter((a) => a.name.startsWith('agentapi-')).map((a) => a.id)
    if (ids.length > 0) await window.api.deleteAssets(ids, false)
    if (Number.isInteger(${JSON.stringify(nestedId)}) ) await window.api.deleteFolder(${JSON.stringify(nestedId)})
    // 可写范围用例建的深层子夹(名字不含前缀,需按 id 先删子后删父)
    if (Number.isInteger(${JSON.stringify(childFolder?.id ?? null)})) await window.api.deleteFolder(${JSON.stringify(childFolder?.id ?? null)})
    if (Number.isInteger(${JSON.stringify(childFolder?.parentId ?? null)})) await window.api.deleteFolder(${JSON.stringify(childFolder?.parentId ?? null)})
    const tags = await window.api.listTags()
    const tids = tags.filter((x) => x.name.includes('agentapi-')).map((x) => x.id)
    for (const tid of tids) await window.api.deleteTag(tid)
    const folders = await window.api.listFolders()
    const fids = folders.filter((x) => x.name.includes('agentapi-')).map((x) => x.id)
    // 专属默认文件夹(固定名,只含本测试导入的素材,软删后已空)
    const defFolder = folders.find((x) => x.name === 'Agent 导入')
    if (defFolder) fids.push(defFolder.id)
    for (const fid of fids) await window.api.deleteFolder(fid)
    // 测试白板(含其上的测试素材项)一并删除
    if (Number.isInteger(${JSON.stringify(bid)})) await window.api.deleteBoard(${JSON.stringify(bid)})
    return { deleted: ids.length, tags: tids.length, folders: fids.length }
  `)
  check('清理:测试素材已软删 + 标签/文件夹已删', cleanup.deleted >= 3 && cleanup.tags >= 1 && cleanup.folders >= 1,
    `deleted=${cleanup.deleted} tags=${cleanup.tags} folders=${cleanup.folders}`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.rmSync(dupDir, { recursive: true, force: true })
  fs.rmSync(concurDir, { recursive: true, force: true })
  fs.rmSync(dryDir, { recursive: true, force: true })

  console.log('')
  console.log(pass + ' PASS / ' + fail + ' FAIL')
  ws.close()
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
