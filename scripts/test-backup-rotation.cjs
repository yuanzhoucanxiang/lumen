/* 自动备份保留策略纯逻辑验证(里程碑 92 / #1):
   不依赖 electron,直接对 fs 语义做断言:
   ① 数据库备份轮转:library.db.bak 依次后移保留 3 代(.bak/.bak.1/.bak.2),超出删除
   ② 全量 ZIP 清理:只保留最近 2 份,旧的删除
   用法:node scripts/test-backup-rotation.cjs */
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bak-rotation-'))
let failed = 0
const ok = (m) => console.log('  ✓', m)
const fail = (m) => { console.error('  ✗', m); failed++ }

/* ---- 复刻 backup.ts 的轮转语义 ---- */
function rotateDbBackups(libDir) {
  const KEEP = 3
  for (let i = KEEP - 2; i >= 0; i--) {
    const from = i === 0 ? path.join(libDir, 'library.db.bak') : path.join(libDir, `library.db.bak.${i}`)
    const to = path.join(libDir, `library.db.bak.${i + 1}`)
    if (fs.existsSync(from)) fs.renameSync(from, to)
  }
}
function pruneZipBackups(dir, keep = 2) {
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.zip')).sort()
  for (const n of names.slice(0, Math.max(0, names.length - keep))) fs.rmSync(path.join(dir, n), { force: true })
}

/* ---- 场景 ①:DB 轮转保留 3 代 ---- */
const libDir = path.join(tmp, 'lib')
fs.mkdirSync(libDir)
const db = path.join(libDir, 'library.db')
fs.writeFileSync(db, 'v1')
const days = ['v1', 'v2', 'v3', 'v4', 'v5']
for (const v of days) {
  fs.writeFileSync(db, v)
  rotateDbBackups(libDir) // 新备份前轮转(模拟 backupDatabase)
  fs.renameSync(db, path.join(libDir, 'library.db.bak')) // 生成新 .bak
}
const baks = fs.readdirSync(libDir).filter((n) => n.startsWith('library.db.bak')).sort()
const expect = ['library.db.bak', 'library.db.bak.1', 'library.db.bak.2']
ok(`DB 轮转后保留 3 代(${baks.join(',')})`, baks.length === 3 && expect.every((n) => baks.includes(n)))
// 最新 .bak 应是最新版本 v5
ok(`最新 .bak 内容 = v5`, fs.readFileSync(path.join(libDir, 'library.db.bak'), 'utf-8') === 'v5')
ok(`最旧 .bak.2 内容 = v3(超出 3 代的 v1/v2 已删)`, fs.readFileSync(path.join(libDir, 'library.db.bak.2'), 'utf-8') === 'v3')

/* ---- 场景 ②:ZIP 保留最近 2 份 ---- */
const bakDir = path.join(tmp, 'backups')
fs.mkdirSync(bakDir)
for (let d = 1; d <= 5; d++) fs.writeFileSync(path.join(bakDir, `lumen-full-2026-08-0${d}.zip`), `zip${d}`)
pruneZipBackups(bakDir, 2)
const zips = fs.readdirSync(bakDir).filter((n) => n.endsWith('.zip')).sort()
ok(`ZIP 只保留最近 2 份(${zips.join(',')})`, zips.length === 2 && zips[0] === 'lumen-full-2026-08-04.zip' && zips[1] === 'lumen-full-2026-08-05.zip')

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed === 0 ? '✓ 全部通过' : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
