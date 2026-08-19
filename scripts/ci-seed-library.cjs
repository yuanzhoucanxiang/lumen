/**
 * CI 冒烟种子库生成器(#2):为 GitHub Actions 生成一个"接近真实形态"的最小素材库 +
 * 指向它的 userData(config.json)。测试运行器通过 HOME/APPDATA 指向该 userData,
 * 应用即可在全新环境跑 CDP 测试(不依赖本地真实素材库)。
 *
 * 结构:
 *   library/  assets/ab/{id}/{id}.png + thumbnail.jpg + metadata.json
 *             library.db(better-sqlite3,通过 esbuild 转译的 db.ts 建表)
 *   userData/ config.json(current=library, watchDirs=[], importMode=copy)
 *
 * 种子内容:12 张图(含 2 张内容相同用于查重)、1 个非空文件夹「胶片」、
 * 1 个标签/标签组、1 条回收站软删记录。
 *
 * 用法(ELECTRON_RUN_AS_NODE 下,保证 better-sqlite3 ABI):
 *   node scripts/ci-seed-library.cjs --lib <libDir> --ud <userDataDir>
 */
const esbuild = require('esbuild')
const path = require('path')
const fs = require('fs')

function parseArgs() {
  const a = {}
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--lib') a.lib = process.argv[++i]
    if (process.argv[i] === '--ud') a.ud = process.argv[++i]
  }
  if (!a.lib || !a.ud) throw new Error('用法: --lib <libDir> --ud <userDataDir>')
  return a
}

async function main() {
  const { lib, ud } = parseArgs()
  fs.mkdirSync(lib, { recursive: true })
  fs.mkdirSync(ud, { recursive: true })

  // 转译 db.ts(依赖 bundle;electron 在 RUN_AS_NODE 下为空壳,dialog 仅在损坏路径被 try/catch 包裹)
  // bundle 必须落在项目内:require('better-sqlite3') 从 bundle 所在目录向上找 node_modules
  const bundlePath = path.join(__dirname, '..', '.ui-shot', '.tmp-ci-seed.cjs')
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'main', 'db.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['better-sqlite3', 'electron'],
    outfile: bundlePath
  })
  const { openDb, getDb, closeDb } = require(bundlePath)

  const sample = fs.readFileSync(path.join(__dirname, '..', 'test-fixtures', 'sample.png'))
  const now = Date.now()
  const db = openDb(lib)

  // 素材:12 张(11 张独立 + 1 张内容与第 1 张相同 → 查重 1 组)
  const ins = db.prepare(
    `INSERT INTO assets (id, name, ext, rel_dir, size, width, height, colors, hash, star, comment, url, created_at, imported_at, deleted_at, color_count)
     VALUES (?, ?, 'png', ?, ?, 320, 200, '[]', '', 0, '', '', ?, ?, ?, 0)`
  )
  const ids = []
  for (let i = 1; i <= 12; i++) {
    const id = ('ci' + String(i).padStart(14, '0'))
    const rel = `assets/ab/${id}`
    const abs = path.join(lib, rel)
    fs.mkdirSync(abs, { recursive: true })
    // 第 12 张与第 1 张内容相同(用于 findDuplicates 产生 1 组)
    const dup = i === 12 ? ids[0] : null
    fs.writeFileSync(path.join(abs, `${id}.png`), dup ? fs.readFileSync(path.join(lib, `assets/ab/${dup}/${dup}.png`)) : sample)
    fs.writeFileSync(path.join(abs, 'thumbnail.jpg'), dup ? fs.readFileSync(path.join(lib, `assets/ab/${dup}/thumbnail.jpg`)) : sample)
    fs.writeFileSync(path.join(abs, 'metadata.json'), JSON.stringify({ id, name: `ci-${i}.png`, ext: 'png', size: sample.length, width: 320, height: 200 }))
    ins.run(id, `ci-${i}.png`, rel, sample.length, now, now, i === 3 ? now : null)
    ids.push(id)
  }
  // 文件夹「胶片」+ 全部素材入文件夹
  const folder = db.prepare('INSERT INTO folders (name, parent_id, is_smart, conditions) VALUES (?, NULL, 0, \'{}\')').run('胶片')
  const af = db.prepare('INSERT OR IGNORE INTO asset_folders (asset_id, folder_id) VALUES (?, ?)')
  for (const id of ids) af.run(id, folder.lastInsertRowid)
  // 标签 + 标签组,前 2 张打标签
  const grp = db.prepare('INSERT INTO tag_groups (name) VALUES (\'ci-组\')').run()
  const tag = db.prepare('INSERT INTO tags (name, color, group_id) VALUES (\'ci-标签\', \'#5aa0ff\', ?)').run(grp.lastInsertRowid)
  const at = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
  at.run(ids[0], tag.lastInsertRowid)
  at.run(ids[1], tag.lastInsertRowid)

  closeDb()
  fs.rmSync(bundlePath, { force: true })

  // config.json
  fs.writeFileSync(
    path.join(ud, 'config.json'),
    JSON.stringify(
      { libraries: [{ name: 'ci', path: lib }], current: lib, watchDirs: [], importMode: 'copy' },
      null,
      2
    ),
    'utf-8'
  )

  console.log('seeded:', { lib, ud, assets: 12, folder: '胶片', tag: 'ci-标签' })
}

main().catch((e) => {
  console.error('SEED CRASH:', e)
  process.exit(1)
})
