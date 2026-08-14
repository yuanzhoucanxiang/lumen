/* G3 + crow calibration: from monogram-first to animal-first.
   Keeps the night-paper, ivory ink, and vermilion eye DNA. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'design-proposals', 'icon-g3-crow-exploration')
const IVORY = '#f3eee4'
const INK = '#101216'
const RED = '#ef3b31'

const nightDefs = `
  <linearGradient id="night" x1="46" y1="25" x2="468" y2="491" gradientUnits="userSpaceOnUse"><stop stop-color="#26282d"/><stop offset="0.48" stop-color="#121419"/><stop offset="1" stop-color="#07080b"/></linearGradient>
  <radialGradient id="sheen" cx="0" cy="0" r="1" gradientTransform="translate(181 99) rotate(48) scale(386)"><stop stop-color="#ffffff" stop-opacity="0.07"/><stop offset="0.58" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="2" seed="23" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="m"/><feComponentTransfer in="m"><feFuncA type="table" tableValues="0 0.04"/></feComponentTransfer></filter>`

function doc(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs>${defs}</defs>${body}</svg>`
}

function shell() {
  return `<rect x="16" y="16" width="480" height="480" rx="78" fill="url(#night)"/><rect x="16" y="16" width="480" height="480" rx="78" fill="url(#sheen)"/><rect x="16" y="16" width="480" height="480" rx="78" filter="url(#grain)" opacity="0.46"/>`
}

function c1Latent() {
  return doc(nightDefs, `
    ${shell()}
    <path d="M128 96H201V318C201 330 211 340 223 340H329L407 374L329 408H128V96Z" fill="${IVORY}"/>
    <path d="M190 119C237 94 306 103 340 139" fill="none" stroke="${IVORY}" stroke-width="15" stroke-linecap="round"/>
    <circle cx="340" cy="151" r="44" fill="${RED}"/>
    <circle cx="340" cy="151" r="15" fill="${INK}"/>
    <path d="M329 340L407 374L329 380" fill="${INK}" opacity="0.34"/>
    <path d="M102 438H410" stroke="${IVORY}" stroke-width="7"/><path d="M330 438H410" stroke="${RED}" stroke-width="7"/>
  `)
}

function c2BeakLine() {
  return doc(nightDefs, `
    ${shell()}
    <path d="M129 104H201V307C201 325 215 339 233 339H327L418 372L327 405H129V104Z" fill="${IVORY}"/>
    <path d="M190 121C240 91 313 99 350 139L424 202L352 233" fill="none" stroke="${IVORY}" stroke-width="21" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M351 177L424 202L352 211" fill="${INK}"/>
    <circle cx="328" cy="159" r="36" fill="${RED}"/>
    <circle cx="337" cy="155" r="12" fill="${INK}"/>
    <path d="M327 339L418 372L327 374" fill="${INK}" opacity="0.38"/>
    <path d="M103 438H409" stroke="${IVORY}" stroke-width="6"/><circle cx="409" cy="438" r="8" fill="${RED}"/>
  `)
}

function c3DoubleRead() {
  return doc(nightDefs, `
    ${shell()}
    <path d="M121 402V226C121 143 187 79 276 85C327 88 365 114 386 153L450 194L387 229C363 242 353 266 348 292C337 352 287 394 219 402H121Z" fill="${IVORY}"/>
    <path d="M184 168H242V302H340V360H184V168Z" fill="${INK}"/>
    <path d="M385 154L450 194L386 211" fill="${INK}" opacity="0.22"/>
    <circle cx="325" cy="154" r="40" fill="${RED}"/>
    <circle cx="334" cy="150" r="14" fill="${INK}"/>
    <path d="M110 438H403" stroke="${IVORY}" stroke-width="6"/><path d="M110 438H174" stroke="${RED}" stroke-width="6"/>
  `)
}

function c4Profile() {
  return doc(nightDefs, `
    ${shell()}
    <path d="M119 417L151 309C124 271 119 227 134 184C158 116 224 78 296 91C340 99 373 126 392 163L456 199L397 235C374 249 366 270 358 298C342 353 296 391 237 399L221 417H119Z" fill="${IVORY}"/>
    <path d="M392 163L456 199L398 216" fill="${INK}" opacity="0.28"/>
    <path d="M183 235V338C183 351 193 361 206 361H286" fill="none" stroke="${INK}" stroke-width="31" stroke-linecap="square" stroke-linejoin="miter"/>
    <circle cx="325" cy="161" r="37" fill="${RED}"/>
    <circle cx="335" cy="156" r="13" fill="${INK}"/>
    <path d="M100 438H412" stroke="${IVORY}" stroke-opacity="0.48" stroke-width="5"/>
  `)
}

function c5BlackFeather() {
  return doc(nightDefs, `
    ${shell()}
    <circle cx="256" cy="254" r="184" fill="${IVORY}"/>
    <path d="M132 405L161 306C137 271 133 231 146 191C167 129 226 94 291 105C332 112 363 136 380 170L439 203L384 236C363 249 356 269 349 294C335 345 293 379 238 387L224 405H132Z" fill="${INK}"/>
    <path d="M380 170L439 203L385 218" fill="${IVORY}" opacity="0.42"/>
    <path d="M185 248V329C185 342 195 352 208 352H273" fill="none" stroke="${IVORY}" stroke-width="24" stroke-linecap="square"/>
    <circle cx="318" cy="169" r="35" fill="${RED}"/>
    <circle cx="328" cy="164" r="12" fill="${INK}"/>
    <path d="M102 449H410" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="5"/>
  `)
}

const VARIANTS = [
  { id: 'C1', slug: 'latent-crow', name: '潜影', note: '字标优先 · 只改喙形', degree: '15%', svg: c1Latent() },
  { id: 'C2', slug: 'beak-line', name: '喙线', note: 'L 与头部轮廓相接', degree: '35%', svg: c2BeakLine() },
  { id: 'C3', slug: 'double-read', name: '双读', note: '乌鸦侧脸 + 负形 L', degree: '55%', svg: c3DoubleRead() },
  { id: 'C4', slug: 'profile', name: '侧影', note: '动物优先 · L 藏在颈部', degree: '75%', svg: c4Profile() },
  { id: 'C5', slug: 'black-feather', name: '黑羽', note: '印刷章式乌鸦头像', degree: '90%', svg: c5BlackFeather() }
]

async function makeBoard(rendered) {
  const width = 1900
  const height = 700
  const iconSize = 280
  const startX = 50
  const gap = 370
  const composites = []
  const labels = []
  rendered.forEach((item, index) => {
    const x = startX + index * gap
    composites.push({ input: item.large, left: x + 18, top: 158 })
    composites.push({ input: item.small, left: x + 286, top: 185 })
    labels.push(`<rect x="${x}" y="135" width="340" height="510" rx="28" fill="#151a21" stroke="#272e37"/>`)
    labels.push(`<text x="${x + 20}" y="493" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="32" font-weight="700">${item.id} · ${item.name}</text>`)
    labels.push(`<text x="${x + 20}" y="537" fill="#9dabb6" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="20">${item.note}</text>`)
    labels.push(`<text x="${x + 20}" y="579" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17" font-weight="700" letter-spacing="2">CROW ${item.degree}</text>`)
    labels.push(`<text x="${x + 310}" y="272" fill="#697985" font-family="Segoe UI, sans-serif" font-size="15" text-anchor="middle">64</text>`)
  })
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="1900" height="700" fill="#0c1015"/>
    <text x="50" y="60" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="31" font-weight="700" letter-spacing="6">LUMEN · G3 × CROW / CALIBRATION 04</text>
    <text x="50" y="101" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="20">保持 G3 黑纸 / 象牙白 / 朱红眼睛，仅测试乌鸦的显性程度</text>
    <text x="50" y="678" fill="#8e9aa4" font-family="Segoe UI, sans-serif" font-size="17" letter-spacing="4">MONOGRAM</text>
    <path d="M190 672H1710" stroke="#35404a" stroke-width="2"/><path d="M1696 663L1712 672L1696 681" fill="none" stroke="#35404a" stroke-width="2"/>
    <text x="1740" y="678" fill="#8e9aa4" font-family="Segoe UI, sans-serif" font-size="17" letter-spacing="4">CROW</text>
    ${labels.join('')}
  </svg>`)
  await sharp({ create: { width, height, channels: 4, background: '#0c1015' } })
    .composite([{ input: overlay, left: 0, top: 0 }, ...composites])
    .png()
    .toFile(path.join(OUT, 'lumen-g3-crow-comparison.png'))
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
  console.log(`generated ${VARIANTS.length} G3-crow variants in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
