/* G3-inspired frontal crow right-eye crop.
   No profile silhouette. The L survives only as negative-space structure. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'design-proposals', 'icon-g3-frontal-eye-exploration')
const IVORY = '#f2ede3'
const INK = '#101216'
const RED = '#ef3b31'
const GREY = '#7b7a77'

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

function eye(x, y, outer = 45, pupil = 16) {
  return `<circle cx="${x}" cy="${y}" r="${outer}" fill="${RED}"/><circle cx="${x}" cy="${y}" r="${pupil}" fill="${INK}"/><circle cx="${x - 8}" cy="${y - 9}" r="5" fill="${IVORY}" opacity="0.72"/>`
}

function e1Axis() {
  return doc(`
    ${shell()}
    <path d="M168 92H229L256 185L224 418H148L168 92Z" fill="${IVORY}"/>
    <path d="M222 119C278 85 368 87 425 143" fill="none" stroke="${IVORY}" stroke-width="20" stroke-linecap="round"/>
    <path d="M222 418H395" stroke="${IVORY}" stroke-width="25" stroke-linecap="square"/>
    <path d="M256 185L224 418H287" fill="${GREY}" opacity="0.28"/>
    ${eye(345, 164, 43, 15)}
    <path d="M105 448H407" stroke="${IVORY}" stroke-opacity="0.34" stroke-width="5"/>
  `)
}

function e2Brow() {
  return doc(`
    ${shell()}
    <path d="M150 104L221 91L258 177L229 420H145L150 104Z" fill="${IVORY}"/>
    <path d="M216 112C274 74 375 84 438 153L397 201C356 168 302 159 250 184L216 112Z" fill="${IVORY}"/>
    <path d="M264 255H417V321H237L264 255Z" fill="${IVORY}" opacity="0.82"/>
    <path d="M250 184L237 321H289" fill="${GREY}" opacity="0.32"/>
    ${eye(352, 166, 44, 16)}
    <path d="M104 448H409" stroke="${IVORY}" stroke-width="5"/><path d="M348 448H409" stroke="${RED}" stroke-width="5"/>
  `)
}

function e3Facet() {
  return doc(`
    ${shell()}
    <path d="M135 82H231L273 197L224 432H135V82Z" fill="${IVORY}"/>
    <path d="M231 82H425V144L364 229L273 197L231 82Z" fill="#ddd8cf"/>
    <path d="M273 197L364 229L417 412H224L273 197Z" fill="#5e6064" opacity="0.45"/>
    <path d="M273 197L224 432H315" fill="${INK}" opacity="0.56"/>
    ${eye(348, 162, 47, 17)}
    <path d="M103 449H407" stroke="${IVORY}" stroke-opacity="0.32" stroke-width="4"/>
  `)
}

function e4GazeCrop() {
  return doc(`
    ${shell()}
    <path d="M144 86H210L252 205L217 424H141L144 86Z" fill="${IVORY}"/>
    <path d="M208 111C289 55 407 81 478 164" fill="none" stroke="${IVORY}" stroke-width="27" stroke-linecap="round"/>
    <circle cx="402" cy="181" r="78" fill="${RED}"/>
    <circle cx="402" cy="181" r="29" fill="${INK}"/>
    <circle cx="386" cy="165" r="8" fill="${IVORY}" opacity="0.74"/>
    <path d="M247 296H476" stroke="${IVORY}" stroke-width="31"/>
    <path d="M251 205L217 424H286" fill="${GREY}" opacity="0.3"/>
    <path d="M104 450H394" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="5"/>
  `)
}

function e5HalfMask() {
  return doc(`
    ${shell()}
    <path d="M188 79C321 61 438 130 462 250C477 330 438 400 351 436H213L245 300L188 79Z" fill="${IVORY}"/>
    <path d="M245 300L213 436H300L339 322L245 300Z" fill="#8c8a85" opacity="0.48"/>
    <path d="M231 106C284 91 362 104 421 158L373 224C329 196 286 190 245 207L231 106Z" fill="${INK}"/>
    <path d="M245 207L339 322H452C461 294 464 267 462 250C455 214 442 184 421 158L373 224L245 207Z" fill="${INK}" opacity="0.88"/>
    ${eye(355, 167, 45, 16)}
    <path d="M111 448H402" stroke="${IVORY}" stroke-opacity="0.34" stroke-width="5"/>
  `)
}

function e6HiddenMark() {
  return doc(`
    ${shell()}
    <path d="M130 91H202L247 198L215 421H130V91Z" fill="${IVORY}"/>
    <path d="M202 91H427L390 160H247L202 91Z" fill="${IVORY}"/>
    <path d="M247 198H430V271H276L247 198Z" fill="#d8d3ca"/>
    <path d="M247 198L215 421H314" fill="${GREY}" opacity="0.38"/>
    <circle cx="357" cy="159" r="48" fill="${RED}"/>
    <circle cx="365" cy="164" r="17" fill="${INK}"/>
    <circle cx="349" cy="146" r="5" fill="${IVORY}" opacity="0.72"/>
    <path d="M104 449H407" stroke="${IVORY}" stroke-width="5"/><path d="M104 449H171" stroke="${RED}" stroke-width="5"/>
  `)
}

const VARIANTS = [
  { id: 'E1', slug: 'axis', name: '视轴', note: '喙根纵轴 + 眼上弧线', svg: e1Axis() },
  { id: 'E2', slug: 'brow', name: '眉骨', note: '右眼窝与眼下切面', svg: e2Brow() },
  { id: 'E3', slug: 'facet', name: '断面', note: '正面羽区的几何分面', svg: e3Facet() },
  { id: 'E4', slug: 'gaze-crop', name: '凝视', note: '极近右眼裁切', svg: e4GazeCrop() },
  { id: 'E5', slug: 'half-mask', name: '半面', note: '正脸右半区的面具化', svg: e5HalfMask() },
  { id: 'E6', slug: 'hidden-mark', name: '暗字', note: 'L 完全溶入结构负形', svg: e6HiddenMark() }
]

async function makeBoard(rendered) {
  const width = 1800
  const height = 1360
  const positions = [[60, 180], [630, 180], [1200, 180], [60, 765], [630, 765], [1200, 765]]
  const composites = []
  const labels = []
  rendered.forEach((item, index) => {
    const [x, y] = positions[index]
    composites.push({ input: item.large, left: x + 35, top: y + 35 })
    composites.push({ input: item.small, left: x + 426, top: y + 70 })
    labels.push(`<rect x="${x}" y="${y}" width="540" height="550" rx="28" fill="#151a21" stroke="#272e37"/>`)
    labels.push(`<text x="${x + 35}" y="${y + 414}" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="35" font-weight="700">${item.id} · ${item.name}</text>`)
    labels.push(`<text x="${x + 35}" y="${y + 461}" fill="#9dabb6" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="22">${item.note}</text>`)
    labels.push(`<text x="${x + 458}" y="${y + 167}" fill="#697985" font-family="Segoe UI, sans-serif" font-size="15" text-anchor="middle">64 px</text>`)
  })
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1360">
    <rect width="1800" height="1360" fill="#0c1015"/>
    <text x="60" y="68" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="31" font-weight="700" letter-spacing="6">LUMEN · FRONTAL RIGHT-EYE CROP / CALIBRATION 05</text>
    <text x="60" y="108" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="20">G3 仅作为气质来源：正脸 / 画面右眼 / 极近局部 / L 进入负形结构</text>
    <text x="60" y="154" fill="#a4afb8" font-family="Segoe UI, sans-serif" font-size="17" letter-spacing="4">STRUCTURE</text>
    <path d="M205 148H1593" stroke="#34404a" stroke-width="2"/>
    <text x="1620" y="154" fill="#a4afb8" font-family="Segoe UI, sans-serif" font-size="17" letter-spacing="4">GAZE</text>
    ${labels.join('')}
  </svg>`)
  await sharp({ create: { width: 1800, height: 1360, channels: 4, background: '#0c1015' } })
    .composite([{ input: overlay, left: 0, top: 0 }, ...composites])
    .png()
    .toFile(path.join(OUT, 'lumen-frontal-eye-comparison.png'))
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
  console.log(`generated ${VARIANTS.length} frontal-eye variants in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
