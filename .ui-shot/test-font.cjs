/* 字体样张管线自测（与 importer.ts renderFontThumb 同逻辑） */
const fontkit = require('fontkit')
const sharp = require('sharp')
const fs = require('fs')

async function renderFontThumb(filePath) {
  const opened = fontkit.openSync(filePath)
  const font = 'fonts' in opened ? opened.fonts[0] : opened
  const upm = font.unitsPerEm || 1000
  const hasCjk = font.hasGlyphForCodePoint(0x66f8)
  const sample = hasCjk ? '拾光 Aa 123' : 'Aa Bb Rr 123'

  const W = 512
  const H = 256
  const marginX = 32
  const glyphs = [...font.glyphsForString(sample)]

  let fontSize = 96
  let scale = fontSize / upm
  const spacing = () => fontSize * 0.06
  let totalAdv = 0
  for (const g of glyphs) totalAdv += g.advanceWidth * scale + spacing()
  const maxW = W - marginX * 2
  if (totalAdv > maxW) {
    fontSize = Math.max(36, Math.floor(fontSize * (maxW / totalAdv)))
    scale = fontSize / upm
  }

  const baseline = 170
  let x = marginX
  const paths = []
  for (const glyph of glyphs) {
    const adv = glyph.advanceWidth * scale
    if (glyph.path.commands.length > 0) {
      paths.push(
        `<path d="${glyph.path.toSVG()}" fill="#d5dbe2" transform="translate(${x.toFixed(1)},${baseline.toFixed(1)}) scale(${scale.toFixed(4)},${(-scale).toFixed(4)})"/>`
      )
    }
    x += adv + spacing()
  }
  const family = font.fullName ?? font.familyName ?? ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#0d0f12"/>
    <text x="${marginX}" y="32" font-family="sans-serif" font-size="16" fill="#57626d">${family}</text>
    ${paths.join('\n')}
  </svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer()
}

async function main() {
  for (const [name, path] of [
    ['msyh.ttc', 'C:/Windows/Fonts/msyh.ttc'],
    ['arial.ttf', 'C:/Windows/Fonts/arial.ttf']
  ]) {
    const buf = await renderFontThumb(path)
    fs.writeFileSync(`.ui-shot/font-${name}.jpg`, buf)
    console.log(name, 'OK', buf.length, 'bytes')
  }
}

main().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
