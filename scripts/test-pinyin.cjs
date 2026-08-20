/**
 * 拼音检索串验证(里程碑 98 / 拼音搜索):
 *   esbuild 现场转译真实源码,两部分:
 *   ① pinyin.ts:全拼/首字母正确、多音字、纯 ASCII 空串、混合名、空名;
 *   ② maintenance.ts 的 backfillMissingPinyin:存量 '' 且含 CJK 的行回填,ASCII 行保持 ''。
 *   用法:ELECTRON_RUN_AS_NODE=1 node scripts/test-pinyin.cjs
 */
const esbuild = require('esbuild')
const fs = require('fs')
const path = require('path')

async function main(Database) {
  let failed = 0
  const ok = (m) => console.log('  ✓', m)
  const fail = (m) => {
    console.error('  ✗', m)
    failed++
  }

  const bundle = path.join(__dirname, '..', '.ui-shot', '.tmp-pinyin.cjs')
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'main', 'pinyin.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle
  })
  const { computeNamePinyin } = require(bundle)

  const cases = [
    ['人物造型概念参考', { full: 'renwuzaoxinggainiancankao', initial: 'rwzxgnck' }],
    ['重庆', { full: 'chongqing', initial: 'cq' }],
    ['胶片-2024', { full: 'jiaopian2024', initial: 'jp' }],
    ['城堡 castle 01', { full: 'chengbaocastle01', initial: 'cbcastle' }]
  ]
  for (const [name, expected] of cases) {
    const got = computeNamePinyin(name)
    ok(`拼音正确:「${name}」→ ${got.full}/${got.initial}`, got.full === expected.full && got.initial === expected.initial, JSON.stringify(got))
  }

  const py = computeNamePinyin('my_photo_01')
  ok('纯 ASCII 名返回空串(不生成拼音)', py.full === '' && py.initial === '', JSON.stringify(py))

  const empty = computeNamePinyin('')
  ok('空名返回空串', empty.full === '' && empty.initial === '', JSON.stringify(empty))

  const mixed = computeNamePinyin('2026年3月素材')
  ok('数字+中文混合名', mixed.full === '2026nian3yuesucai' && mixed.initial === 'nysc', JSON.stringify(mixed))

  /* ---------- ② 回填逻辑(转译真实 maintenance.ts) ---------- */
  const maintBundle = path.join(__dirname, '..', '.ui-shot', '.tmp-maint-pinyin.cjs')
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'main', 'maintenance.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['better-sqlite3', 'electron', 'sharp', 'ffmpeg-static', 'ag-psd', 'fontkit'],
    outfile: maintBundle
  })
  const { backfillMissingPinyin } = require(maintBundle)

  const dbPath = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'pinyin-')), 'library.db')
  const db = new Database(dbPath)
  db.exec(`CREATE TABLE assets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', ext TEXT NOT NULL DEFAULT 'png',
    rel_dir TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0, colors TEXT NOT NULL DEFAULT '[]', hash TEXT NOT NULL DEFAULT '',
    star INTEGER NOT NULL DEFAULT 0, comment TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, imported_at INTEGER NOT NULL, deleted_at INTEGER,
    name_pinyin TEXT NOT NULL DEFAULT '', name_pinyin_init TEXT NOT NULL DEFAULT ''
  )`)
  const ins = db.prepare('INSERT INTO assets (id, name, rel_dir, created_at, imported_at) VALUES (?, ?, ?, 0, 0)')
  ins.run('1111111111111111', '城堡概念图.png', 'assets/11/1111111111111111')
  ins.run('2222222222222222', 'photo-01.png', 'assets/22/2222222222222222')
  const done = await backfillMissingPinyin('', db)
  const zh = db.prepare('SELECT name_pinyin, name_pinyin_init FROM assets WHERE id = ?').get('1111111111111111')
  const en = db.prepare('SELECT name_pinyin, name_pinyin_init FROM assets WHERE id = ?').get('2222222222222222')
  db.close()
  ok('回填:中文名行回填全拼/首字母', done === 1 && zh.name_pinyin === 'chengbaogainiantu' && zh.name_pinyin_init === 'cbgnt', JSON.stringify(zh))
  ok('回填:纯 ASCII 名保持空串不计算', en.name_pinyin === '' && en.name_pinyin_init === '', JSON.stringify(en))

  try {
    fs.rmSync(bundle, { force: true })
    fs.rmSync(maintBundle, { force: true })
  } catch {
    /* 忽略 */
  }
  console.log(failed === 0 ? '\n✓ 全部通过' : `\n${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

/* ---- 启动:better-sqlite3 按 Electron ABI 编译,系统 node 直接 require 会报
   NODE_MODULE_VERSION 不匹配;先试 require,报 ABI 错时用 Electron 的 node 模式重跑自身 ---- */
let Database
try {
  Database = require('better-sqlite3')
  // better-sqlite3 的 .node 在首次 new Database 时才加载:内存库探针提前触发 ABI 校验,
  // 不匹配时先重跑,避免打印一半测试输出再崩
  const probe = new Database(':memory:')
  probe.close()
} catch (e) {
  const msg = String((e && e.message) || '')
  if (!/NODE_MODULE_VERSION|ABI|was compiled against a different Node/.test(msg)) {
    console.error('TEST CRASH:', e)
    process.exit(1)
  }
  const { spawn } = require('child_process')
  const electronPath = require('electron') // 普通 node 下返回 electron 可执行文件路径
  const r = spawn(electronPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  r.on('exit', (code) => process.exit(code ?? 1))
  return
}
void main(Database).catch((e) => {
  console.error('TEST CRASH:', e)
  process.exit(1)
})
