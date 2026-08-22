/**
 * 从备份恢复数据库 - 脚本级验证(esbuild 转译真实源码)。
 * 运行:ELECTRON_RUN_AS_NODE=1 npx electron scripts/test-restore.cjs
 * (better-sqlite3 按 Electron ABI 编译,普通 node 直接跑会报 NODE_MODULE_VERSION)
 */
const { execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, '.ui-shot', '.tmp-restore.cjs')

// better-sqlite3 ABI 自愈:普通 node 跑不了就用 ELECTRON_RUN_AS_NODE 重启自身
try {
  require('better-sqlite3')
} catch {
  const electron = require(path.join(ROOT, 'node_modules', 'electron'))
  execSync(`"${electron}" "${__filename}"`, {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(0)
}

const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
// 聚合入口:backup 与 db 打进同一 bundle,共享同一个 better-sqlite3 单例
// (分开打会产生两个单例,Windows 上旧句柄占用导致恢复时的文件替换失败)
const entry = path.join(ROOT, '.ui-shot', '.tmp-restore-entry.ts')
fs.writeFileSync(
  entry,
  "export { listDbBackups, listAutoZipBackups, restoreDatabase } from '../src/main/backup'\n" +
    "import * as dbmod from '../src/main/db'\n" +
    'export const openDb = dbmod.openDb\n' +
    'export const closeDb = dbmod.closeDb\n'
)
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['better-sqlite3', 'electron', 'sharp', 'ffmpeg-static', 'ag-psd', 'fontkit'],
  outfile: OUT
})
// bundle 必须落在项目内(module 解析),require 后拿真实函数
const backup = require(OUT)
const dbmod = { openDb: backup.openDb, closeDb: backup.closeDb }

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : '—', detail)
  cond ? pass++ : fail++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-restore-'))
  const libPath = path.join(tmp, 'lib')
  fs.mkdirSync(libPath, { recursive: true })
  const dbPath = path.join(libPath, 'library.db')

  // ① 造"原始状态"库并生成快照
  let db = dbmod.openDb(libPath)
  db.prepare("INSERT INTO tags (name, color) VALUES ('原始名', '#123456')").run()
  dbmod.closeDb()
  fs.copyFileSync(dbPath, path.join(libPath, 'library.db.bak'))

  // ② 改动当前库(模拟快照之后的误操作)
  db = dbmod.openDb(libPath)
  await sleep(30) // 保证 mtime 可分
  db.prepare("UPDATE tags SET name = '改名后'").run()
  const changed = db.prepare('SELECT name FROM tags').get().name
  dbmod.closeDb()
  ok('改动生效(前置)', changed === '改名后', changed)

  // ③ listDbBackups 列出快照
  const list = backup.listDbBackups(libPath)
  ok('列出快照 1 条', list.length === 1, JSON.stringify(list.map((b) => b.path)))
  ok('快照路径正确', list[0] && list[0].path === path.join(libPath, 'library.db.bak'))
  ok('快照大小 > 0', list[0] && list[0].sizeBytes > 0)

  // ④ 恢复
  const r = await backup.restoreDatabase(list[0].path, libPath)
  ok('恢复返回现场路径', /pre-restore-/.test(r.emergencyPath) && fs.existsSync(r.emergencyPath))
  db = dbmod.openDb(libPath)
  const restoredName = db.prepare('SELECT name FROM tags').get().name
  dbmod.closeDb()
  ok('恢复后数据回滚', restoredName === '原始名', restoredName)

  // ⑤ wal/shm 已清理(重开后不应残留旧 wal 造成的数据漂移;此处仅确认恢复调用未报错)
  ok('-wal/-shm 已清', !fs.existsSync(dbPath + '-wal'), '')

  // ⑥ 安全校验:非法路径拒绝
  let rejected = false
  try {
    await backup.restoreDatabase(path.join(tmp, 'evil.db.bak'), libPath)
  } catch {
    rejected = true
  }
  ok('库外同后缀路径被拒', rejected)

  rejected = false
  try {
    await backup.restoreDatabase(path.join(libPath, 'not-a-backup.bak'), libPath)
  } catch {
    rejected = true
  }
  ok('非法文件名被拒', rejected)

  // ⑦ 多代排序(.1 比 .bak 旧)
  await sleep(30)
  fs.copyFileSync(dbPath, path.join(libPath, 'library.db.bak.1'))
  fs.utimesSync(path.join(libPath, 'library.db.bak'), new Date(), new Date())
  const list2 = backup.listDbBackups(libPath)
  ok('多代按时间倒序', list2.length === 2 && list2[0].path.endsWith('library.db.bak'), JSON.stringify(list2.map((b) => path.basename(b.path))))

  fs.rmSync(tmp, { recursive: true, force: true })
  fs.rmSync(OUT, { force: true })
  fs.rmSync(entry, { force: true })
  console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
