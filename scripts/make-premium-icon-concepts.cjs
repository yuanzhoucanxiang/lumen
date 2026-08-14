/* Round 2: premium LUMEN icon style calibration.
   Three art-direction hypotheses, two variants each. Non-destructive. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'design-proposals', 'icon-premium-round2')

function svg(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs>${defs}</defs>${body}</svg>`
}

function noirInlay() {
  return svg(`
    <linearGradient id="bg" x1="70" y1="40" x2="450" y2="478" gradientUnits="userSpaceOnUse"><stop stop-color="#2d3238"/><stop offset="0.42" stop-color="#15181c"/><stop offset="1" stop-color="#080a0d"/></linearGradient>
    <linearGradient id="metal" x1="132" y1="92" x2="374" y2="398" gradientUnits="userSpaceOnUse"><stop stop-color="#ffffff"/><stop offset="0.2" stop-color="#9fa8b1"/><stop offset="0.47" stop-color="#f6f8f9"/><stop offset="0.72" stop-color="#747e88"/><stop offset="1" stop-color="#d9e0e5"/></linearGradient>
    <radialGradient id="sheen" cx="0" cy="0" r="1" gradientTransform="translate(164 92) rotate(53) scale(370)"><stop stop-color="#ffffff" stop-opacity="0.12"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.58"/></filter>`, `
    <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
    <rect x="27" y="27" width="458" height="458" rx="101" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="2"/>
    <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#sheen)"/>
    <path d="M151 113V327C151 360.1 177.9 387 211 387H376" fill="none" stroke="#020305" stroke-width="84" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" filter="url(#shadow)"/>
    <path d="M151 113V327C151 360.1 177.9 387 211 387H376" fill="none" stroke="url(#metal)" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M135 116V325" stroke="#dbefff" stroke-opacity="0.42" stroke-width="3" stroke-linecap="round"/>
    <path d="M210 405H376" stroke="#47b9f2" stroke-opacity="0.48" stroke-width="4" stroke-linecap="round"/>
  `)
}

function editorialPaper() {
  return svg(`
    <linearGradient id="paper" x1="62" y1="32" x2="460" y2="487" gradientUnits="userSpaceOnUse"><stop stop-color="#f9f6ef"/><stop offset="0.55" stop-color="#eee8dc"/><stop offset="1" stop-color="#ddd5c7"/></linearGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="4" result="noise"/><feColorMatrix in="noise" type="saturate" values="0" result="mono"/><feComponentTransfer in="mono"><feFuncA type="table" tableValues="0 0.035"/></feComponentTransfer></filter>`, `
    <rect x="16" y="16" width="480" height="480" rx="78" fill="url(#paper)"/>
    <rect x="16" y="16" width="480" height="480" rx="78" filter="url(#grain)" opacity="0.55"/>
    <path d="M132 101H202V338H356V407H132V101Z" fill="#111317"/>
    <circle cx="354" cy="145" r="53" fill="#e8392f"/>
    <circle cx="354" cy="145" r="20" fill="#f8f4eb"/>
    <path d="M105 435H406" stroke="#111317" stroke-width="8"/>
    <path d="M105 435H192" stroke="#e8392f" stroke-width="8"/>
  `)
}

function smokedGlass() {
  return svg(`
    <linearGradient id="bg" x1="56" y1="28" x2="456" y2="488" gradientUnits="userSpaceOnUse"><stop stop-color="#1a2633"/><stop offset="0.5" stop-color="#08121c"/><stop offset="1" stop-color="#03070c"/></linearGradient>
    <linearGradient id="glass" x1="122" y1="92" x2="392" y2="426" gradientUnits="userSpaceOnUse"><stop stop-color="#e8faff" stop-opacity="0.3"/><stop offset="0.32" stop-color="#68d6ff" stop-opacity="0.13"/><stop offset="0.72" stop-color="#235b7f" stop-opacity="0.09"/><stop offset="1" stop-color="#dff8ff" stop-opacity="0.19"/></linearGradient>
    <linearGradient id="edge" x1="133" y1="104" x2="381" y2="409" gradientUnits="userSpaceOnUse"><stop stop-color="#e8fbff"/><stop offset="0.42" stop-color="#6ad8ff"/><stop offset="1" stop-color="#2374a9"/></linearGradient>
    <radialGradient id="lens" cx="0" cy="0" r="1" gradientTransform="translate(331 166) rotate(90) scale(137)"><stop stop-color="#dffbff" stop-opacity="0.92"/><stop offset="0.24" stop-color="#65d8ff" stop-opacity="0.55"/><stop offset="1" stop-color="#65d8ff" stop-opacity="0"/></radialGradient>
    <filter id="glassShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#000000" flood-opacity="0.62"/></filter>`, `
    <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
    <circle cx="331" cy="166" r="125" fill="url(#lens)" opacity="0.5"/>
    <rect x="105" y="84" width="302" height="344" rx="91" fill="#02070b" opacity="0.68" filter="url(#glassShadow)"/>
    <rect x="105" y="84" width="302" height="344" rx="91" fill="url(#glass)" stroke="url(#edge)" stroke-opacity="0.58" stroke-width="4"/>
    <path d="M164 139V316C164 345.8 188.2 370 218 370H354" fill="none" stroke="#e9fbff" stroke-opacity="0.88" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M177 143V309C177 335.5 198.5 357 225 357H350" fill="none" stroke="#61d2ff" stroke-opacity="0.45" stroke-width="10" stroke-linecap="round"/>
    <circle cx="334" cy="164" r="23" fill="#eaffff"/>
    <circle cx="334" cy="164" r="42" fill="none" stroke="#7edfff" stroke-opacity="0.38" stroke-width="3"/>
  `)
}

function prismFold() {
  return svg(`
    <linearGradient id="bg" x1="52" y1="22" x2="467" y2="491" gradientUnits="userSpaceOnUse"><stop stop-color="#162d60"/><stop offset="0.5" stop-color="#0b1637"/><stop offset="1" stop-color="#05091a"/></linearGradient>
    <linearGradient id="front" x1="128" y1="91" x2="366" y2="408" gradientUnits="userSpaceOnUse"><stop stop-color="#eefaff"/><stop offset="0.32" stop-color="#8edcff"/><stop offset="0.65" stop-color="#5685ff"/><stop offset="1" stop-color="#7358d9"/></linearGradient>
    <linearGradient id="top" x1="137" y1="88" x2="241" y2="155" gradientUnits="userSpaceOnUse"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#98dfff"/></linearGradient>
    <linearGradient id="side" x1="211" y1="127" x2="278" y2="344" gradientUnits="userSpaceOnUse"><stop stop-color="#65c4ff"/><stop offset="1" stop-color="#344cc8"/></linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="170%" height="180%"><feDropShadow dx="0" dy="28" stdDeviation="24" flood-color="#000000" flood-opacity="0.55"/></filter>`, `
    <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
    <ellipse cx="273" cy="402" rx="154" ry="39" fill="#000000" opacity="0.42"/>
    <g filter="url(#shadow)">
      <path d="M132 126L190 92L242 127V314H379L414 361L379 407H191C158.4 407 132 380.6 132 348V126Z" fill="url(#front)"/>
      <path d="M132 126L190 92L242 127L184 161L132 126Z" fill="url(#top)"/>
      <path d="M184 161L242 127V314L184 348V161Z" fill="url(#side)"/>
      <path d="M184 348L242 314H379L414 361H242L184 348Z" fill="#78b9ff"/>
      <path d="M242 361H414L379 407H242V361Z" fill="#4e54cb"/>
    </g>
    <path d="M153 139L190 118L220 138" fill="none" stroke="#ffffff" stroke-opacity="0.82" stroke-width="5" stroke-linecap="round"/>
  `)
}

function orbitalSeal() {
  return svg(`
    <linearGradient id="bg" x1="54" y1="24" x2="463" y2="492" gradientUnits="userSpaceOnUse"><stop stop-color="#151b24"/><stop offset="0.55" stop-color="#090d13"/><stop offset="1" stop-color="#030507"/></linearGradient>
    <radialGradient id="halo" cx="0" cy="0" r="1" gradientTransform="translate(256 256) rotate(90) scale(211)"><stop stop-color="#53c7ff" stop-opacity="0.16"/><stop offset="1" stop-color="#53c7ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="ring" x1="128" y1="121" x2="389" y2="391" gradientUnits="userSpaceOnUse"><stop stop-color="#f8fdff"/><stop offset="0.46" stop-color="#b9eaff"/><stop offset="1" stop-color="#5fbde8"/></linearGradient>`, `
    <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
    <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#halo)"/>
    <circle cx="256" cy="256" r="139" fill="none" stroke="url(#ring)" stroke-width="46" stroke-linecap="round" stroke-dasharray="688 186" transform="rotate(-37 256 256)"/>
    <circle cx="256" cy="256" r="53" fill="#e9faff"/>
    <circle cx="256" cy="256" r="20" fill="#09121a"/>
    <circle cx="391" cy="151" r="31" fill="#66ccf7"/>
    <circle cx="391" cy="151" r="10" fill="#f4fdff"/>
    <path d="M122 411H390" stroke="#73c9ef" stroke-opacity="0.2" stroke-width="3" stroke-linecap="round"/>
  `)
}

function cobaltSignal() {
  return svg('', `
    <rect x="16" y="16" width="480" height="480" rx="82" fill="#1737ee"/>
    <path d="M127 99H208V322H379V404H127V99Z" fill="#f6f2e8"/>
    <circle cx="357" cy="145" r="57" fill="#ff5a36"/>
    <path d="M325 145H389M357 113V177" stroke="#1737ee" stroke-width="18" stroke-linecap="round"/>
    <rect x="98" y="432" width="316" height="10" rx="5" fill="#f6f2e8" opacity="0.42"/>
  `)
}

const CONCEPTS = [
  { id: 'F', slug: 'noir-inlay', name: '静银', family: '精密字标', note: '克制金属 · 精密嵌件', svg: noirInlay() },
  { id: 'G', slug: 'editorial-paper', name: '纸境', family: '精密字标', note: '编辑部 · 纸张与红印', svg: editorialPaper() },
  { id: 'H', slug: 'smoked-glass', name: '冷镜', family: '光学材质', note: '烟熏玻璃 · 折射光', svg: smokedGlass() },
  { id: 'I', slug: 'prism-fold', name: '折光', family: '光学材质', note: '三维棱体 · 折叠字母', svg: prismFold() },
  { id: 'J', slug: 'orbital-seal', name: '引力', family: '抽象信号', note: '轨道印记 · 无字母符号', svg: orbitalSeal() },
  { id: 'K', slug: 'cobalt-signal', name: '信号', family: '抽象信号', note: '国际主义 · 强色块', svg: cobaltSignal() }
]

async function comparisonBoard(rendered) {
  const width = 1800
  const height = 1360
  const cardW = 540
  const cardH = 550
  const positions = [
    [60, 180], [630, 180], [1200, 180],
    [60, 765], [630, 765], [1200, 765]
  ]
  const composites = []
  const type = []
  const displayOrder = ['F', 'H', 'J', 'G', 'I', 'K']
  const ordered = displayOrder.map((id) => rendered.find((item) => item.id === id))

  ordered.forEach((item, index) => {
    const [x, y] = positions[index]
    composites.push({ input: item.large, left: x + 35, top: y + 35 })
    composites.push({ input: item.small, left: x + 426, top: y + 70 })
    type.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="28" fill="#151a21" stroke="#252c35"/>`)
    type.push(`<text x="${x + 35}" y="${y + 410}" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="35" font-weight="700">${item.id} · ${item.name}</text>`)
    type.push(`<text x="${x + 35}" y="${y + 451}" fill="#8ea0ae" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="21">${item.family}</text>`)
    type.push(`<text x="${x + 35}" y="${y + 491}" fill="#d2d9df" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="23">${item.note}</text>`)
    type.push(`<text x="${x + 458}" y="${y + 167}" fill="#687784" font-family="Segoe UI, sans-serif" font-size="16" text-anchor="middle">64 px</text>`)
  })

  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="1800" height="1360" fill="#0c1015"/>
    <text x="60" y="68" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="31" font-weight="700" letter-spacing="6">LUMEN · STYLE CALIBRATION 02</text>
    <text x="60" y="108" fill="#71808d" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="20">三种设计语言 / 六个候选 / 同时检查品牌尺度与系统小图标</text>
    <text x="60" y="155" fill="#9aabb8" font-family="Segoe UI, sans-serif" font-size="17" font-weight="700" letter-spacing="4">01 · PRECISION MONOGRAM</text>
    <text x="630" y="155" fill="#9aabb8" font-family="Segoe UI, sans-serif" font-size="17" font-weight="700" letter-spacing="4">02 · OPTICAL OBJECT</text>
    <text x="1200" y="155" fill="#9aabb8" font-family="Segoe UI, sans-serif" font-size="17" font-weight="700" letter-spacing="4">03 · SIGNAL SYSTEM</text>
    ${type.join('')}
  </svg>`)
  await sharp({ create: { width, height, channels: 4, background: '#0c1015' } })
    .composite([{ input: overlay, left: 0, top: 0 }, ...composites])
    .png()
    .toFile(path.join(OUT, 'lumen-premium-comparison.png'))
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const rendered = []
  for (const concept of CONCEPTS) {
    const svgPath = path.join(OUT, `${concept.id.toLowerCase()}-${concept.slug}.svg`)
    const pngPath = path.join(OUT, `${concept.id.toLowerCase()}-${concept.slug}.png`)
    fs.writeFileSync(svgPath, concept.svg)
    await sharp(Buffer.from(concept.svg)).png().toFile(pngPath)
    rendered.push({
      ...concept,
      large: await sharp(pngPath).resize(340, 340).png().toBuffer(),
      small: await sharp(pngPath).resize(64, 64).png().toBuffer()
    })
  }
  await comparisonBoard(rendered)
  console.log(`generated ${CONCEPTS.length} premium concepts in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
