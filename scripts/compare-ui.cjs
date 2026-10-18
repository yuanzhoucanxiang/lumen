/* 视觉基线对比（里程碑 200）
   用法：node scripts/compare-ui.cjs <baselineDir> <currentDir> [--threshold 0.02]
   按像素通道计算归一化平均绝对差；尺寸不一致直接失败。依赖 sharp（项目已有）。 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const baselineDir = process.argv[2]
const currentDir = process.argv[3]
const thresholdArg = process.argv.indexOf('--threshold')
const threshold = thresholdArg >= 0 ? Number(process.argv[thresholdArg + 1]) : 0.02

if (!baselineDir || !currentDir) {
  console.error('用法: node scripts/compare-ui.cjs <baselineDir> <currentDir> [--threshold 0.02]')
  process.exit(2)
}

const listPng = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort() : []

async function raw(file) {
  const image = sharp(file).ensureAlpha()
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

async function main() {
  const baseFiles = listPng(baselineDir)
  const currentFiles = listPng(currentDir)
  if (baseFiles.length === 0) {
    console.error('基线目录没有 PNG:', baselineDir)
    process.exit(2)
  }
  const missing = baseFiles.filter((f) => !currentFiles.includes(f))
  const extra = currentFiles.filter((f) => !baseFiles.includes(f))
  if (missing.length) console.log('缺少截图:', missing.join(', '))
  if (extra.length) console.log('新增截图（未对比）:', extra.join(', '))

  let failed = 0
  let max = 0
  for (const file of baseFiles.filter((f) => currentFiles.includes(f))) {
    const a = await raw(path.join(baselineDir, file))
    const b = await raw(path.join(currentDir, file))
    if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
      console.log('  FAIL', file, `尺寸不一致 ${a.width}x${a.height} vs ${b.width}x${b.height}`)
      failed++
      continue
    }
    let sum = 0
    const len = a.data.length
    for (let i = 0; i < len; i++) sum += Math.abs(a.data[i] - b.data[i])
    const diff = sum / len / 255
    max = Math.max(max, diff)
    const ok = diff <= threshold
    console.log(ok ? '  PASS' : '  FAIL', file, diff.toFixed(4))
    if (!ok) failed++
  }

  console.log(`\n阈值 ${threshold}；最大差异 ${max.toFixed(4)}；失败 ${failed} 张`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('COMPARE CRASH:', e.message)
  process.exit(1)
})
