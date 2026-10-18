/* 设计令牌与对比度检查（里程碑 198/200）
   用法：node scripts/test-theme-tokens.cjs
   断言：三主题语义令牌齐全；text-main/dim/faint 在 panel/base 上达到 WCAG AA。 */
const fs = require('fs')
const path = require('path')

const TOKENS_FILE = path.join(__dirname, '..', 'src', 'renderer', 'src', 'styles', 'tokens.css')
const css = fs.readFileSync(TOKENS_FILE, 'utf8')

function blockAfter(marker) {
  const start = css.indexOf(marker)
  if (start < 0) throw new Error('缺少令牌块: ' + marker)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error('令牌块未闭合: ' + marker)
}

const blocks = {
  'silver-gelatin': blockAfter(':root {'),
  'pixel-glitch': blockAfter(":root[data-theme='pixel-glitch'] {"),
  'cyber-glitch': blockAfter(":root[data-theme='cyber-glitch'] {")
}

const REQUIRED = [
  'bg-base',
  'bg-panel',
  'bg-raised',
  'bg-hover',
  'bg-active',
  'bg-input',
  'border',
  'border-strong',
  'text-main',
  'text-dim',
  'text-faint',
  'text-decor',
  'accent',
  'accent-hover',
  'accent-deep',
  'accent-soft',
  'accent-text',
  'on-accent',
  'ring',
  'amber',
  'amber-soft',
  'danger',
  'danger-soft',
  'radius',
  'font-display',
  'font-ui',
  'font-data',
  'shadow-menu',
  'shadow-dialog'
]

/** 结构令牌由 :root 继承，不要求每个主题重复声明 */
const SHARED = [
  'space-1',
  'space-2',
  'space-3',
  'space-4',
  'space-5',
  'space-6',
  'text-xs',
  'text-sm',
  'text-base',
  'text-lg',
  'text-xl',
  'motion-fast',
  'motion-base',
  'motion-slow',
  'ease-standard',
  'z-panel',
  'z-overlay',
  'z-toast'
]

function parse(block) {
  const map = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*--([\w-]+)\s*:\s*([^;]+);/)
    if (m) map[m[1]] = m[2].trim()
  }
  return map
}

function lum(hex) {
  const c = hex.replace('#', '')
  if (c.length !== 6) return null
  const v = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}

function ratio(fg, bg) {
  const a = lum(fg)
  const b = lum(bg)
  if (a == null || b == null) return null
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
  ok ? pass++ : fail++
}

const rootTokens = parse(blocks['silver-gelatin'])
const missingShared = SHARED.filter((t) => !rootTokens[t])
check('共享结构令牌齐全', missingShared.length === 0, missingShared.length ? `缺: ${missingShared.join(', ')}` : `${SHARED.length} 个`)

for (const [theme, block] of Object.entries(blocks)) {
  const tokens = parse(block)
  const missing = REQUIRED.filter((t) => !tokens[t])
  check(`${theme} 主题令牌齐全`, missing.length === 0, missing.length ? `缺: ${missing.join(', ')}` : `${Object.keys(tokens).length} 个`)
  for (const text of ['text-main', 'text-dim', 'text-faint']) {
    for (const bg of ['bg-panel', 'bg-base']) {
      const r = ratio(tokens[text], tokens[bg])
      check(
        `${theme} ${text} on ${bg} ≥ 4.5`,
        r != null && r >= 4.5,
        r == null ? `${tokens[text]} / ${tokens[bg]} 非 hex` : `${r.toFixed(2)}`
      )
    }
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
