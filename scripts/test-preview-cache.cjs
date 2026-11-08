/**
 * 预览缓存保留策略单测（里程碑 223）：
 *   现场转译 src/main/previewCache.ts → 临时目录验证：
 *     ① 超龄（>30 天）删除、近期保留
 *     ② 总量超上限时按最旧优先删，直到低于上限
 *     ③ 目录不存在返回全 0（不抛错）
 *     ④ 非 .jpg 文件不动（只清自己的缓存）
 *   用法：node scripts/test-preview-cache.cjs（不需要 Electron）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const esbuild = require('esbuild')

const DAY = 24 * 60 * 60 * 1000

async function main() {
  let failed = 0
  const ok = (m) => console.log('  ✓', m)
  const fail = (m) => {
    console.error('  ✗', m)
    failed++
  }
  const check = (name, cond, detail) => (cond ? ok(`${name} - ${detail}`) : fail(`${name} - ${detail}`))

  const src = path.join(__dirname, '..', 'src', 'main', 'previewCache.ts')
  const out = esbuild.buildSync({
    entryPoints: [src],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent'
  })
  const bundle = path.join(os.tmpdir(), `lumen-prevcache-${Date.now()}.cjs`)
  fs.writeFileSync(bundle, out.outputFiles[0].text)
  const { prunePreviewCache } = require(bundle)
  fs.rmSync(bundle, { force: true })

  const now = Date.now()
  const mk = (dir, name, size, ageDays) => {
    const f = path.join(dir, name)
    fs.writeFileSync(f, Buffer.alloc(size, 1))
    const t = new Date(now - ageDays * DAY)
    fs.utimesSync(f, t, t)
    return f
  }

  // ① 超龄删除
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'prev-1-'))
  const old = mk(d1, 'old-640-0.jpg', 100, 40)
  const mid = mk(d1, 'mid-1280-0.jpg', 100, 10)
  const fresh = mk(d1, 'fresh-2048-0.jpg', 100, 1)
  const r1 = prunePreviewCache(d1, { maxAgeDays: 30, maxBytes: 1024 * 1024, now })
  check(
    '超龄删除/近期保留',
    r1.removed === 1 && !fs.existsSync(old) && fs.existsSync(mid) && fs.existsSync(fresh) && r1.kept === 2,
    JSON.stringify(r1)
  )

  // ② 总量上限：5 × 100B，上限 250B → 保留最新的 2 个（200B）
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'prev-2-'))
  const files = [0, 1, 2, 3, 4].map((i) => mk(d2, `f${i}-640-0.jpg`, 100, 5 - i)) // f0 最旧
  const r2 = prunePreviewCache(d2, { maxAgeDays: 30, maxBytes: 250, now })
  check(
    '超量按最旧优先删除',
    r2.removed === 3 && !fs.existsSync(files[0]) && !fs.existsSync(files[1]) && !fs.existsSync(files[2]) && fs.existsSync(files[3]) && fs.existsSync(files[4]),
    JSON.stringify(r2)
  )

  // ③ 目录不存在
  const r3 = prunePreviewCache(path.join(os.tmpdir(), `prev-missing-${Date.now()}`), { now })
  check('目录不存在安全返回', r3.removed === 0 && r3.kept === 0, JSON.stringify(r3))

  // ④ 非 .jpg 不动
  const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'prev-4-'))
  const jpg = mk(d4, 'x-640-0.jpg', 100, 40)
  const other = path.join(d4, 'x-640-0.tmp')
  fs.writeFileSync(other, Buffer.alloc(100, 1))
  const oldT = new Date(now - 40 * DAY)
  fs.utimesSync(other, oldT, oldT)
  const r4 = prunePreviewCache(d4, { maxAgeDays: 30, maxBytes: 1024 * 1024, now })
  check('只清 .jpg 缓存', !fs.existsSync(jpg) && fs.existsSync(other) && r4.removed === 1, JSON.stringify(r4))

  for (const d of [d1, d2, d4]) fs.rmSync(d, { recursive: true, force: true })

  console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
