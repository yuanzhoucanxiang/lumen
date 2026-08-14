/* E1-0 refinement: preserve the sculptural ivory plane, improve black negative space. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'design-proposals', 'icon-e1-zero-refinement')
const IVORY = '#f2ede3'
const INK = '#101216'
const RED = '#ef3b31'

const defs = `
  <clipPath id="iconClip" clipPathUnits="userSpaceOnUse"><rect x="16" y="16" width="480" height="480" rx="78"/></clipPath>
  <linearGradient id="night" x1="48" y1="24" x2="469" y2="491" gradientUnits="userSpaceOnUse"><stop stop-color="#3a3e46"/><stop offset="0.48" stop-color="#292d34"/><stop offset="1" stop-color="#1a1d23"/></linearGradient>
  <linearGradient id="bodyShade" x1="190" y1="96" x2="478" y2="486" gradientUnits="userSpaceOnUse"><stop stop-color="#292d34"/><stop offset="0.38" stop-color="#1e2228"/><stop offset="0.72" stop-color="#14171c"/><stop offset="1" stop-color="#0b0d11"/></linearGradient>
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

function proportionLeftDark() {
  return doc(`
    ${shell()}
    <g transform="translate(-20 0)">
      <path d="M171 96H226L251 184L221 412H153L171 96Z" fill="${IVORY}"/>
      <path d="M197 140L226 181L203 378H178L197 140Z" fill="${INK}" opacity="0.84"/>
      <path d="M222 121C281 87 369 91 421 143" fill="none" stroke="${IVORY}" stroke-width="18" stroke-linecap="round"/>
      <path d="M220 412H365" stroke="${IVORY}" stroke-width="22"/>
      <path d="M251 184L221 412H286" fill="#62636a" opacity="0.46"/>
      ${eye(346, 163, 40)}
      <path d="M106 445H405" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="4"/>
    </g>
  `)
}

function proportionLeftBody() {
  return doc(`
    ${shell()}
    <g transform="translate(-20 0)">
      <path d="M219 114C285 76 383 88 430 157C482 234 461 353 386 414H207L247 184L219 114Z" fill="#050609" stroke="#2b2e34" stroke-width="3"/>
      <path d="M179 96H222L247 184L217 412H164L179 96Z" fill="${IVORY}"/>
      <path d="M222 121C281 87 369 91 421 143" fill="none" stroke="${IVORY}" stroke-width="18" stroke-linecap="round"/>
      <path d="M216 412H355" stroke="${IVORY}" stroke-width="21"/>
      <path d="M247 184L217 412H286" fill="#55585e" opacity="0.52"/>
      ${eye(346, 163, 40)}
      <path d="M106 445H405" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="4"/>
    </g>
  `)
}

function proportionLeftOverlay() {
  return doc(`
    ${shell()}
    <g transform="translate(-20 0)">
      <path d="M171 96H226L251 184L221 412H153L171 96Z" fill="${IVORY}"/>
      <path d="M222 121C281 87 369 91 421 143" fill="none" stroke="${IVORY}" stroke-width="18" stroke-linecap="round"/>
      <path d="M220 412H365" stroke="${IVORY}" stroke-width="22"/>
      <path d="M231 157L202 412H286L231 157Z" fill="#07080b" opacity="0.92"/>
      ${eye(346, 163, 40)}
      <path d="M106 445H405" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="4"/>
    </g>
  `)
}

function proportionLeftBodyCrop() {
  return doc(`
    ${shell()}
    <g clip-path="url(#iconClip)">
      <g transform="translate(-20 0)">
        <path d="M171 96H226L251 184L221 412H153L171 96Z" fill="${IVORY}"/>
        <path d="M207 109C279 75 389 87 456 158L520 196V512H186L231 184L207 109Z" fill="#050609"/>
        <path d="M222 121C281 87 369 91 421 143" fill="none" stroke="${IVORY}" stroke-width="18" stroke-linecap="round"/>
        <path d="M220 412H365" stroke="${IVORY}" stroke-width="22"/>
        ${eye(346, 163, 40)}
        <path d="M106 445H405" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="4"/>
      </g>
    </g>
  `)
}

function proportionLeftWhiteReduced() {
  return doc(`
    ${shell()}
    <g clip-path="url(#iconClip)">
      <g transform="translate(-20 0)">
        <path d="M196 96C279 72 390 87 456 158L520 196V512H191L221 184L196 96Z" fill="url(#bodyShade)"/>
        <path d="M171 96H196L221 184L191 412H153L171 96Z" fill="${IVORY}"/>
        <path d="M222 121C281 87 369 91 421 143" fill="none" stroke="${IVORY}" stroke-width="18" stroke-linecap="round"/>
        ${eye(346, 163, 40)}
      </g>
    </g>
  `)
}

function proportionLeftWhiteReducedNoArc() {
  return proportionLeftWhiteReduced().replace(
    /\s*<path d="M222 121C281 87 369 91 421 143" fill="none" stroke="#[0-9a-fA-F]{6}" stroke-width="18" stroke-linecap="round"\/>/,
    ''
  )
}

function proportionSideBeak() {
  return doc(`
    ${shell()}
    <g clip-path="url(#iconClip)">
      <g transform="translate(-20 0)">
        <path d="M196 96C279 72 390 87 456 158L520 196V512H191L221 184L196 96Z" fill="url(#bodyShade)"/>
        <path d="M210 132C180 134 137 149 94 174C134 174 165 183 190 198C199 181 207 156 210 132Z" fill="${IVORY}"/>
        ${eye(346, 163, 40)}
      </g>
    </g>
  `)
}

function sideBeakVariant(beakMarkup) {
  return doc(`
    ${shell()}
    <g clip-path="url(#iconClip)">
      <g transform="translate(-20 0)">
        <path d="M196 96C279 72 390 87 456 158L520 196V512H191L221 184L196 96Z" fill="url(#bodyShade)"/>
        ${beakMarkup}
        ${eye(346, 163, 40)}
      </g>
    </g>
  `)
}

function sideBeakLongSharp() {
  return sideBeakVariant(`<path d="M212 140C174 139 125 151 72 173C124 170 166 177 196 188C204 175 210 156 212 140Z" fill="${IVORY}"/>`)
}

function sideBeakSoftHook() {
  return sideBeakVariant(`<path d="M211 131C176 134 129 150 84 168C99 170 104 175 98 183C132 179 166 188 191 202C202 182 210 154 211 131Z" fill="${IVORY}"/>`)
}

function sideBeakFaceted() {
  return sideBeakVariant(`
    <path d="M211 134L79 173L176 181L195 202L211 160Z" fill="${IVORY}"/>
    <path d="M79 173L176 181L195 202C161 188 122 178 79 173Z" fill="#c9c3b8"/>
  `)
}

function sideBeakShortHeavy() {
  return sideBeakVariant(`<path d="M212 124C183 127 148 139 113 157L91 171C129 174 165 187 191 207C205 184 213 151 212 124Z" fill="${IVORY}"/>`)
}

function noBeak() {
  return sideBeakVariant('')
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

async function makeDarkAdjustmentBoard(previous, adjusted) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="650">
    <rect width="1160" height="650" fill="#0c1015"/>
    <text x="50" y="58" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · POSITION + BLACK-MASS TEST</text>
    <text x="50" y="96" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">在左移 12px 稿基础上，再左移 8px，并扩大内部近黑色羽面</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="82" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">左移 12px</text>
    <text x="642" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">左移 20px + 黑羽</text>
    <text x="82" y="575" fill="#8998a4" font-family="Segoe UI, sans-serif" font-size="17">PREVIOUS</text>
    <text x="642" y="575" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17">ADJUSTED</text>
  </svg>`)
  await sharp({ create: { width: 1160, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: previous, left: 130, top: 165 },
      { input: adjusted, left: 690, top: 165 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-left20-dark-comparison.png'))
}

async function makeBodyAdjustmentBoard(previous, adjusted) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="650">
    <rect width="1160" height="650" fill="#0c1015"/>
    <text x="50" y="58" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · WHITE / BLACK BODY TEST</text>
    <text x="50" y="96" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">移除内部黑槽：缩小象牙白面积，扩大右侧连续乌鸦黑色身体</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="82" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">旧版：左移 12px</text>
    <text x="642" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">新版：白少 / 黑身大</text>
    <text x="82" y="575" fill="#8998a4" font-family="Segoe UI, sans-serif" font-size="17">REFERENCE</text>
    <text x="642" y="575" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17">ADJUSTED</text>
  </svg>`)
  await sharp({ create: { width: 1160, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: previous, left: 130, top: 165 },
      { input: adjusted, left: 690, top: 165 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-body-mass-comparison.png'))
}

async function makeOverlayAdjustmentBoard(previous, adjusted) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="650">
    <rect width="1160" height="650" fill="#0c1015"/>
    <text x="50" y="58" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · BLACK OVERLAY POSITION TEST</text>
    <text x="50" y="96" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">不画完整身体：仅将原有三角黑色羽面向左推进，覆盖更多白色</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="82" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">旧版：黑面靠右</text>
    <text x="642" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">新版：黑面左移</text>
    <text x="82" y="575" fill="#8998a4" font-family="Segoe UI, sans-serif" font-size="17">REFERENCE</text>
    <text x="642" y="575" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17">ADJUSTED</text>
  </svg>`)
  await sharp({ create: { width: 1160, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: previous, left: 130, top: 165 },
      { input: adjusted, left: 690, top: 165 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-overlay-left-comparison.png'))
}

async function makeBodyCropAdjustmentBoard(previous, adjusted) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="650">
    <rect width="1160" height="650" fill="#0c1015"/>
    <text x="50" y="58" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · CROPPED BLACK BODY TEST</text>
    <text x="50" y="96" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">黑色主体只向左覆盖白色，右侧直接出画，不绘制完整身体</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="82" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">旧版：白色面积偏多</text>
    <text x="642" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">新版：黑色主体左压</text>
    <text x="82" y="575" fill="#8998a4" font-family="Segoe UI, sans-serif" font-size="17">REFERENCE</text>
    <text x="642" y="575" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17">BODY CROP / NO FULL OUTLINE</text>
  </svg>`)
  await sharp({ create: { width: 1160, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: previous, left: 130, top: 165 },
      { input: adjusted, left: 690, top: 165 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-body-crop-comparison.png'))
}

async function makeWhiteReducedBoard(previous, adjusted) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="650">
    <rect width="1160" height="650" fill="#0c1015"/>
    <text x="50" y="58" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · BODY GRADIENT / NO BOTTOM LINES</text>
    <text x="50" y="96" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">背景改为较亮石墨炭黑；乌鸦保留渐变，并在全区域始终比背景更暗</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="82" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">旧版：原始白色宽度</text>
    <text x="642" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">新版：亮背景 / 暗乌鸦</text>
    <text x="82" y="575" fill="#8998a4" font-family="Segoe UI, sans-serif" font-size="17">REFERENCE</text>
    <text x="642" y="575" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17">GRAPHITE BG / DARKER CROW</text>
  </svg>`)
  await sharp({ create: { width: 1160, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: previous, left: 130, top: 165 },
      { input: adjusted, left: 690, top: 165 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-white-reduced-comparison.png'))
}

async function makeNoArcBoard(withArc, noArc) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="650">
    <rect width="1160" height="650" fill="#0c1015"/>
    <text x="50" y="58" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · WHITE ARC REMOVAL TEST</text>
    <text x="50" y="96" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">仅移除红眼上方的弯曲白色眉弧，其余结构与明暗关系保持不变</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="82" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">当前版：保留白色眉弧</text>
    <text x="642" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">测试版：移除白色眉弧</text>
    <text x="82" y="575" fill="#8998a4" font-family="Segoe UI, sans-serif" font-size="17">WITH ARC</text>
    <text x="642" y="575" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17">NO ARC</text>
  </svg>`)
  await sharp({ create: { width: 1160, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: withArc, left: 130, top: 165 },
      { input: noArc, left: 690, top: 165 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-no-arc-comparison.png'))
}

async function makeSideBeakBoard(noArc, sideBeak) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="650">
    <rect width="1160" height="650" fill="#0c1015"/>
    <text x="50" y="58" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · SIDE BEAK TEST</text>
    <text x="50" y="96" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">将左侧整条白边替换为抽象侧面嘴巴；保留正面右眼局部与深色头部</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="82" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">当前版：抽象白色竖边</text>
    <text x="642" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">测试版：侧面乌鸦嘴</text>
    <text x="82" y="575" fill="#8998a4" font-family="Segoe UI, sans-serif" font-size="17">VERTICAL EDGE</text>
    <text x="642" y="575" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17">ABSTRACT SIDE BEAK</text>
  </svg>`)
  await sharp({ create: { width: 1160, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: noArc, left: 130, top: 165 },
      { input: sideBeak, left: 690, top: 165 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-side-beak-comparison.png'))
}

async function makeSideBeakVariantsBoard(variants) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="660">
    <rect width="1500" height="660" fill="#0c1015"/>
    <text x="40" y="55" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · SIDE BEAK CALIBRATION</text>
    <text x="40" y="92" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="18">锁定红眼、头部、背景与渐变，只比较侧嘴的长度、钩度、切面和厚度</text>
    <rect x="30" y="120" width="340" height="500" rx="26" fill="#151a21" stroke="#272e37"/>
    <rect x="390" y="120" width="340" height="500" rx="26" fill="#151a21" stroke="#272e37"/>
    <rect x="750" y="120" width="340" height="500" rx="26" fill="#151a21" stroke="#272e37"/>
    <rect x="1110" y="120" width="340" height="500" rx="26" fill="#151a21" stroke="#272e37"/>
    <text x="55" y="475" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="27" font-weight="700">S1 · 长锐</text>
    <text x="415" y="475" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="27" font-weight="700">S2 · 轻钩</text>
    <text x="775" y="475" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="27" font-weight="700">S3 · 双切面</text>
    <text x="1135" y="475" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="27" font-weight="700">S4 · 短厚</text>
    <text x="55" y="512" fill="#8998a4" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="17">最抽象，速度感最强</text>
    <text x="415" y="512" fill="#8998a4" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="17">嘴尖微钩，更像乌鸦</text>
    <text x="775" y="512" fill="#8998a4" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="17">几何层次最明确</text>
    <text x="1135" y="512" fill="#8998a4" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="17">稳重、徽章感最强</text>
    <text x="55" y="555" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="16">LONG / SHARP</text>
    <text x="415" y="555" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="16">SOFT HOOK</text>
    <text x="775" y="555" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="16">TWO FACETS</text>
    <text x="1135" y="555" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="16">SHORT / HEAVY</text>
  </svg>`)
  await sharp({ create: { width: 1500, height: 660, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: variants[0], left: 60, top: 145 },
      { input: variants[1], left: 420, top: 145 },
      { input: variants[2], left: 780, top: 145 },
      { input: variants[3], left: 1140, top: 145 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-side-beak-variants.png'))
}

async function makeNoBeakBoard(sideBeak, withoutBeak) {
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="650">
    <rect width="1160" height="650" fill="#0c1015"/>
    <text x="50" y="58" fill="#f4f6f8" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" letter-spacing="5">E1-0A · NO BEAK TEST</text>
    <text x="50" y="96" fill="#75838f" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="19">完全移除象牙白嘴形，仅保留石墨背景、渐变乌鸦头部与红眼</text>
    <rect x="50" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <rect x="610" y="130" width="500" height="470" rx="28" fill="#151a21" stroke="#272e37"/>
    <text x="82" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">侧嘴版：保留嘴形</text>
    <text x="642" y="540" fill="#f5f7f9" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="29" font-weight="700">测试版：完全无嘴</text>
    <text x="82" y="575" fill="#8998a4" font-family="Segoe UI, sans-serif" font-size="17">WITH BEAK</text>
    <text x="642" y="575" fill="#ef5a50" font-family="Segoe UI, sans-serif" font-size="17">NO BEAK</text>
  </svg>`)
  await sharp({ create: { width: 1160, height: 650, channels: 4, background: '#0c1015' } })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: sideBeak, left: 130, top: 165 },
      { input: withoutBeak, left: 690, top: 165 }
    ])
    .png()
    .toFile(path.join(OUT, 'lumen-e1-zeroa-no-beak-comparison.png'))
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
  const adjustedSvg = proportionLeftDark()
  const adjustedSvgPath = path.join(OUT, 'e1-0a-left-20-dark.svg')
  const adjustedPngPath = path.join(OUT, 'e1-0a-left-20-dark.png')
  fs.writeFileSync(adjustedSvgPath, adjustedSvg)
  await sharp(Buffer.from(adjustedSvg)).png().toFile(adjustedPngPath)
  const adjusted = await sharp(adjustedPngPath).resize(360, 360).png().toBuffer()
  await makeDarkAdjustmentBoard(shifted, adjusted)
  const bodySvg = proportionLeftBody()
  const bodySvgPath = path.join(OUT, 'e1-0a-left-20-body.svg')
  const bodyPngPath = path.join(OUT, 'e1-0a-left-20-body.png')
  fs.writeFileSync(bodySvgPath, bodySvg)
  await sharp(Buffer.from(bodySvg)).png().toFile(bodyPngPath)
  const body = await sharp(bodyPngPath).resize(360, 360).png().toBuffer()
  await makeBodyAdjustmentBoard(shifted, body)
  const overlaySvg = proportionLeftOverlay()
  const overlaySvgPath = path.join(OUT, 'e1-0a-left-20-overlay.svg')
  const overlayPngPath = path.join(OUT, 'e1-0a-left-20-overlay.png')
  fs.writeFileSync(overlaySvgPath, overlaySvg)
  await sharp(Buffer.from(overlaySvg)).png().toFile(overlayPngPath)
  const overlay = await sharp(overlayPngPath).resize(360, 360).png().toBuffer()
  await makeOverlayAdjustmentBoard(shifted, overlay)
  const bodyCropSvg = proportionLeftBodyCrop()
  const bodyCropSvgPath = path.join(OUT, 'e1-0a-left-20-body-crop.svg')
  const bodyCropPngPath = path.join(OUT, 'e1-0a-left-20-body-crop.png')
  fs.writeFileSync(bodyCropSvgPath, bodyCropSvg)
  await sharp(Buffer.from(bodyCropSvg)).png().toFile(bodyCropPngPath)
  const bodyCrop = await sharp(bodyCropPngPath).resize(360, 360).png().toBuffer()
  await makeBodyCropAdjustmentBoard(shifted, bodyCrop)
  const whiteReducedSvg = proportionLeftWhiteReduced()
  const whiteReducedSvgPath = path.join(OUT, 'e1-0a-left-20-white-reduced.svg')
  const whiteReducedPngPath = path.join(OUT, 'e1-0a-left-20-white-reduced.png')
  fs.writeFileSync(whiteReducedSvgPath, whiteReducedSvg)
  await sharp(Buffer.from(whiteReducedSvg)).png().toFile(whiteReducedPngPath)
  const whiteReduced = await sharp(whiteReducedPngPath).resize(360, 360).png().toBuffer()
  await makeWhiteReducedBoard(shifted, whiteReduced)
  const noArcSvg = proportionLeftWhiteReducedNoArc()
  const noArcSvgPath = path.join(OUT, 'e1-0a-left-20-no-arc.svg')
  const noArcPngPath = path.join(OUT, 'e1-0a-left-20-no-arc.png')
  fs.writeFileSync(noArcSvgPath, noArcSvg)
  await sharp(Buffer.from(noArcSvg)).png().toFile(noArcPngPath)
  const noArc = await sharp(noArcPngPath).resize(360, 360).png().toBuffer()
  await makeNoArcBoard(whiteReduced, noArc)
  const sideBeakSvg = proportionSideBeak()
  const sideBeakSvgPath = path.join(OUT, 'e1-0a-side-beak.svg')
  const sideBeakPngPath = path.join(OUT, 'e1-0a-side-beak.png')
  fs.writeFileSync(sideBeakSvgPath, sideBeakSvg)
  await sharp(Buffer.from(sideBeakSvg)).png().toFile(sideBeakPngPath)
  const sideBeak = await sharp(sideBeakPngPath).resize(360, 360).png().toBuffer()
  await makeSideBeakBoard(noArc, sideBeak)
  const sideBeakVariants = [
    ['s1-long-sharp', sideBeakLongSharp()],
    ['s2-soft-hook', sideBeakSoftHook()],
    ['s3-faceted', sideBeakFaceted()],
    ['s4-short-heavy', sideBeakShortHeavy()]
  ]
  const sideBeakVariantBuffers = []
  for (const [slug, svg] of sideBeakVariants) {
    const svgPath = path.join(OUT, `e1-0a-side-beak-${slug}.svg`)
    const pngPath = path.join(OUT, `e1-0a-side-beak-${slug}.png`)
    fs.writeFileSync(svgPath, svg)
    await sharp(Buffer.from(svg)).png().toFile(pngPath)
    sideBeakVariantBuffers.push(await sharp(pngPath).resize(280, 280).png().toBuffer())
  }
  await makeSideBeakVariantsBoard(sideBeakVariantBuffers)
  const noBeakSvg = noBeak()
  const noBeakSvgPath = path.join(OUT, 'e1-0a-no-beak.svg')
  const noBeakPngPath = path.join(OUT, 'e1-0a-no-beak.png')
  fs.writeFileSync(noBeakSvgPath, noBeakSvg)
  await sharp(Buffer.from(noBeakSvg)).png().toFile(noBeakPngPath)
  const noBeakBuffer = await sharp(noBeakPngPath).resize(360, 360).png().toBuffer()
  await makeNoBeakBoard(sideBeak, noBeakBuffer)
  console.log(`generated ${VARIANTS.length} E1-0 refinements in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
