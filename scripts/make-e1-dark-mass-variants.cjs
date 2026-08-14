/* E1 calibration: increase black visual mass while locking eye and frontal axis. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'design-proposals', 'icon-e1-dark-mass-exploration')
const IVORY = '#f2ede3'
const INK = '#101216'
const RED = '#ef3b31'

const defs = `
  <linearGradient id="night" x1="48" y1="24" x2="469" y2="491" gradientUnits="userSpaceOnUse"><stop stop-color="#292b30"/><stop offset="0.48" stop-color="#121419"/><stop offset="1" stop-color="#07080b"/></linearGradient>
  <radialGradient id="sheen" cx="0" cy="0" r="1" gradientTransform="translate(194 101) rotate(51) scale(390)"><stop stop-color="#ffffff" stop-opacity="0.07"/><stop offset="0.62" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="2" seed="29" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="m"/><feComponentTransfer in="m"><feFuncA type="table" tableValues="0 0.038"/></feComponentTransfer></filter>`

function doc(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs>${defs}</defs>${body}</svg>`
}

function shell() {
  return `<rect x="16" y="16" width="480" height="480" rx="78" fill="url(#night)"/><rect x="16" y="16" width="480" height="480" rx="78" fill="url(#sheen)"/><rect x="16" y="16" width="480" height="480" rx="78" filter="url(#grain)" opacity="0.48"/>`
}

function eye() {
  return `<circle cx="345" cy="164" r="43" fill="${RED}"/><circle cx="345" cy="164" r="15" fill="${INK}"/><circle cx="337" cy="155" r="5" fill="${IVORY}" opacity="0.72"/>`
}

function v0Baseline() {
  return doc(`
    ${shell()}
    <path d="M168 92H229L256 185L224 418H148L168 92Z" fill="${IVORY}"/>
    <path d="M222 119C278 85 368 87 425 143" fill="none" stroke="${IVORY}" stroke-width="20" stroke-linecap="round"/>
    <path d="M222 418H395" stroke="${IVORY}" stroke-width="25" stroke-linecap="square"/>
    <path d="M256 185L224 418H287" fill="#7b7a77" opacity="0.28"/>
    ${eye()}
    <path d="M105 448H407" stroke="${IVORY}" stroke-opacity="0.34" stroke-width="5"/>
  `)
}

function v1Narrow() {
  return doc(`
    ${shell()}
    <path d="M181 94H225L249 184L219 418H165L181 94Z" fill="${IVORY}"/>
    <path d="M222 120C279 89 366 91 422 143" fill="none" stroke="${IVORY}" stroke-width="15" stroke-linecap="round"/>
    <path d="M218 418H359" stroke="${IVORY}" stroke-width="18"/>
    <path d="M249 184L219 418H273" fill="#6e7074" opacity="0.34"/>
    ${eye()}
    <path d="M105 448H407" stroke="${IVORY}" stroke-opacity="0.25" stroke-width="4"/>
  `)
}

function v2BrokenLight() {
  return doc(`
    ${shell()}
    <path d="M190 96H219L241 181L215 418H176L190 96Z" fill="${IVORY}"/>
    <path d="M221 122C268 98 316 94 356 104" fill="none" stroke="${IVORY}" stroke-width="11" stroke-linecap="round"/>
    <path d="M374 111C391 119 406 130 419 143" fill="none" stroke="${IVORY}" stroke-width="11" stroke-linecap="round"/>
    <path d="M214 418H308" stroke="${IVORY}" stroke-width="12"/>
    <path d="M241 181L215 418H260" fill="#62656a" opacity="0.38"/>
    ${eye()}
    <path d="M106 448H406" stroke="#63666b" stroke-opacity="0.45" stroke-width="4"/>
  `)
}

function v3FeatherCut() {
  return doc(`
    ${shell()}
    <path d="M165 92H230L251 182L217 420H160L165 92Z" fill="#292c31"/>
    <path d="M205 96L225 182L202 418" fill="none" stroke="${IVORY}" stroke-width="13" stroke-linecap="square" stroke-linejoin="miter"/>
    <path d="M221 123C271 97 319 94 362 106" fill="none" stroke="${IVORY}" stroke-width="10" stroke-linecap="round"/>
    <path d="M382 114C396 122 408 132 419 143" fill="none" stroke="#c9c5bd" stroke-width="8" stroke-linecap="round"/>
    <path d="M202 418H270" stroke="${IVORY}" stroke-width="10"/>
    <path d="M251 182L217 420H278" fill="#3b3e43" opacity="0.6"/>
    ${eye()}
    <path d="M106 448H406" stroke="#5c6065" stroke-opacity="0.42" stroke-width="4"/>
  `)
}

function v4InkHold() {
  return doc(`
    ${shell()}
    <path d="M166 92H228L249 181L216 420H162L166 92Z" fill="#202328"/>
    <path d="M207 99L224 181L203 414" fill="none" stroke="#d7d2ca" stroke-width="7" stroke-linecap="square"/>
    <path d="M222 124C271 100 316 97 356 107" fill="none" stroke="#bcb9b2" stroke-width="7" stroke-linecap="round"/>
    <path d="M389 119C400 126 410 134 419 143" fill="none" stroke="${IVORY}" stroke-width="6" stroke-linecap="round"/>
    <path d="M203 418H248" stroke="#d7d2ca" stroke-width="7"/>
    <path d="M249 181L216 420H278" fill="#30343a" opacity="0.7"/>
    ${eye()}
    <path d="M106 448H346" stroke="#4e5258" stroke-opacity="0.4" stroke-width="4"/><path d="M346 448H406" stroke="${RED}" stroke-opacity="0.72" stroke-width="4"/>
  `)
}

const VARIANTS = [
  { id: 'E1-0', slug: 'baseline', name: '原版', note: '当前白色体量基准', level: 'BLACK 1/5', svg: v0Baseline() },
  { id: 'E1-A', slug: 'narrow', name: '收窄', note: '缩窄喙根与基线', level: 'BLACK 2/5', svg: v1Narrow() },
  { id: 'E1-B', slug: 'broken-light', name: '断光', note: '白色轮廓开始断开', level: 'BLACK 3/5', svg: v2BrokenLight() },
  { id: 'E1-C', slug: 'feather-cut', name: '羽切', note: '黑羽主体 + 白色羽缘', level: 'BLACK 4/5', svg: v3FeatherCut() },
  { id: 'E1-D', slug: 'ink-hold', name: '墨凝', note: '白色仅作局部高光', level: 'BLACK 5/5', svg: v4InkHold() }
]

async function makeBoard(rendered) {
  const width = 1900
  const height = 700
  const composites = []
  const labels = []
  rendered.forEach((item, index) => {
    const x = 50 + index * 370
    composites.push({ input: item.large, left: x + 18, top: 158 })
    composites.push({ input: item.small, left: x + 286, top: 185 })
    labels.push(`<rect x="${x}" y="135" width="340" height="510" rx="28" fill="#151a21" stroke="#272e37"/>`)
    labels.push(`<text x="${x + 20}" y="493" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">${item.id} · ${item.name}</text>`)
    labels.push(`<text x="${x + 20}" y="537" fill="#9dabb6" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">${item.note}</text>`)
    labels.push(`<text x="${x + 20}" y="579" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="16" font-weight="700" letter-spacing="2">${item.level}</text>`)
    labels.push(`<text x="${x + 310}" y="272" fill="#697985" font-family="Segoe UI, sans-serif" font-size="15" text-anchor="middle">64</text>`)
  })
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="700">
    <rect width="1900" height="700" fill="#0c1015"/>
    <text x="50" y="60" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="31" font-weight="700" letter-spacing="6">LUMEN · E1 BLACK-MASS CALIBRATION 06</text>
    <text x="50" y="101" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="20">锁定右眼、正面视轴和局部裁切，只逐级减少象牙白的面积</text>
    <text x="50" y="678" fill="#8e9aa4" font-family="Segoe UI, sans-serif" font-size="17" letter-spacing="4">LIGHT</text>
    <path d="M150 672H1715" stroke="#35404a" stroke-width="2"/><path d="M1701 663L1717 672L1701 681" fill="none" stroke="#35404a" stroke-width="2"/>
    <text x="1742" y="678" fill="#8e9aa4" font-family="Segoe UI, sans-serif" font-size="17" letter-spacing="4">DARK</text>
    ${labels.join('')}
  </svg>`)
  await sharp({ create: { width: 1900, height: 700, channels: 4, background: '#0c1015' } })
    .composite([{ input: overlay, left: 0, top: 0 }, ...composites])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-dark-mass-comparison.png'))
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
      large: await sharp(pngPath).resize(280, 280).png().toBuffer(),
      small: await sharp(pngPath).resize(64, 64).png().toBuffer()
    })
  }
  await makeBoard(rendered)
  console.log(`generated ${VARIANTS.length} E1 dark-mass variants in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
