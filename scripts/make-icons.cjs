/* Generate all LUMEN icons from the approved traced-raven SVG master. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

async function main() {
  const buildDir = path.join(__dirname, '..', 'build')
  const extIconDir = path.join(__dirname, '..', 'browser-extension', 'icons')
  const sourcePath = path.join(buildDir, 'raven-icon-source.svg')
  fs.mkdirSync(buildDir, { recursive: true })
  fs.mkdirSync(extIconDir, { recursive: true })

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing approved icon source: ${sourcePath}`)
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
  const pngs = []
  for (const size of sizes) {
    const buffer = await sharp(sourcePath, { density: 288 })
      .resize(size, size)
      .png()
      .toBuffer()
    pngs.push({ size, buffer })
    if ([16, 48, 128].includes(size)) {
      fs.writeFileSync(path.join(extIconDir, `icon${size}.png`), buffer)
    }
  }
  // mac 需要 512 底图(供 electron-builder 兜底转换);icns 在 macOS 上由 iconutil 生成
  fs.writeFileSync(path.join(buildDir, 'icon.png'), pngs.find((icon) => icon.size === 512).buffer)

  // macOS 专属:iconset + iconutil 打包 icns(仅 darwin;CI 的 mac runner 与本地 mac 均可用)
  if (process.platform === 'darwin') {
    const iconsetDir = path.join(buildDir, 'icon.iconset')
    fs.rmSync(iconsetDir, { recursive: true, force: true })
    fs.mkdirSync(iconsetDir, { recursive: true })
    const bySize = new Map(pngs.map((p) => [p.size, p.buffer]))
    const iconsetFiles = [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024]
    ]
    for (const [name, size] of iconsetFiles) {
      fs.writeFileSync(path.join(iconsetDir, name), bySize.get(size))
    }
    execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(buildDir, 'icon.icns')}"`, { stdio: 'inherit' })
    fs.rmSync(iconsetDir, { recursive: true, force: true })
  }

  // Package PNG frames into a Windows Vista+ ICO file (ICO 最大有效尺寸 256)。
  const icoPngs = pngs.filter((icon) => icon.size <= 256)
  const count = icoPngs.length
  const headerSize = 6 + count * 16
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = headerSize
  for (const icon of icoPngs) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(icon.size >= 256 ? 0 : icon.size, 0)
    entry.writeUInt8(icon.size >= 256 ? 0 : icon.size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(icon.buffer.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += icon.buffer.length
  }
  fs.writeFileSync(
    path.join(buildDir, 'icon.ico'),
    Buffer.concat([header, ...entries, ...icoPngs.map((icon) => icon.buffer)])
  )
  console.log('icons generated from raven-icon-source.svg:', fs.readdirSync(buildDir).join(', '))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
