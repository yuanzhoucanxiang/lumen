/* Generate the LUMEN app icon: build/icon.ico + browser-extension/icons/*.png
   Concept: a luminous L held inside overlapping media frames. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

function svg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="30" y1="18" x2="226" y2="238" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#17354a"/>
      <stop offset="0.5" stop-color="#0b1d2c"/>
      <stop offset="1" stop-color="#071019"/>
    </linearGradient>
    <radialGradient id="halo" cx="0" cy="0" r="1" gradientTransform="translate(181 69) rotate(132) scale(158)">
      <stop stop-color="#61c8ff" stop-opacity="0.34"/>
      <stop offset="0.58" stop-color="#2d93d1" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#071019" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="frame" x1="64" y1="68" x2="195" y2="202" gradientUnits="userSpaceOnUse">
      <stop stop-color="#c6efff"/>
      <stop offset="0.42" stop-color="#67c9ff"/>
      <stop offset="1" stop-color="#3498db"/>
    </linearGradient>
    <linearGradient id="edge" x1="76" y1="74" x2="183" y2="202" gradientUnits="userSpaceOnUse">
      <stop stop-color="#effaff"/>
      <stop offset="0.32" stop-color="#95dcff"/>
      <stop offset="1" stop-color="#4eafe9"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
  </defs>

  <!-- One clipped corner echoes LUMEN's interface controls. -->
  <path d="M44 8H202L248 54V212C248 231.9 231.9 248 212 248H44C24.1 248 8 231.9 8 212V44C8 24.1 24.1 8 44 8Z" fill="url(#bg)"/>
  <path d="M44 8H202L248 54V212C248 231.9 231.9 248 212 248H44C24.1 248 8 231.9 8 212V44C8 24.1 24.1 8 44 8Z" fill="url(#halo)"/>
  <path d="M203 9L247 53H218C209.7 53 203 46.3 203 38V9Z" fill="#4db4ed" opacity="0.18"/>

  <!-- Offset outlines read as a library of visual assets. -->
  <path d="M91 49H178L207 78V164" fill="none" stroke="#63bce9" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" opacity="0.24"/>
  <path d="M72 65H164L193 94V183" fill="none" stroke="#78cdf6" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.42"/>

  <!-- Primary media frame and custom, font-independent L monogram. -->
  <path d="M56 79C56 71.3 62.3 65 70 65H151L190 104V190C190 197.7 183.7 204 176 204H70C62.3 204 56 197.7 56 190V79Z" fill="#0a1722" fill-opacity="0.8" stroke="url(#frame)" stroke-width="11" stroke-linejoin="round"/>
  <path d="M151 66V91C151 98.2 156.8 104 164 104H189" fill="none" stroke="#aee7ff" stroke-width="10" stroke-linejoin="round"/>
  <path d="M84 91V171C84 177.6 89.4 183 96 183H160" fill="none" stroke="url(#edge)" stroke-width="25" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- The light source makes the mark read as LUMEN, not just an initial. -->
  <circle cx="161" cy="88" r="19" fill="#55c7ff" opacity="0.34" filter="url(#glow)"/>
  <circle cx="161" cy="88" r="7" fill="#f1fbff"/>
  <path d="M161 72V77M161 99V104M145 88H150M172 88H177" stroke="#c7f0ff" stroke-width="4" stroke-linecap="round"/>

  <!-- Subtle base highlight preserves definition on dark taskbars. -->
  <path d="M47 229H174" stroke="#49aee8" stroke-width="3" stroke-linecap="round" opacity="0.34"/>
</svg>`
}

async function main() {
  const buildDir = path.join(__dirname, '..', 'build')
  const extIconDir = path.join(__dirname, '..', 'browser-extension', 'icons')
  fs.mkdirSync(buildDir, { recursive: true })
  fs.mkdirSync(extIconDir, { recursive: true })

  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = []
  for (const size of sizes) {
    const buffer = await sharp(Buffer.from(svg(size))).png().toBuffer()
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
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs.map((icon) => icon.buffer)]))
  console.log('icons generated:', fs.readdirSync(buildDir).join(', '))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
