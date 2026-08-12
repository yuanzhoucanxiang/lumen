/**
 * LUMEN 一键发布脚本。
 *
 * 用法：
 *   node scripts/release.cjs                # 发布（版本号 patch+1，notes.md 存在则用之，否则从工作日志生成草稿）
 *   node scripts/release.cjs --bump minor   # 次版本号 +1
 *   node scripts/release.cjs --dry-run      # 只生成草稿 + 校验 + 显示将要执行的命令，不打包不发布
 *   node scripts/release.cjs --notes my.md  # 指定 notes 文件
 *   node scripts/release.cjs --no-git       # 不执行 git tag/push（仅 gh release）
 *
 * 流程：版本 bump → notes 生成/校验 → npm run build:win → gh release create → git tag + push
 */
const { execSync } = require('child_process')
const { existsSync, readFileSync, writeFileSync, rmSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..')
const NOTES_FILE = join(ROOT, 'notes.md')
const LOG_FILE = join(ROOT, '工作日志.md')

/* ---------------- 参数解析 ---------------- */
const args = process.argv.slice(2)
const bump = args.includes('--bump')
  ? args[args.indexOf('--bump') + 1] || 'patch'
  : 'patch'
const dryRun = args.includes('--dry-run')
const noGit = args.includes('--no-git')
const notesArg = args.includes('--notes') ? args[args.indexOf('--notes') + 1] : null

const ok = (m) => console.log('  ✓', m)
const fail = (m) => {
  console.error('  ✗', m)
  process.exit(1)
}

/* ---------------- 1. 版本号 ---------------- */
const pkgPath = join(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const oldVer = pkg.version

// 计算新版本
const [maj, min, pat] = oldVer.split('.').map(Number)
const newVer =
  bump === 'major'
    ? `${maj + 1}.0.0`
    : bump === 'minor'
      ? `${maj}.${min + 1}.0`
      : bump === 'patch'
        ? `${maj}.${min}.${pat + 1}`
        : oldVer
console.log(`版本: v${oldVer} → v${newVer} (${bump})`)

if (bump !== 'none' && !dryRun) {
  // 更新 package.json（不自动打 tag，发布末尾统一打）
  pkg.version = newVer
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  ok('package.json 版本已更新')
}

/* ---------------- 2. notes 生成 ---------------- */
let notes = ''
const useFile = notesArg || existsSync(NOTES_FILE)
if (useFile) {
  const f = notesArg ? join(ROOT, notesArg) : NOTES_FILE
  if (!existsSync(f)) fail(`notes 文件不存在: ${f}`)
  notes = readFileSync(f, 'utf-8').trim()
  ok(`使用 notes 文件: ${f}`)
} else {
  notes = generateDraftFromLog()
  if (dryRun) {
    ok('从工作日志生成的 notes 草稿（dry-run 不写文件）:')
    console.log('----------------------------------------')
    console.log(notes)
    console.log('----------------------------------------')
  } else {
    writeFileSync(NOTES_FILE, notes + '\n', 'utf-8')
    ok('已从工作日志生成 notes 草稿 → notes.md（编辑后再次运行即可发布）')
  }
}

/* ---------------- 3. notes 格式校验 ---------------- */
validateNotes(notes)

/* ---------------- 4. 构建 ---------------- */
if (!dryRun) {
  console.log('构建中 (npm run build:win)…')
  execSync('npm run build:win', { cwd: ROOT, stdio: 'inherit' })
  ok('打包完成')
}

/* ---------------- 5. 发布 ---------------- */
const setupExe = `dist/Lumen-${newVer}-setup.exe`
const blockmap = `dist/Lumen-${newVer}-setup.exe.blockmap`
const latestYml = 'dist/latest.yml'
if (!dryRun && !existsSync(join(ROOT, setupExe))) {
  fail(`未找到安装包: ${setupExe}（构建失败？）`)
}

const tag = `v${newVer}`
// 发布仓库固定为 shiguang-materials（安装包仓库），源码仓库是 lumen
const RELEASE_REPO = 'yuanzhoucanxiang/shiguang-materials'
const cmd = [
  'gh release create',
  tag,
  setupExe,
  blockmap,
  latestYml,
  `--repo ${RELEASE_REPO}`,
  `--title "LUMEN v${newVer}"`,
  `--notes "${notes.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
].join(' ')

if (dryRun) {
  console.log('\n[dry-run] 将执行的发布命令:')
  console.log('  ' + cmd)
  if (!noGit) console.log('  git tag + push 流程')
  console.log('\n[dry-run] 结束，未执行任何操作。')
  process.exit(0)
}

console.log('发布中…')
execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
ok(`GitHub Release 已创建: ${tag}`)

// 默认 notes.md 已用尽,删除避免下次发布复用旧内容(自定义 --notes 文件保留)
if (!notesArg && existsSync(NOTES_FILE)) {
  rmSync(NOTES_FILE, { force: true })
  ok('notes.md 已清理（下次发布从工作日志重新生成）')
}

/* ---------------- 6. git tag + push ---------------- */
if (!noGit) {
  execSync('git add -A && git commit -m "chore: release v' + newVer + '" --allow-empty', { cwd: ROOT, stdio: 'inherit' })
  execSync(`git tag ${tag}`, { cwd: ROOT, stdio: 'inherit' })
  execSync('git push && git push --tags', { cwd: ROOT, stdio: 'inherit' })
  ok('git 已提交并推送 (含 tag)')
}

console.log(`\n🎉 发布完成: LUMEN v${newVer}`)
console.log(`   下载: https://github.com/yuanzhoucanxiang/shiguang-materials/releases/tag/${tag}`)

/* ================ 辅助函数 ================ */

/**
 * 从工作日志最后一条里程碑生成分点草稿。
 * 启发式：按「；」/「——」切成条目，按关键词分类（修复→🐛，新增/支持/优化→✨/⚙️）。
 */
function generateDraftFromLog() {
  if (!existsSync(LOG_FILE)) return ''
  const lines = readFileSync(LOG_FILE, 'utf-8').split('\n')
  // 找最后一条里程碑行（| N | ... |，注意行尾是 \r，$ 不匹配 \r，故用 \|\s*$ 收尾）
  let last = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^\|\s*\d+\s*\|(.+)\|\s*$/)
    if (m) {
      last = m[1]
      break
    }
  }
  if (!last) return ''

  // 去掉「发布 vX.Y.Z」尾巴（兼容全角/半角分号 + 行尾可能的 | ）
  last = last.replace(/[；;]?\s*发布 v[\d.]+\s*\|?\s*$/, '').trim()

  // 按分隔符切成条目（兼容全角/半角分号）
  const segments = last
    .split(/[；;。]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/发布 v[\d.]+$/.test(s)) // 去掉「发布 vX.Y.Z」残留

  // 冒号前是主题（如「视频封面 + 更新说明格式」），作为新功能条目
  const theme = segments[0].split('：')[0].trim()

  const groups = { '✨ 新功能': [], '🐛 修复': [], '⚙️ 优化': [] }
  for (const seg of segments) {
    let clean = seg.replace(/^[①-⑨]\**/, '').trim()
    // 去掉 markdown 加粗符号，长条目取主题部分（「——」前）保持简洁
    clean = clean.replace(/\*\*/g, '')
    if (!clean) continue
    const brief = clean.split('——')[0].trim()
    if (/修复|解决|热修|不再/.test(clean)) groups['🐛 修复'].push(brief)
    else if (/新增|支持|实现|补齐|补全/.test(clean)) groups['✨ 新功能'].push(brief)
    else groups['⚙️ 优化'].push(brief)
  }
  // 主题作为第一条新功能
  if (theme && !groups['✨ 新功能'].includes(theme)) {
    groups['✨ 新功能'].unshift(theme.replace(/\*\*/g, ''))
  }

  const out = []
  for (const [title, items] of Object.entries(groups)) {
    if (items.length === 0) continue
    out.push(title)
    out.push(...items.map((it) => `· ${it}`))
    out.push('')
  }
  return out.join('\n').trim()
}

/** 校验 notes 格式：非空、有分类、每条 `·` 条目前有分类标题 */
function validateNotes(notes) {
  if (!notes) fail('notes 为空')
  const lines = notes.split('\n')
  let inBlock = false
  let itemCount = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      inBlock = false
      continue
    }
    if (line.startsWith('·')) {
      itemCount++
      if (!inBlock) fail(`条目「${line}」缺少分类标题（· 前应有分类行，如「✨ 新功能」）`)
    } else {
      inBlock = true
    }
  }
  if (itemCount === 0) fail('notes 没有任何「· 」条目')
  ok(`notes 格式校验通过（${itemCount} 条）`)
}
