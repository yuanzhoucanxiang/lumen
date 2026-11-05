/**
 * 标签治理纯函数实测（里程碑 219）：
 *   现场转译 src/shared/tagName.ts（真实源码）→ 验证：
 *     ① normalizeTagName 口径：大小写/空格/分隔符/全半角归一到同一个键
 *     ② planAgentTags 复用优先：不同写法命中已有标签，不新建
 *     ③ 额度：quota=0 只复用（全部进 unknown，带近似候选）；quota=2 最多建 2 个
 *     ④ suggestSimilarTagNames 给出接近的已有标签
 *     ⑤ planAgentTags 对同一批里的重复写法去重
 *   用法：node scripts/test-tag-governance.cjs（不需要 Electron / 数据库）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const esbuild = require('esbuild')

async function main() {
  let failed = 0
  const ok = (m) => console.log('  ✓', m)
  const fail = (m) => {
    console.error('  ✗', m)
    failed++
  }
  const check = (name, cond, detail) => (cond ? ok(`${name} - ${detail}`) : fail(`${name} - ${detail}`))

  const src = path.join(__dirname, '..', 'src', 'shared', 'tagName.ts')
  const out = esbuild.buildSync({
    entryPoints: [src],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent'
  })
  const tmpFile = path.join(os.tmpdir(), `lumen-tagname-${Date.now()}.cjs`)
  fs.writeFileSync(tmpFile, out.outputFiles[0].text)
  const mod = require(tmpFile)
  fs.rmSync(tmpFile, { force: true })

  const { normalizeTagName, planAgentTags, suggestSimilarTagNames } = mod

  // ① 归一
  const same = ['AI生成', 'ai生成', 'AI 生成', 'AI-生成', ' AI_生成 ', 'ＡＩ生成']
  const keys = new Set(same.map((s) => normalizeTagName(s)))
  check('归一：大小写/空格/分隔符/全角写法同键', keys.size === 1, `keys=${JSON.stringify([...keys])}`)
  check('归一：不同词不同键', normalizeTagName('奇幻场景') !== normalizeTagName('人物'), 'ok')

  // ② 复用优先
  const existing = [
    { name: 'AI生成' },
    { name: '奇幻场景' },
    { name: '人物' }
  ]
  const reuse = planAgentTags(['ai 生成', '奇幻-场景'], existing, 2)
  check('复用优先：不同写法命中已有标签', reuse.create.length === 0 && reuse.apply.length === 2, JSON.stringify(reuse))
  check('复用优先：apply 用库里的规范写法', reuse.apply.includes('AI生成') && reuse.apply.includes('奇幻场景'), JSON.stringify(reuse.apply))

  // ③ 额度
  const onlyReuse = planAgentTags(['全新标签A', '全新标签B'], existing, 0)
  check(
    'quota=0 只复用：未知标签不创建',
    onlyReuse.create.length === 0 && onlyReuse.apply.length === 0 && onlyReuse.unknown.length === 2,
    JSON.stringify(onlyReuse)
  )
  const limited = planAgentTags(['全新标签A', '全新标签B', '全新标签C'], existing, 2)
  check(
    'quota=2：只建前 2 个，第 3 个转 unknown',
    limited.create.length === 2 && limited.unknown.length === 1 && limited.unknown[0].name === '全新标签C',
    JSON.stringify(limited)
  )

  // ④ 近似候选（完全相同归一键的由"复用"处理，这里测近形与包含关系）
  const sug = suggestSimilarTagNames('奇幻场境', existing)
  check('近似候选：近形命中「奇幻场景」', sug.includes('奇幻场景'), JSON.stringify(sug))
  const sug2 = suggestSimilarTagNames('奇幻', existing)
  check('近似候选：包含关系命中「奇幻场景」', sug2.includes('奇幻场景'), JSON.stringify(sug2))

  // ⑤ 批内去重
  const dup = planAgentTags(['新词', '新 词', '新-词'], existing, 5)
  check('批内去重：三种写法只建一个', dup.create.length === 1 && dup.apply.length === 1, JSON.stringify(dup))

  // ⑥ 无额度上限
  const unlimited = planAgentTags(['甲词', '乙词', '丙词'], existing, -1)
  check('quota=-1：不限制', unlimited.create.length === 3 && unlimited.unknown.length === 0, JSON.stringify(unlimited))

  console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
