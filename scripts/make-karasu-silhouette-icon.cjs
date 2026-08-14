/* Original app-icon study translating the high-contrast, grainy isolation of Karasu into vector geometry. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'design-proposals', 'icon-karasu-silhouette')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <clipPath id="tile"><rect x="16" y="16" width="480" height="480" rx="78"/></clipPath>
    <linearGradient id="silver" x1="64" y1="36" x2="454" y2="486" gradientUnits="userSpaceOnUse">
      <stop stop-color="#d8d4cb"/>
      <stop offset="0.38" stop-color="#b7b5b1"/>
      <stop offset="0.72" stop-color="#888b8f"/>
      <stop offset="1" stop-color="#66696d"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0" cy="0" r="1" gradientTransform="translate(250 220) rotate(90) scale(320)">
      <stop offset="0.5" stop-color="#111317" stop-opacity="0"/>
      <stop offset="1" stop-color="#111317" stop-opacity="0.28"/>
    </radialGradient>
    <linearGradient id="ravenInk" x1="160" y1="145" x2="410" y2="448" gradientUnits="userSpaceOnUse">
      <stop stop-color="#08090b"/>
      <stop offset="0.55" stop-color="#101216"/>
      <stop offset="1" stop-color="#030405"/>
    </linearGradient>
    <filter id="photoGrain" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.52" numOctaves="3" seed="83" result="noise"/>
      <feColorMatrix in="noise" type="saturate" values="0" result="mono"/>
      <feComponentTransfer in="mono"><feFuncA type="table" tableValues="0 0.13"/></feComponentTransfer>
    </filter>
    <filter id="roughEdge" x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="19" result="warp"/>
      <feDisplacementMap in="SourceGraphic" in2="warp" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>

  <rect x="16" y="16" width="480" height="480" rx="78" fill="url(#silver)"/>
  <g clip-path="url(#tile)">
    <rect x="16" y="16" width="480" height="480" fill="url(#vignette)"/>
    <path d="M73 207C113 187 151 175 184 168C201 145 228 135 259 141C311 150 355 184 380 226C402 263 406 308 391 349L448 438L352 391L327 458L292 378C255 374 227 356 208 327C188 296 184 258 195 222C158 216 116 211 73 207Z" fill="url(#ravenInk)" filter="url(#roughEdge)"/>
    <path d="M264 225C314 239 350 273 366 320C345 297 317 281 286 274C313 313 323 352 317 397C292 359 270 316 264 225Z" fill="#25282d" opacity="0.48"/>
    <circle cx="231" cy="178" r="25" fill="#ef3b31"/>
    <circle cx="231" cy="178" r="9" fill="#090a0c"/>
    <circle cx="224" cy="171" r="3.5" fill="#efe9de" opacity="0.74"/>
    <rect x="16" y="16" width="480" height="480" filter="url(#photoGrain)" opacity="0.72"/>
  </g>
</svg>`

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const svgPath = path.join(OUT, 'karasu-k1-frozen-raven.svg')
  const pngPath = path.join(OUT, 'karasu-k1-frozen-raven.png')
  const smallPath = path.join(OUT, 'karasu-k1-frozen-raven-64.png')
  fs.writeFileSync(svgPath, svg)
  await sharp(Buffer.from(svg)).png().toFile(pngPath)
  await sharp(pngPath).resize(64, 64).png().toFile(smallPath)

  const large = await sharp(pngPath).resize(400, 400).png().toBuffer()
  const small = await sharp(pngPath).resize(128, 128).png().toBuffer()
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="650">
    <rect width="1100" height="650" fill="#0c1015"/>
    <text x="50" y="60" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="29" font-weight="700" letter-spacing="5">K1 · FROZEN RAVEN</text>
    <text x="50" y="98" fill="#7e8a94" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">原创转译：孤立剪影、高反差银盐灰、粗颗粒与偏心构图</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="440" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="80" y="565" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="28" font-weight="700">主图标 · 512px</text>
    <text x="650" y="360" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="27" font-weight="700">小尺寸预览 · 128px</text>
    <text x="650" y="400" fill="#8998a4" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="17">剪影不依赖细线，红眼保留品牌锚点</text>
    <text x="80" y="595" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="16">HIGH CONTRAST / GRAIN / SOLITUDE</text>
  </svg>`)
  await sharp({ create: { width: 1100, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: large, left: 100, top: 150 },
      { input: small, left: 760, top: 175 }
    ])
    .png()
    .toFile(path.join(OUT, 'karasu-k1-preview-board.png'))

  console.log(`generated Karasu K1 icon in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
