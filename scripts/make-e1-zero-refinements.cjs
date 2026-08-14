/* E1-0 refinement: preserve the sculptural ivory plane, improve black negative space. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'design-proposals', 'icon-e1-zero-refinement')
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

function eye(x = 345, y = 164, radius = 43) {
  return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${RED}"/><circle cx="${x}" cy="${y}" r="15" fill="${INK}"/><circle cx="${x - 8}" cy="${y - 9}" r="5" fill="${IVORY}" opacity="0.72"/>`
}

function baseline() {
  return doc(`
    ${shell()}
    <path d="M168 92H229L256 185L224 418H148L168 92Z" fill="${IVORY}"/>
    <path d="M222 119C278 85 368 87 425 143" fill="none" stroke="${IVORY}" stroke-width="20" stroke-linecap="round"/>
    <path d="M222 418H395" stroke="${IVORY}" stroke-width="25"/>
    <path d="M256 185L224 418H287" fill="#7b7a77" opacity="0.28"/>
    ${eye()}
    <path d="M105 448H407" stroke="${IVORY}" stroke-opacity="0.34" stroke-width="5"/>
  `)
}

function proportion() {
  return doc(`
    ${shell()}
    <path d="M171 96H226L251 184L221 412H153L171 96Z" fill="${IVORY}"/>
    <path d="M222 121C281 87 369 91 421 143" fill="none" stroke="${IVORY}" stroke-width="18" stroke-linecap="round"/>
    <path d="M220 412H365" stroke="${IVORY}" stroke-width="22"/>
    <path d="M251 184L221 412H278" fill="#777773" opacity="0.31"/>
    ${eye(346, 163, 40)}
    <path d="M106 445H405" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="4"/>
  `)
}

function proportionLeft() {
  return doc(`
    ${shell()}
    <g transform="translate(-12 0)">
      <path d="M171 96H226L251 184L221 412H153L171 96Z" fill="${IVORY}"/>
      <path d="M222 121C281 87 369 91 421 143" fill="none" stroke="${IVORY}" stroke-width="18" stroke-linecap="round"/>
      <path d="M220 412H365" stroke="${IVORY}" stroke-width="22"/>
      <path d="M251 184L221 412H278" fill="#777773" opacity="0.31"/>
      ${eye(346, 163, 40)}
      <path d="M106 445H405" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="4"/>
    </g>
  `)
}

function innerCut() {
  return doc(`
    ${shell()}
    <path d="M167 94H229L254 184L223 416H149L167 94Z" fill="${IVORY}"/>
    <path d="M200 133L229 181L205 372H178L200 133Z" fill="${INK}" opacity="0.91"/>
    <path d="M222 120C278 87 367 90 423 143" fill="none" stroke="${IVORY}" stroke-width="19" stroke-linecap="round"/>
    <path d="M222 416H374" stroke="${IVORY}" stroke-width="22"/>
    <path d="M254 184L223 416H279" fill="#73746f" opacity="0.34"/>
    ${eye(346, 163, 40)}
    <path d="M105 446H407" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="4"/>
  `)
}

function eyeSocket() {
  return doc(`
    ${shell()}
    <path d="M168 94H228L253 183L222 416H150L168 94Z" fill="${IVORY}"/>
    <path d="M199 136L227 182L204 370H179L199 136Z" fill="${INK}" opacity="0.86"/>
    <path d="M221 121C279 87 365 89 421 140" fill="none" stroke="${IVORY}" stroke-width="20" stroke-linecap="round"/>
    <path d="M303 139C329 116 373 117 398 143C412 157 414 177 405 193C391 218 353 226 323 209" fill="none" stroke="#34363b" stroke-width="23" stroke-linecap="round"/>
    ${eye(351, 164, 39)}
    <path d="M221 416H367" stroke="${IVORY}" stroke-width="21"/>
    <path d="M253 183L222 416H278" fill="#74746f" opacity="0.34"/>
    <path d="M106 446H406" stroke="${IVORY}" stroke-opacity="0.25" stroke-width="4"/>
  `)
}

function synthesis() {
  return doc(`
    ${shell()}
    <path d="M169 95H227L252 183L221 414H151L169 95Z" fill="${IVORY}"/>
    <path d="M199 137L227 182L204 369H178L199 137Z" fill="${INK}" opacity="0.92"/>
    <path d="M221 121C280 88 365 91 418 141" fill="none" stroke="${IVORY}" stroke-width="18" stroke-linecap="round"/>
    <path d="M306 139C330 118 369 118 393 141C405 153 409 169 404 184" fill="none" stroke="#303238" stroke-width="17" stroke-linecap="round"/>
    ${eye(349, 163, 39)}
    <path d="M220 414H351" stroke="${IVORY}" stroke-width="20"/>
    <path d="M252 183L221 414H276" fill="#70716d" opacity="0.34"/>
    <path d="M106 446H342" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="4"/><path d="M342 446H406" stroke="${RED}" stroke-width="4"/>
  `)
}

const VARIANTS = [
  { id: 'E1-0', slug: 'baseline', name: '基准', note: '原始 E1-0', svg: baseline() },
  { id: 'E1-0A', slug: 'proportion', name: '比例', note: '收紧白面与底部长度', svg: proportion() },
  { id: 'E1-0B', slug: 'inner-cut', name: '内切', note: '白面内部切入黑羽', svg: innerCut() },
  { id: 'E1-0C', slug: 'eye-socket', name: '眼窝', note: '红眼嵌入眉骨结构', svg: eyeSocket() },
  { id: 'E1-0D', slug: 'synthesis', name: '综合', note: '比例、负形与眼窝合并', svg: synthesis() }
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
    labels.push(`<text x="${x + 20}" y="493" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="28" font-weight="700">${item.id} · ${item.name}</text>`)
    labels.push(`<text x="${x + 20}" y="537" fill="#9dabb6" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">${item.note}</text>`)
    labels.push(`<text x="${x + 310}" y="272" fill="#697985" font-family="Segoe UI, sans-serif" font-size="15" text-anchor="middle">64</text>`)
  })
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="700">
    <rect width="1900" height="700" fill="#0c1015"/>
    <text x="50" y="60" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="31" font-weight="700" letter-spacing="6">LUMEN · E1-0 REFINEMENT / CALIBRATION 07</text>
    <text x="50" y="101" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="20">保留雕塑感象牙白主体，通过比例、内部负形与眼窝连接增加黑色重量</text>
    <path d="M50 672H1850" stroke="#35404a" stroke-width="2"/>
    ${labels.join('')}
  </svg>`)
  await sharp({ create: { width: 1900, height: 700, channels: 4, background: '#0c1015' } })
    .composite([{ input: overlay, left: 0, top: 0 }, ...composites])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zero-refinement-comparison.png'))
}

async function makePositionBoard(original, shifted) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="650">
    <rect width="1160" height="650" fill="#0c1015"/>
    <text x="50" y="58" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · POSITION TEST</text>
    <text x="50" y="96" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">背景保持不动，前景整体左移 12px</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="82" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="30" font-weight="700">原始 E1-0A</text>
    <text x="642" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="30" font-weight="700">左移 12px</text>
    <text x="82" y="575" fill="#8998a4" font-family="Segoe UI, sans-serif" font-size="17">POSITION 0</text>
    <text x="642" y="575" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17">POSITION -12</text>
  </svg>`)
  await sharp({ create: { width: 1160, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: original, left: 130, top: 165 },
      { input: shifted, left: 690, top: 165 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-left-comparison.png'))
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
  const shiftedSvg = proportionLeft()
  const shiftedSvgPath = path.join(OUT, 'e1-0a-left-12.svg')
  const shiftedPngPath = path.join(OUT, 'e1-0a-left-12.png')
  fs.writeFileSync(shiftedSvgPath, shiftedSvg)
  await sharp(Buffer.from(shiftedSvg)).png().toFile(shiftedPngPath)
  const original = await sharp(path.join(OUT, 'e1-0a-proportion.png')).resize(360, 360).png().toBuffer()
  const shifted = await sharp(shiftedPngPath).resize(360, 360).png().toBuffer()
  await makePositionBoard(original, shifted)
  console.log(`generated ${VARIANTS.length} E1-0 refinements in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
