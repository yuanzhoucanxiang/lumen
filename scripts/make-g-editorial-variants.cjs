/* G direction calibration: editorial paper, black geometric mark, vermilion light.
   Generates six non-destructive SVG/PNG variants and a comparison board. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'design-proposals', 'icon-g-editorial-exploration')
const IVORY = '#f3efe6'
const INK = '#111317'
const RED = '#ef392f'

const paperDefs = `
  <linearGradient id="paper" x1="58" y1="28" x2="465" y2="490" gradientUnits="userSpaceOnUse"><stop stop-color="#fbf8f1"/><stop offset="0.55" stop-color="${IVORY}"/><stop offset="1" stop-color="#ded6c9"/></linearGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="m"/><feComponentTransfer in="m"><feFuncA type="table" tableValues="0 0.032"/></feComponentTransfer></filter>
  <filter id="press" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="1.8" flood-color="#ffffff" flood-opacity="0.5"/><feDropShadow dx="0" dy="-1" stdDeviation="1.5" flood-color="#605a51" flood-opacity="0.16"/></filter>`

function doc(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs>${defs}</defs>${body}</svg>`
}

function paperShell(radius = 78) {
  return `<rect x="16" y="16" width="480" height="480" rx="${radius}" fill="url(#paper)"/><rect x="16" y="16" width="480" height="480" rx="${radius}" filter="url(#grain)" opacity="0.62"/>`
}

function g1RedIndex() {
  return doc(paperDefs, `
    ${paperShell()}
    <path d="M130 94H202V335H360V407H130V94Z" fill="${INK}"/>
    <circle cx="362" cy="139" r="48" fill="${RED}"/>
    <circle cx="362" cy="139" r="17" fill="${IVORY}"/>
    <path d="M102 438H410" stroke="${INK}" stroke-width="7"/>
    <path d="M102 438H191" stroke="${RED}" stroke-width="7"/>
    <path d="M410 96V174" stroke="${INK}" stroke-width="3" opacity="0.3"/>
  `)
}

function g2GridCut() {
  return doc(paperDefs, `
    ${paperShell(70)}
    <path d="M108 105H190V320H383V402H108V105Z" fill="${INK}"/>
    <path d="M149 105V402M108 146H190M108 320H383M338 320V402" stroke="#f4f0e7" stroke-width="7" opacity="0.94"/>
    <circle cx="361" cy="138" r="34" fill="${RED}"/>
    <path d="M361 87V111M361 165V189M310 138H334M388 138H412" stroke="${INK}" stroke-width="6"/>
    <path d="M91 433H421" stroke="${INK}" stroke-width="3" opacity="0.34"/>
    <rect x="91" y="423" width="8" height="20" fill="${RED}"/>
  `)
}

function g3NightEdition() {
  return doc(`
    <linearGradient id="night" x1="50" y1="28" x2="462" y2="488" gradientUnits="userSpaceOnUse"><stop stop-color="#232429"/><stop offset="0.5" stop-color="#111216"/><stop offset="1" stop-color="#07080a"/></linearGradient>
    <filter id="darkGrain"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="2" seed="11" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="m"/><feComponentTransfer in="m"><feFuncA type="table" tableValues="0 0.045"/></feComponentTransfer></filter>`, `
    <rect x="16" y="16" width="480" height="480" rx="78" fill="url(#night)"/>
    <rect x="16" y="16" width="480" height="480" rx="78" filter="url(#darkGrain)" opacity="0.44"/>
    <path d="M130 95H201V336H360V407H130V95Z" fill="#f4efe5"/>
    <circle cx="361" cy="139" r="47" fill="${RED}"/>
    <circle cx="361" cy="139" r="17" fill="#111216"/>
    <path d="M101 439H410" stroke="#f4efe5" stroke-width="7"/>
    <path d="M321 439H410" stroke="${RED}" stroke-width="7"/>
    <path d="M101 80H167" stroke="#f4efe5" stroke-opacity="0.23" stroke-width="3"/>
  `)
}

function g4DieCut() {
  return doc(paperDefs, `
    ${paperShell(88)}
    <rect x="91" y="79" width="330" height="354" rx="6" fill="${INK}"/>
    <path d="M147 126H213V324H345V382H147V126Z" fill="${IVORY}" filter="url(#press)"/>
    <circle cx="348" cy="145" r="43" fill="${RED}"/>
    <path d="M348 118V172M321 145H375" stroke="${INK}" stroke-width="10" stroke-linecap="square"/>
    <path d="M91 433L421 79" stroke="${RED}" stroke-width="5" opacity="0.88"/>
    <circle cx="91" cy="433" r="9" fill="${RED}"/>
  `)
}

function g5Condensed() {
  return doc(paperDefs, `
    ${paperShell(64)}
    <path d="M163 78H215V351H354V403H163V78Z" fill="${INK}"/>
    <circle cx="328" cy="143" r="29" fill="${RED}"/>
    <path d="M375 78V403" stroke="${INK}" stroke-width="4"/>
    <path d="M390 78V278" stroke="${RED}" stroke-width="10"/>
    <path d="M91 435H144M163 435H215M234 435H286M305 435H357M376 435H421" stroke="${INK}" stroke-width="5"/>
  `)
}

function g6PublisherSeal() {
  return doc(`
    <linearGradient id="card" x1="52" y1="26" x2="469" y2="490" gradientUnits="userSpaceOnUse"><stop stop-color="#efe7d8"/><stop offset="0.55" stop-color="#ded2c0"/><stop offset="1" stop-color="#c9baa5"/></linearGradient>
    <filter id="sealGrain"><feTurbulence type="fractalNoise" baseFrequency="0.56" numOctaves="3" seed="19" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="m"/><feComponentTransfer in="m"><feFuncA type="table" tableValues="0 0.05"/></feComponentTransfer></filter>`, `
    <rect x="16" y="16" width="480" height="480" rx="54" fill="url(#card)"/>
    <rect x="16" y="16" width="480" height="480" rx="54" filter="url(#sealGrain)" opacity="0.62"/>
    <path d="M105 92H393V420H105V92Z" fill="none" stroke="${INK}" stroke-width="8"/>
    <path d="M141 128H207V326H340V384H141V128Z" fill="${INK}"/>
    <circle cx="357" cy="148" r="62" fill="${RED}" opacity="0.96"/>
    <circle cx="357" cy="148" r="35" fill="none" stroke="#e8dfd1" stroke-width="5" opacity="0.78"/>
    <path d="M357 104V192M313 148H401" stroke="#e8dfd1" stroke-width="5" opacity="0.76"/>
    <path d="M105 420L181 344" stroke="${RED}" stroke-width="8"/>
  `)
}

const VARIANTS = [
  { id: 'G1', slug: 'red-index', name: '红点', note: '原始构图精修', svg: g1RedIndex() },
  { id: 'G2', slug: 'grid-cut', name: '切线', note: '网格切片与定位标', svg: g2GridCut() },
  { id: 'G3', slug: 'night-edition', name: '夜版', note: '反相油墨与暗色纸', svg: g3NightEdition() },
  { id: 'G4', slug: 'die-cut', name: '开窗', note: '黑色装帧与负形字标', svg: g4DieCut() },
  { id: 'G5', slug: 'condensed', name: '窄标', note: '高留白与精密索引', svg: g5Condensed() },
  { id: 'G6', slug: 'publisher-seal', name: '印章', note: '出版物边框与套印', svg: g6PublisherSeal() }
]

async function makeBoard(rendered) {
  const width = 1800
  const height = 1360
  const cardW = 540
  const cardH = 550
  const positions = [[60, 180], [630, 180], [1200, 180], [60, 765], [630, 765], [1200, 765]]
  const composites = []
  const labels = []
  rendered.forEach((item, index) => {
    const [x, y] = positions[index]
    composites.push({ input: item.large, left: x + 35, top: y + 35 })
    composites.push({ input: item.small, left: x + 426, top: y + 70 })
    labels.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="28" fill="#151a21" stroke="#272e37"/>`)
    labels.push(`<text x="${x + 35}" y="${y + 414}" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="35" font-weight="700">${item.id} · ${item.name}</text>`)
    labels.push(`<text x="${x + 35}" y="${y + 461}" fill="#9cabb6" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="22">${item.note}</text>`)
    labels.push(`<text x="${x + 458}" y="${y + 167}" fill="#687784" font-family="Segoe UI, sans-serif" font-size="16" text-anchor="middle">64 px</text>`)
  })
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="1800" height="1360" fill="#0c1015"/>
    <text x="60" y="68" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="31" font-weight="700" letter-spacing="6">LUMEN · G DIRECTION / CALIBRATION 03</text>
    <text x="60" y="108" fill="#71808d" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="20">固定：暖纸 / 黑墨 / 朱红光点 / 编辑网格　变量：正负形关系与字标密度</text>
    <text x="60" y="153" fill="#a5b1ba" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="18">LIGHT</text>
    <text x="1200" y="153" fill="#a5b1ba" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="18">DENSE</text>
    <path d="M126 147H1164" stroke="#303943" stroke-width="2"/><path d="M1258 147H1740" stroke="#303943" stroke-width="2"/>
    ${labels.join('')}
  </svg>`)
  await sharp({ create: { width, height, channels: 4, background: '#0c1015' } })
    .composite([{ input: overlay, left: 0, top: 0 }, ...composites])
    .png()
    .toFile(path.join(OUT, 'lumen-g-variants-comparison.png'))
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const rendered = []
  for (const variant of VARIANTS) {
    const stem = `${variant.id.toLowerCase()}-${variant.slug}`
    const svgPath = path.join(OUT, `${stem}.svg`)
    const pngPath = path.join(OUT, `${stem}.png`)
    fs.writeFileSync(svgPath, variant.svg)
    await sharp(Buffer.from(variant.svg)).png().toFile(pngPath)
    rendered.push({
      ...variant,
      large: await sharp(pngPath).resize(340, 340).png().toBuffer(),
      small: await sharp(pngPath).resize(64, 64).png().toBuffer()
    })
  }
  await makeBoard(rendered)
  console.log(`generated ${VARIANTS.length} G-direction variants in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
