/* Generate the LUMEN desktop and browser-extension icons directly from the approved raven photograph. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

async function main() {
  const buildDir = path.join(__dirname, '..', 'build')
  const extIconDir = path.join(__dirname, '..', 'browser-extension', 'icons')
  const sourcePath = path.join(buildDir, 'raven-icon-source.png')
  fs.mkdirSync(buildDir, { recursive: true })
  fs.mkdirSync(extIconDir, { recursive: true })

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing approved icon source: ${sourcePath}`)
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = []
  for (const size of sizes) {
    const buffer = await sharp(sourcePath)
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer()
    pngs.push({ size, buffer })
    if ([16, 48, 128].includes(size)) {
      fs.writeFileSync(path.join(extIconDir, `icon${size}.png`), buffer)
    }
  }
  fs.writeFileSync(path.join(buildDir, 'icon.png'), pngs.find((icon) => icon.size === 256).buffer)

  // Package PNG frames into a Windows Vista+ ICO file.
  const count = pngs.length
  const headerSize = 6 + count * 16
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = headerSize
  for (const icon of pngs) {
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
    Buffer.concat([header, ...entries, ...pngs.map((icon) => icon.buffer)])
  )
  console.log('icons generated from raven-icon-source.png:', fs.readdirSync(buildDir).join(', '))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
