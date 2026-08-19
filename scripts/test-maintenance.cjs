/**
 * 启动维护任务纯逻辑验证(里程碑 94 / #3+#5):
 *   esbuild 现场转译 src/main/maintenance.ts(真实源码),构造场景断言:
 *   ① 孤儿目录清理:无 DB 记录的 assets/ab/{16hex} 目录被删;有记录的有效目录保留;
 *      非资产结构目录(assets/其他文件)不动。
 *   ② dHash 回填:hash='' 的图片素材回填出非空 hash;hash 已有/非图片不动。
 *   用法:ELECTRON_RUN_AS_NODE=1 node scripts/test-maintenance.cjs
 */
const esbuild = require('esbuild')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3')

async function main() {
  let failed = 0
  const ok = (m) => console.log('  ✓', m)
  const fail = (m) => { console.error('  ✗', m); failed++ }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maint-'))

  const bundle = path.join(__dirname, '..', '.ui-shot', '.tmp-maint.cjs')
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'main', 'maintenance.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['better-sqlite3', 'electron', 'sharp', 'ffmpeg-static', 'ag-psd', 'fontkit'],
    outfile: bundle
  })
  const { cleanupOrphanAssets, backfillMissingHashes } = require(bundle)
  const lib = path.join(tmp, 'lib')
  fs.mkdirSync(lib, { recursive: true })

  // 造库:需有 assets 表(回填要 hash 列)。用 db.ts 建表太绕,直接手建最小表(与维护查询对齐)
  const dbPath = path.join(lib, 'library.db')
  const db = new Database(dbPath)
  db.exec(`CREATE TABLE assets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', ext TEXT NOT NULL DEFAULT 'png',
    rel_dir TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0, colors TEXT NOT NULL DEFAULT '[]', hash TEXT NOT NULL DEFAULT '',
    star INTEGER NOT NULL DEFAULT 0, comment TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, imported_at INTEGER NOT NULL, deleted_at INTEGER
  )`)
  db.close()

  // 有效素材 + 孤儿 + 非结构文件
  const sample = fs.readFileSync(path.join(__dirname, '..', 'test-fixtures', 'sample.png'))
  const mkAssetDir = (id) => {
    const d = path.join(lib, 'assets', 'ab', id)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, `${id}.png`), sample)
    fs.writeFileSync(path.join(d, 'thumbnail.jpg'), sample)
    return d
  }
  const validId = 'a1b2c3d4e5f60708'
  mkAssetDir(validId)
  const orphanId = '0011223344556677'
  mkAssetDir(orphanId)
  // 非资产结构(不匹配 16hex):不删
  fs.writeFileSync(path.join(lib, 'assets', 'notes.txt'), 'keep me')
  const weirdDir = path.join(lib, 'assets', 'ab', 'not-a-real-asset')
  fs.mkdirSync(weirdDir, { recursive: true })
  fs.writeFileSync(path.join(weirdDir, 'x.txt'), 'keep')

  // 注册有效素材(rel_dir 与目录一致),hash 留空待回填
  const db2 = new Database(dbPath)
  const now = Date.now()
  db2.prepare('INSERT INTO assets (id, name, ext, rel_dir, created_at, imported_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(validId, 'valid.png', 'png', `assets/ab/${validId}`, now, now)
  db2.prepare('INSERT INTO assets (id, name, ext, rel_dir, created_at, imported_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('a2b2c3d4e5f60708', 'dup.png', 'png', `assets/ab/a2b2c3d4e5f60708`, now, now)
  db2.close()
  mkAssetDir('a2b2c3d4e5f60708')

  // 跑维护(注入临时库与路径,绕开 electron app)
  const libDb = new Database(dbPath)
  const removed = await cleanupOrphanAssets(lib, libDb)
  ok(`孤儿目录被清理(1 个)`, removed === 1, `removed=${removed}`)
  ok(`有效素材目录保留`, fs.existsSync(path.join(lib, 'assets', 'ab', validId, `${validId}.png`)))
  ok(`孤儿目录已删`, !fs.existsSync(path.join(lib, 'assets', 'ab', orphanId)))
  ok(`非资产结构保留(notes.txt/非16hex目录)`, fs.existsSync(path.join(lib, 'assets', 'notes.txt')) && fs.existsSync(weirdDir))

  const backfilled = await backfillMissingHashes(lib, libDb)
  const h1 = libDb.prepare('SELECT hash FROM assets WHERE id = ?').get(validId).hash
  const h2 = libDb.prepare('SELECT hash FROM assets WHERE id = ?').get('a2b2c3d4e5f60708').hash
  libDb.close()
  ok(`dHash 回填(2 张图)`, backfilled === 2 && /^[0-9a-f]{16}$/.test(h1) && h1 === h2, `backfilled=${backfilled} h1=${h1}`)

  fs.rmSync(tmp, { recursive: true, force: true })
  try { fs.rmSync(bundle, { force: true }) } catch { /* 忽略 */ }
  console.log(failed === 0 ? '\n✓ 全部通过' : `\n${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e)
  process.exit(1)
})
