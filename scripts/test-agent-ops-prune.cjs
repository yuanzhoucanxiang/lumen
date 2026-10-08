/**
 * Agent 操作记录保留策略实测（里程碑 185）：
 *   现场转译 src/main/agentOps.ts（真实源码）→ 在**临时库**上验证 pruneAgentOps：
 *     ① 超龄记录被删、近期记录保留（按天数裁剪）
 *     ② 超量记录被删、保留最新 N 条（按条数裁剪，同毫秒批次不误裁）
 *     ③ 空表/全新鲜数据 → 一条不删（不误伤）
 *     ④ clearAgentOps 清空全表
 *   用法：ELECTRON_RUN_AS_NODE=1 npx electron scripts/test-agent-ops-prune.cjs
 *   注意：全程只碰临时目录，绝不动用户真实素材库。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const esbuild = require('esbuild')
const Database = require('better-sqlite3')

async function main() {
  let failed = 0
  const ok = (m) => console.log('  ✓', m)
  const fail = (m) => {
    console.error('  ✗', m)
    failed++
  }
  const check = (name, cond, detail) => (cond ? ok(`${name} - ${detail}`) : fail(`${name} - ${detail}`))

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-prune-'))
  const libDir = path.join(tmp, 'lib')
  fs.mkdirSync(libDir, { recursive: true })

  // 真实库的最小骨架（db.ts 的 migrate 会补齐其余表与列）
  const seed = new Database(path.join(libDir, 'library.db'))
  seed.pragma('journal_mode = WAL')
  seed.close()

  // bundle 必须落在项目内：require('better-sqlite3') 从 bundle 所在目录向上找 node_modules。
  // 关键：db.ts 与 agentOps.ts 必须在**同一张依赖图**里——各自打包会各持一份 db 模块，
  // 库句柄对不上（首版就踩了：insert 进 A、prune 从没打开的 B 里删，一条都删不掉）。
  const toPosix = (p) => p.replace(/\\/g, '/')
  const entry = path.join(__dirname, '..', '.ui-shot', '.tmp-prune-entry.ts')
  fs.writeFileSync(
    entry,
    `export { openDb, getDb } from '${toPosix(path.join(__dirname, '..', 'src', 'main', 'db'))}'\n` +
      `export { pruneAgentOps, clearAgentOps } from '${toPosix(path.join(__dirname, '..', 'src', 'main', 'agentOps'))}'\n`,
    'utf-8'
  )
  const bundle = path.join(__dirname, '..', '.ui-shot', '.tmp-agentops-prune.cjs')
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // packages: 'external' = 只打包项目源码，依赖运行时从 node_modules 解析
    // （agentOps 经 repository 会拉到 importer/aiThumb 等，硬打进来会撞上 mupdf 的 ESM 顶层 await）
    packages: 'external',
    outfile: bundle
  })
  const { openDb, getDb, pruneAgentOps, clearAgentOps } = require(bundle)
  openDb(libDir)

  const insert = (ts, summary) =>
    getDb()
      .prepare("INSERT INTO agent_ops (ts, action, summary, payload, affected) VALUES (?, 'import', ?, '{\"items\":[]}', 0)")
      .run(ts, summary)
  const count = () => getDb().prepare('SELECT COUNT(*) AS n FROM agent_ops').get().n
  const has = (summary) => !!getDb().prepare('SELECT 1 FROM agent_ops WHERE summary = ?').get(summary)

  /* ---------- ① 超龄裁剪 ---------- */
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  insert(now - 200 * day, 'old-200d')
  insert(now - 100 * day, 'old-100d')
  insert(now - 2 * day, 'fresh-2d')
  insert(now - 1 * day, 'fresh-1d')
  const n1 = pruneAgentOps({ maxAgeDays: 90, maxRows: 5000 })
  check('超龄记录被裁掉(>90 天)', n1 === 2 && !has('old-200d') && !has('old-100d'), `deleted=${n1} 剩余=${count()}`)
  check('近期记录保留', has('fresh-2d') && has('fresh-1d'), `剩余=${count()}`)

  /* ---------- ② 超量裁剪(同毫秒批次不误裁) ---------- */
  clearAgentOps()
  const sameTs = now - 1000
  for (let i = 0; i < 8; i++) insert(sameTs, `batch-${i}`) // 同一毫秒写入 8 条
  for (let i = 0; i < 4; i++) insert(now - i * 1000, `seq-${i}`)
  const n2 = pruneAgentOps({ maxRows: 5, maxAgeDays: 90 })
  check('超量记录被裁到保留条数', count() === 5 && n2 === 7, `deleted=${n2} 剩余=${count()}`)
  check('保留的是最新的几条', has('seq-0') && has('seq-1') && !has('seq-3'), 'seq-0/1 在,seq-3 不在')

  /* ---------- ③ 无超龄超量 → 一条不删 ---------- */
  clearAgentOps()
  insert(now, 'x1')
  insert(now - 1000, 'x2')
  const n3 = pruneAgentOps({ maxRows: 100, maxAgeDays: 90 })
  check('无超龄超量时不误删', n3 === 0 && count() === 2, `deleted=${n3} 剩余=${count()}`)

  /* ---------- ④ 清空 ---------- */
  const n4 = clearAgentOps()
  check('clearAgentOps 清空全表', n4 === 2 && count() === 0, `cleared=${n4} 剩余=${count()}`)

  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* 临时目录清不掉不影响结论 */
  }
  fs.rmSync(bundle, { force: true })
  fs.rmSync(entry, { force: true })

  console.log('')
  if (failed > 0) {
    console.error(`${failed} 个断言失败`)
    process.exit(1)
  }
  console.log('全部通过')
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
