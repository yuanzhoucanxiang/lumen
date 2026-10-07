/**
 * 更新说明解析器验证（里程碑 175）：esbuild 转译真实源码 src/renderer/src/updateNotes.ts 后断言。
 * 跑法：node scripts/test-update-notes.cjs
 *
 * 覆盖：干净格式 / markdown 标题剥离 / 版本行跳过 / 引言段落 / 多种条目符 / 空输入。
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'renderer', 'src', 'updateNotes.ts')
const OUT = path.join(os.tmpdir(), `lumen-updatenotes-${Date.now()}.cjs`)

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  console.log(ok ? '  PASS' : '  FAIL', name, detail ? '- ' + detail : '')
  if (ok) pass++
  else fail++
}

try {
  // esbuild 转译真实源码（不引 JSX，纯 TS）
  execSync(`npx esbuild "${SRC}" --bundle --platform=node --format=cjs --outfile="${OUT}"`, {
    cwd: ROOT,
    stdio: 'pipe'
  })
  const { parseUpdateNotes } = require(OUT)

  // 1. 干净格式（release.cjs 自动草稿格式）
  const clean = parseUpdateNotes('✨ 新功能\n· 条目一\n· 条目二\n\n🐛 修复\n· 修了一个 bug')
  check(
    '干净格式：标题 + 条目',
    clean.length === 2 && clean[0].kind === 'title' && clean[0].text === '✨ 新功能' && clean[0].items.length === 2 && clean[1].text === '🐛 修复',
    JSON.stringify(clean)
  )

  // 2. markdown 标题（## / ###）剥离
  const md = parseUpdateNotes('## ✨ 新功能\n· 助手看图追问\n### ⚙️ 优化\n· 界面更好')
  check(
    'markdown 标题符号剥离',
    md.length === 2 && md[0].text === '✨ 新功能' && md[1].text === '⚙️ 优化' && md.every((b) => !b.text.includes('#')),
    JSON.stringify(md.map((b) => b.text))
  )

  // 3. 版本行（# LUMEN v0.8.35）整行跳过
  const withVersion = parseUpdateNotes('# LUMEN v0.8.35\n\n✨ 新功能\n· 条目')
  check(
    '版本标题行跳过',
    withVersion.length === 1 && withVersion[0].text === '✨ 新功能',
    JSON.stringify(withVersion.map((b) => b.text))
  )

  // 4. 引言段落 → paragraph（不是加粗标题）
  const withIntro = parseUpdateNotes('# LUMEN v1.0\n\n本版带来了很多改进。\n\n✨ 新功能\n· 条目')
  check(
    '引言段落识别为正文段',
    withIntro.length === 2 && withIntro[0].kind === 'paragraph' && withIntro[0].text === '本版带来了很多改进。' && withIntro[1].kind === 'title',
    JSON.stringify(withIntro.map((b) => [b.kind, b.text]))
  )

  // 5. 兼容 - / * / • 条目符
  const alt = parseUpdateNotes('✨ 新功能\n- 破折号条目\n* 星号条目\n• 圆点条目')
  check(
    '兼容 -/*/• 条目符',
    alt.length === 1 && alt[0].items.length === 3 && alt[0].items[0] === '破折号条目',
    JSON.stringify(alt[0].items)
  )

  // 6. 无标题的裸条目（旧格式兜底）
  const bare = parseUpdateNotes('· 第一条\n· 第二条')
  check('无标题裸条目兜底', bare.length === 1 && bare[0].items.length === 2, JSON.stringify(bare))

  // 7. 空输入 / 纯空白
  check('空输入返回空数组', parseUpdateNotes('').length === 0 && parseUpdateNotes('   \n\n ').length === 0)

  // 7b. 零符号块格式（里程碑 176 起推荐）：首行分类、其余行条目
  const plain = parseUpdateNotes('新功能\n助手看图追问：出过结果后可以继续问\n助手视觉重排：按描述重排\n\n优化\n界面贴合三套主题')
  check(
    '零符号块格式：分类 + 条目',
    plain.length === 2 &&
      plain[0].kind === 'title' &&
      plain[0].text === '新功能' &&
      plain[0].items.length === 2 &&
      plain[1].text === '优化' &&
      plain[1].items[0] === '界面贴合三套主题',
    JSON.stringify(plain)
  )

  // 7c. 零符号格式下不得残留任何特殊符号（#, ·, emoji 等）
  const symbolRe = /[#·•]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
  const allText = plain.flatMap((b) => [b.text, ...b.items]).join(' ')
  check('零符号格式解析结果不含特殊符号', !symbolRe.test(allText), allText.slice(0, 60))

  // 7d. 单行区块 = 段落（引言）
  const oneLine = parseUpdateNotes('本版带来很多改进。')
  check('单行区块识别为段落', oneLine.length === 1 && oneLine[0].kind === 'paragraph', JSON.stringify(oneLine))

  // 8. 真实 v0.8.35 说明（回归到实际发布内容，确保渲染不含 # 符号）
  const real = fs.readFileSync(path.join(ROOT, '.ui-shot', 'notes-fixture-v0.8.35.md'), 'utf-8')
  const r = parseUpdateNotes(real)
  check(
    '真实 v0.8.35 说明：无 # 符号且引言为段落',
    r.length >= 3 && !r.some((b) => b.text.includes('#') || b.items.some((it) => it.includes('#'))) && r[0].kind === 'paragraph',
    JSON.stringify(r.slice(0, 3).map((b) => [b.kind, b.text.slice(0, 18)]))
  )

  console.log('')
  console.log(`${pass} PASS / ${fail} FAIL`)
} finally {
  try {
    fs.rmSync(OUT, { force: true })
  } catch {
    /* 清理失败不影响结果 */
  }
}
process.exit(fail > 0 ? 1 : 0)
