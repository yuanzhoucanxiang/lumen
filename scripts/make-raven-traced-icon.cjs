const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'design-proposals', 'icon-raven-photo-vector')
const sourcePath = path.join(root, 'build', 'raven-icon-source.png')
const svgPath = path.join(outDir, 'raven-vector-traced-v1.svg')
const pngPath = path.join(outDir, 'raven-vector-traced-v1.png')
const smallPath = path.join(outDir, 'raven-vector-traced-v1-64.png')
const boardPath = path.join(outDir, 'raven-vector-traced-v1-comparison.png')
const clawPath = path.join(outDir, 'raven-vector-traced-v1-claw-detail.png')

const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

async function main() {
  const svg = fs.readFileSync(svgPath)
  const raster = await sharp(svg, { density: 288 }).resize(1024, 1024).png().toBuffer()
  await sharp(raster).toFile(pngPath)
  await sharp(svg, { density: 192 }).resize(64, 64).png().toFile(smallPath)

  const reference = await sharp(sourcePath)
    .resize(420, 420, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()
  const vector = await sharp(svg, { density: 192 }).resize(420, 420).png().toBuffer()
  const tiny = await sharp(svg, { density: 192 }).resize(64, 64).png().toBuffer()

  const boardSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720">
    <rect width="1200" height="720" fill="#0b0f13"/>
    <text x="54" y="64" fill="#f4f5f6" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="29" font-weight="700" letter-spacing="5">PHOTO CONTOUR → TRUE SVG</text>
    <text x="54" y="103" fill="#87929d" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="18">${esc('黑白分离后直接提取照片轮廓；只平滑像素毛刺，不重新设计比例')}</text>
    <rect x="50" y="138" width="520" height="520" rx="28" fill="#151b21" stroke="#2a323b"/>
    <rect x="630" y="138" width="520" height="520" rx="28" fill="#151b21" stroke="#2a323b"/>
    <text x="82" y="603" fill="#f2f4f5" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="27" font-weight="700">参考照片</text>
    <text x="662" y="603" fill="#f2f4f5" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="27" font-weight="700">忠实轮廓描摹版</text>
    <text x="82" y="635" fill="#8a96a2" font-family="Arial, sans-serif" font-size="15" letter-spacing="1">SOURCE / CROPPED</text>
    <text x="662" y="635" fill="#ff5149" font-family="Arial, sans-serif" font-size="15" letter-spacing="1">AUTO TRACE / PURE SVG</text>
    <text x="1027" y="633" fill="#8a96a2" font-family="Arial, sans-serif" font-size="13">64 px</text>
  </svg>`
  await sharp(Buffer.from(boardSvg)).composite([
    { input: reference, left: 100, top: 165 },
    { input: vector, left: 680, top: 165 },
    { input: tiny, left: 1025, top: 540 },
  ]).png().toFile(boardPath)

  const sourceClaw = await sharp(sourcePath)
    .extract({ left: 650, top: 320, width: 220, height: 430 })
    .resize(280, 440, { fit: 'contain', background: '#c4c5c6' }).png().toBuffer()
  const vectorClaw = await sharp(raster)
    .extract({ left: 720, top: 410, width: 270, height: 540 })
    .resize(280, 440, { fit: 'contain', background: '#c4c5c6' }).png().toBuffer()
  const clawSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="620">
    <rect width="920" height="620" fill="#0b0f13"/>
    <text x="50" y="60" fill="#f4f5f6" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="28" font-weight="700" letter-spacing="4">CLAW · CONTOUR TRACE</text>
    <text x="50" y="94" fill="#87929d" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="17">${esc('爪子轮廓直接来自照片阈值边界，不再用手工曲线猜测')}</text>
    <rect x="70" y="125" width="340" height="450" rx="22" fill="#151b21" stroke="#2a323b"/>
    <rect x="510" y="125" width="340" height="450" rx="22" fill="#151b21" stroke="#2a323b"/>
    <text x="100" y="557" fill="#f2f4f5" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="22" font-weight="700">参考照片局部</text>
    <text x="540" y="557" fill="#f2f4f5" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="22" font-weight="700">SVG 描摹局部</text>
  </svg>`
  await sharp(Buffer.from(clawSvg)).composite([
    { input: sourceClaw, left: 100, top: 135 },
    { input: vectorClaw, left: 540, top: 135 },
  ]).png().toFile(clawPath)

  process.stdout.write([svgPath, pngPath, smallPath, boardPath, clawPath].join('\n'))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
