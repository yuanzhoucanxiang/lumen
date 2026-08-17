/**
 * 数据库索引/查询计划验证脚本(后端优化阶段 2 / 任务 2.1):
 *   用 better-sqlite3 直接打开当前素材库 library.db,对查重/回收站三条热查询跑
 *   EXPLAIN QUERY PLAN,输出计划详情;--assert 时进一步断言走新索引(SEARCH 而非 SCAN)。
 *
 *   验证点(与 db.ts migrate 新增索引对应):
 *     ① WHERE hash=? AND size=? AND deleted_at IS NULL   -> idx_assets_hash_size
 *     ② WHERE name=? AND size=? AND deleted_at IS NULL   -> idx_assets_name_size
 *     ③ WHERE deleted_at IS NOT NULL(回收站)             -> 不再全表 SCAN assets
 *
 *   纯脚本,不走 CDP/渲染层。用法:
 *     node scripts/bench-db.cjs [--db <library.db 路径>] [--assert]
 *   db 路径缺省取 %APPDATA%/LUMEN/config.json 的 current 库。
 *
 *   注意:better-sqlite3 按 Electron ABI 编译,系统 node 直接 require 会报
 *   NODE_MODULE_VERSION 不匹配;脚本会自动用 ELECTRON_RUN_AS_NODE 重跑自身。
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const QUERIES = [
  {
    name: '查重哈希路径(isDuplicate ②)',
    sql: 'SELECT 1 FROM assets WHERE hash = ? AND size = ? AND deleted_at IS NULL LIMIT 1',
    params: ['deadbeef', 12345],
    expectIndex: 'idx_assets_hash_size'
  },
  {
    name: '查重快速路径(isDuplicate ①)',
    sql: 'SELECT 1 FROM assets WHERE name = ? AND size = ? AND deleted_at IS NULL LIMIT 1',
    params: ['__no_such_file__.png', 12345],
    expectIndex: 'idx_assets_name_size'
  },
  {
    // libraryStats 每次库刷新都跑;EXPLAIN 实测命中覆盖索引(不回表)。
    // 注意不能用带 ORDER BY imported_at 的回收站分页变体断言:优化器会合理地
    // 改选 idx_assets_imported(索引序免排序),那不是缺陷。
    name: '回收站统计(libraryStats deleted 计数)',
    sql: 'SELECT COUNT(*) FROM assets WHERE deleted_at IS NOT NULL',
    params: [],
    expectIndex: 'idx_assets_deleted'
  }
]

function resolveDbPath() {
  const idx = process.argv.indexOf('--db')
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]
  if (!process.env.APPDATA) throw new Error('无法定位 config.json(缺少 APPDATA)')
  const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'LUMEN', 'config.json'), 'utf-8'))
  if (!cfg.current) throw new Error('config.json 缺少 current')
  return path.join(cfg.current, 'library.db')
}

function main(Database) {
  const assert = process.argv.includes('--assert')
  const dbPath = resolveDbPath()
  if (!fs.existsSync(dbPath)) throw new Error(`库文件不存在: ${dbPath}`)

  const db = new Database(dbPath)
  const idxAll = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_assets%'")
    .all()
    .map((r) => r.name)
  console.log(`db = ${dbPath}`)
  console.log(`assets 索引: ${idxAll.join(', ')}`)

  let failed = 0
  let pass = 0
  for (const q of QUERIES) {
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + q.sql).all(...q.params)
    const detail = plan.map((p) => p.detail).join(' | ')
    // "USING INDEX" 与 "USING COVERING INDEX" 都是索引命中
    const usesIdx = detail.includes('SEARCH') && /USING (COVERING )?INDEX/.test(detail)
    const hitsExpect = usesIdx && detail.includes(q.expectIndex)
    const ok = q.soft ? usesIdx : hitsExpect
    console.log('')
    console.log(`[${q.name}]`)
    console.log(`  SQL  : ${q.sql}`)
    console.log(`  PLAN : ${detail}`)
    if (assert) {
      const softNote = q.soft ? `(宽松断言:SEARCH+INDEX 即可,期望 ${q.expectIndex})` : `期望索引 ${q.expectIndex}`
      console.log(`  ${ok ? 'PASS' : 'FAIL'} ${hitsExpect ? `命中 ${q.expectIndex}` : softNote}`)
      if (ok) pass++
      else failed++
    }
  }
  /* ---- color_count 物化列一致性(阶段 2b)---- */
  const mismatch = db.prepare('SELECT COUNT(*) AS n FROM assets WHERE color_count != json_array_length(colors)').get().n
  const byCol = db.prepare('SELECT COUNT(*) AS n FROM assets WHERE color_count <= 3').get().n
  const byJson = db.prepare('SELECT COUNT(*) AS n FROM assets WHERE json_array_length(colors) <= 3').get().n
  console.log('')
  console.log(`[color_count 物化列一致性]`)
  console.log(`  与 json_array_length 不一致的行数: ${mismatch}; color_count<=3 与 JSON 口径计数: ${byCol} / ${byJson}`)
  if (assert) {
    const ok = mismatch === 0 && byCol === byJson
    console.log(`  ${ok ? 'PASS' : 'FAIL'} 物化列与 JSON 等价`)
    if (ok) pass++
    else failed++
  }

  db.close()

  if (assert) {
    console.log('')
    console.log(`${pass} PASS / ${failed} FAIL`)
    if (failed > 0) process.exit(1)
  }
}

/* ---- 启动:优先直接 require;ABI 不匹配时用 Electron 的 node 模式重跑自身 ---- */
let Database
try {
  Database = require('better-sqlite3')
  main(Database)
} catch (e) {
  if (!/NODE_MODULE_VERSION|ABI|was compiled against a different Node/.test(String((e && e.message) || ''))) {
    console.error('BENCH CRASH:', (e && e.message) || e)
    process.exit(1)
  }
  const electronPath = require('electron') // 普通 node 下返回 electron 可执行文件路径
  const r = spawn(electronPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  r.on('exit', (code) => process.exit(code ?? 1))
}
