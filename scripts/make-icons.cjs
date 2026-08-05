/* 生成应用图标：build/icon.ico + browser-extension/icons/*.png
   风格：蓝黑终端底 + 几何「L_」（LUMEN 首字母 + 终端光标）+ 故障切片 */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const FONT = 'Segoe UI'

function svg(size) {
  const u = size / 256 // 以 256 为基准缩放
  const step = 26 * u // 像素阶梯角
  const border = Math.max(1.5, 3 * u)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#10141b"/>
      <stop offset="1" stop-color="#07090d"/>
    </linearGradient>
    <linearGradient id="ice" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#77c4f5"/>
      <stop offset="1" stop-color="#4da9e9"/>
    </linearGradient>
  </defs>
  <!-- 像素阶梯角外框 -->
  <path d="M ${step} 0 L ${size - step} 0 L ${size - step / 2} ${step / 2} L ${size} ${step / 2} L ${size} ${step} L ${size} ${size - step} L ${size - step / 2} ${size - step / 2} L ${size - step / 2} ${size} L ${size - step} ${size} L ${step} ${size} L ${step / 2} ${size - step / 2} L 0 ${size - step / 2} L 0 ${size - step} L 0 ${step} L ${step / 2} ${step / 2} L ${step / 2} 0 Z" fill="url(#bg)"/>
  <!-- 顶部一道冰蓝光 -->
  <rect x="${size * 0.18}" y="${size * 0.09}" width="${size * 0.64}" height="${border}" fill="#4da9e9" opacity="0.9"/>
  <!-- 故障切片：红/青两层错位 -->
  <text x="${size * 0.42 - 2.5 * u}" y="${size * 0.56}" font-family="${FONT}" font-size="${size * 0.6}" font-weight="600"
        fill="#d8566e" opacity="0.5" text-anchor="middle" dominant-baseline="middle">L</text>
  <text x="${size * 0.42 + 2.5 * u}" y="${size * 0.56}" font-family="${FONT}" font-size="${size * 0.6}" font-weight="600"
        fill="#4da9e9" opacity="0.5" text-anchor="middle" dominant-baseline="middle">L</text>
  <!-- 主字母 L -->
  <text x="${size * 0.42}" y="${size * 0.56}" font-family="${FONT}" font-size="${size * 0.6}" font-weight="600"
        fill="url(#ice)" text-anchor="middle" dominant-baseline="middle">L</text>
  <!-- 终端光标 -->
  <rect x="${size * 0.585}" y="${size * 0.665}" width="${size * 0.115}" height="${size * 0.045}" fill="url(#ice)"/>
  <!-- 底部像素点 -->
  <rect x="${size * 0.5 - 10 * u}" y="${size * 0.87}" width="${5 * u}" height="${5 * u}" fill="#4da9e9"/>
  <rect x="${size * 0.5 - 2 * u}" y="${size * 0.87}" width="${5 * u}" height="${5 * u}" fill="#2b7ab8"/>
  <rect x="${size * 0.5 + 6 * u}" y="${size * 0.87}" width="${5 * u}" height="${5 * u}" fill="#1a4a70"/>
</svg>`
}

async function main() {
  const buildDir = path.join(__dirname, '..', 'build')
  const extIconDir = path.join(__dirname, '..', 'browser-extension', 'icons')
  fs.mkdirSync(buildDir, { recursive: true })
  fs.mkdirSync(extIconDir, { recursive: true })

  // 各尺寸 PNG
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = []
  for (const s of sizes) {
    const buf = await sharp(Buffer.from(svg(s))).png().toBuffer()
    pngs.push({ size: s, buf })
    if ([16, 48, 128].includes(s)) {
      fs.writeFileSync(path.join(extIconDir, `icon${s}.png`), buf)
    }
  }
  fs.writeFileSync(path.join(buildDir, 'icon.png'), pngs.find((p) => p.size === 256).buf)

  // 手工打包 ICO（PNG 压缩格式，Windows Vista+ 支持）
  const n = pngs.length
  const headerSize = 6 + n * 16
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // 保留
  header.writeUInt16LE(1, 2) // ICO 类型
  header.writeUInt16LE(n, 4)
  const entries = []
  let offset = headerSize
  for (const p of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 0)
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 1)
    e.writeUInt16LE(1, 4) // 颜色平面
    e.writeUInt16LE(32, 6) // 位深
    e.writeUInt32LE(p.buf.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += p.buf.length
  }
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]))
  console.log('icons generated:', fs.readdirSync(buildDir).join(', '))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
