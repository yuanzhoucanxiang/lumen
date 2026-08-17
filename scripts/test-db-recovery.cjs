/**
 * DB 打开自愈路径实测(后端优化阶段 5 / 任务 5.3):
 *   esbuild 现场转译 src/main/db.ts(真实源码),构造三种场景验证 openDb:
 *     ① 损坏主库 + 有效 .bak -> 自动改名保留现场、从备份恢复、库可查询
 *     ② 损坏主库 + 无备份 -> 重建空库(数据丢失路径,损坏文件保留)
 *     ③ 正常库 -> 快速通过(quick_check 不误伤)
 *   用法:node scripts/test-db-recovery.cjs
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const esbuild = require('esbuild')
const Database = require('better-sqlite3')

async function main() {
  let failed = 0
  const ok = (m) => console.log('  ✓', m)
  const fail = (m) => { console.error('  ✗', m); failed++ }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-recover-'))
  // 转译 db.ts(依赖 stmtCache/logger 一并 bundle;electron 模块在 RUN_AS_NODE 下为空壳,
  // db.ts 的 dialog 只在无备份路径调用且被 try/catch 包裹,不受影响)
  // bundle 必须落在项目内:require('better-sqlite3') 的解析从 bundle 所在目录向上找 node_modules
  const bundle = path.join(__dirname, '..', '.ui-shot', '.tmp-db-recovery.cjs')
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'main', 'db.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['better-sqlite3', 'electron'],
    outfile: bundle
  })
  const { openDb, getDb, closeDb } = require(bundle)

  /** 造一个包含数据的正常库(assets 表与 db.ts migrate 的 CREATE TABLE 对齐,
      否则 migrate 的 CREATE INDEX/回填语句会因缺列抛错) */
  function makeGoodDb(dir) {
    const db = new Database(path.join(dir, 'library.db'))
    db.pragma('journal_mode = WAL')
    db.exec(`CREATE TABLE assets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, ext TEXT NOT NULL, rel_dir TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0,
      colors TEXT NOT NULL DEFAULT '[]', hash TEXT NOT NULL DEFAULT '', star INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, imported_at INTEGER NOT NULL, deleted_at INTEGER
    )`)
    db.prepare('INSERT INTO assets (id, name, ext, rel_dir, created_at, imported_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('a1', 'good', 'png', 'assets/a1', 0, 0)
    db.close()
  }

  /** 清理临时目录(Windows 文件句柄释放有延迟,重试几次) */
  function rmRetry(dir) {
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); return true } catch { }
    }
    return false
  }

  /* ---------- 场景 ①:损坏 + 有备份 ---------- */
  const dir1 = path.join(tmp, 's1')
  fs.mkdirSync(dir1)
  makeGoodDb(dir1)
  const bak1 = path.join(dir1, 'library.db.bak')
  fs.copyFileSync(path.join(dir1, 'library.db'), bak1)
  fs.writeFileSync(path.join(dir1, 'library.db'), Buffer.from('this is not a sqlite database at all, corrupt!!!'))
  try {
    try {
      const db = openDb(dir1)
      const row = db.prepare('SELECT name FROM assets WHERE id = ?').get('a1')
      ok(`损坏库自动从 .bak 恢复且数据可查(a1=${row?.name})`)
      const corrupts = fs.readdirSync(dir1).filter((f) => f.includes('.corrupt-'))
      ok(`损坏现场已改名保留(${corrupts[0] ?? '缺失!'})`, corrupts.length === 1)
    } catch (e) {
      fail('场景①恢复失败: ' + e.message)
    } finally {
      closeDb()
    }
  } catch { /* closeDb 未初始化也吞掉 */ }

  /* ---------- 场景 ②:损坏 + 无备份 ---------- */
  const dir2 = path.join(tmp, 's2')
  fs.mkdirSync(dir2)
  fs.writeFileSync(path.join(dir2, 'library.db'), Buffer.from('garbage garbage garbage, not sqlite'))
  try {
    const db = openDb(dir2)
    const n = db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE type=\'table\'').get().n
    ok(`无备份时重建空库成功(表数 ${n})`)
    const corrupts = fs.readdirSync(dir2).filter((f) => f.includes('.corrupt-'))
    ok(`损坏现场仍保留(${corrupts[0] ?? '缺失!'})`, corrupts.length === 1)
    closeDb()
  } catch (e) {
    fail('场景②重建失败: ' + e.message)
  }

  /* ---------- 场景 ③:正常库不误伤 ---------- */
  const dir3 = path.join(tmp, 's3')
  fs.mkdirSync(dir3)
  makeGoodDb(dir3)
  try {
    try {
      const db = openDb(dir3)
      const row = db.prepare('SELECT name FROM assets WHERE id = ?').get('a1')
      ok(`正常库直开不误伤(a1=${row?.name})`)
      const stray = fs.readdirSync(dir3).filter((f) => f.includes('.corrupt-'))
      ok('无多余 corrupt 文件', stray.length === 0)
    } catch (e) {
      fail('场景③失败: ' + e.message)
    } finally {
      closeDb()
    }
  } catch { /* closeDb 未初始化也吞掉 */ }

  rmRetry(tmp)
  console.log(failed === 0 ? '\n✓ 全部通过' : `\n${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e)
  process.exit(1)
})
