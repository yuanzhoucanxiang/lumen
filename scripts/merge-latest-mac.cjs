/**
 * 合并两个架构的 latest-mac.yml（mac 自动更新元数据）。
 *
 * 背景：CI 在 macos-13(x64)/macos-14(arm64) 分别构建,各自生成 latest-mac.yml
 * （只含本架构的 zip 条目）。若直接把后者覆盖前者,自动更新会丢失另一个架构。
 * 本脚本把两份 yml 的 files 合并为一份（根 path/sha512 取 arm64,默认架构）。
 *
 * 该 yml 形状固定（electron-builder 生成）,无需引入 YAML 依赖,按行解析：
 *   version: 0.9.0
 *   files:
 *     - url: Lumen-0.9.0-arm64.zip
 *       sha512: <base64>
 *       size: 123456
 *   path: Lumen-0.9.0-arm64.zip
 *   sha512: <base64>
 *   releaseDate: '2026-08-15T12:00:00.000Z'
 *
 * 用法：node scripts/merge-latest-mac.cjs <x64.yml> <arm64.yml> <out.yml>
 */
const fs = require('fs')

function parseYml(file) {
  // 去掉可能的 BOM;files 条目带缩进(`  - url:`),根字段顶格——按缩进区分
  const content = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '')
  const out = { files: [] }
  let cur = null
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (/^\s*-\s*url:\s*/.test(line)) {
      cur = { url: line.replace(/^\s*-\s*url:\s*/, '').trim() }
      out.files.push(cur)
    } else if (/^\s+sha512:\s*/.test(line) && cur) {
      cur.sha512 = line.replace(/^\s+sha512:\s*/, '').trim()
    } else if (/^\s+size:\s*/.test(line) && cur) {
      cur.size = Number(line.replace(/^\s+size:\s*/, '').trim())
    } else if (line.startsWith('version:')) {
      out.version = line.slice('version:'.length).trim()
    } else if (line.startsWith('path:')) {
      out.path = line.slice('path:'.length).trim()
    } else if (line.startsWith('sha512:')) {
      out.sha512 = line.slice('sha512:'.length).trim()
    } else if (line.startsWith('releaseDate:')) {
      out.releaseDate = line.slice('releaseDate:'.length).trim()
    }
  }
  return out
}

const [x64Path, arm64Path, outPath] = process.argv.slice(2)
if (!x64Path || !arm64Path || !outPath) {
  console.error('用法: node scripts/merge-latest-mac.cjs <x64.yml> <arm64.yml> <out.yml>')
  process.exit(1)
}
for (const p of [x64Path, arm64Path]) {
  if (!fs.existsSync(p)) {
    console.error(`缺少输入文件: ${p}`)
    process.exit(1)
  }
}

const x = parseYml(x64Path)
const a = parseYml(arm64Path)
if (x.files.length === 0 || a.files.length === 0) {
  console.error('解析失败: 至少一份 yml 没有 files 条目')
  process.exit(1)
}
// 根字段以 arm64 为准(默认架构),version/releaseDate 两份应一致
const merged = [
  `version: ${a.version || x.version}`,
  'files:',
  ...a.files.concat(x.files).map((f) => `  - url: ${f.url}\n    sha512: ${f.sha512}\n    size: ${f.size}`),
  `path: ${a.path}`,
  `sha512: ${a.sha512}`,
  `releaseDate: ${a.releaseDate || x.releaseDate}`
].join('\n') + '\n'

fs.writeFileSync(outPath, merged, 'utf-8')
console.log('merged latest-mac.yml:', a.files.concat(x.files).map((f) => f.url).join(', '))
