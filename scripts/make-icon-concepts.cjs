/* Non-destructive LUMEN icon explorations.
   Generates editable SVGs, 512px PNG previews, and one comparison board. */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'design-proposals', 'icon-concepts')
const SHELL = 'M88 16H404L496 108V424C496 463.8 463.8 496 424 496H88C48.2 496 16 463.8 16 424V88C16 48.2 48.2 16 88 16Z'

function documentSvg(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>${defs}</defs>
  ${body}
</svg>`
}

function conceptB() {
  return documentSvg(`
    <linearGradient id="bg" x1="64" y1="40" x2="448" y2="480" gradientUnits="userSpaceOnUse">
      <stop stop-color="#142e42"/><stop offset="0.55" stop-color="#091a28"/><stop offset="1" stop-color="#050c13"/>
    </linearGradient>
    <linearGradient id="tile" x1="126" y1="117" x2="383" y2="390" gradientUnits="userSpaceOnUse">
      <stop stop-color="#bfeaff"/><stop offset="0.42" stop-color="#58c3fa"/><stop offset="1" stop-color="#258bd1"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(365 145) rotate(125) scale(220)">
      <stop stop-color="#56c9ff" stop-opacity="0.36"/><stop offset="1" stop-color="#56c9ff" stop-opacity="0"/>
    </radialGradient>`, `
    <path d="${SHELL}" fill="url(#bg)"/><path d="${SHELL}" fill="url(#glow)"/>
    <path d="M406 18L494 106H438C420.3 106 406 91.7 406 74V18Z" fill="#52bff5" opacity="0.17"/>
    <rect x="108" y="104" width="126" height="126" rx="27" fill="url(#tile)"/>
    <rect x="278" y="104" width="126" height="126" rx="27" fill="#0c2232" stroke="#72c9f3" stroke-width="14" opacity="0.76"/>
    <rect x="108" y="274" width="126" height="126" rx="27" fill="url(#tile)"/>
    <rect x="278" y="274" width="126" height="126" rx="27" fill="url(#tile)"/>
    <path d="M171 157V324C171 335 180 344 191 344H341" fill="none" stroke="#f2fbff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" opacity="0.96"/>
    <circle cx="341" cy="167" r="25" fill="#dff7ff"/>
    <path d="M341 126V139M341 195V208M300 167H313M369 167H382" stroke="#bdeeff" stroke-width="10" stroke-linecap="round"/>
  `)
}

function conceptC() {
  return documentSvg(`
    <linearGradient id="bg" x1="54" y1="31" x2="458" y2="487" gradientUnits="userSpaceOnUse">
      <stop stop-color="#28214d"/><stop offset="0.48" stop-color="#11142e"/><stop offset="1" stop-color="#080b17"/>
    </linearGradient>
    <radialGradient id="core" cx="0" cy="0" r="1" gradientTransform="translate(256 255) rotate(90) scale(201)">
      <stop stop-color="#82ddff" stop-opacity="0.32"/><stop offset="1" stop-color="#7770ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="p1" x1="152" y1="125" x2="274" y2="255" gradientUnits="userSpaceOnUse"><stop stop-color="#a9ecff"/><stop offset="1" stop-color="#54bdf2"/></linearGradient>
    <linearGradient id="p2" x1="360" y1="132" x2="269" y2="261" gradientUnits="userSpaceOnUse"><stop stop-color="#8b86ff"/><stop offset="1" stop-color="#5bc9fa"/></linearGradient>
    <linearGradient id="p3" x1="347" y1="389" x2="257" y2="267" gradientUnits="userSpaceOnUse"><stop stop-color="#477bff"/><stop offset="1" stop-color="#7bcfff"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="22"/></filter>`, `
    <path d="${SHELL}" fill="url(#bg)"/><path d="${SHELL}" fill="url(#core)"/>
    <path d="M406 18L494 106H438C420.3 106 406 91.7 406 74V18Z" fill="#8a83ff" opacity="0.16"/>
    <circle cx="256" cy="256" r="92" fill="#5dc9ff" opacity="0.21" filter="url(#blur)"/>
    <path d="M256 92L377 162L305 229H207L135 162L256 92Z" fill="url(#p1)"/>
    <path d="M377 162V302L282 276L233 191L256 92L377 162Z" fill="url(#p2)" opacity="0.95"/>
    <path d="M377 302L256 372L233 276L282 191L377 162V302Z" fill="url(#p3)" opacity="0.93"/>
    <path d="M256 372L135 302L207 229H305L377 302L256 372Z" fill="#3d7fd5"/>
    <path d="M135 302V162L230 188L279 273L256 372L135 302Z" fill="#58b9ea"/>
    <path d="M135 162L256 92L279 188L230 273L135 302V162Z" fill="#8bdcf8"/>
    <circle cx="256" cy="256" r="58" fill="#0d1530" stroke="#d9f7ff" stroke-width="13"/>
    <circle cx="256" cy="256" r="24" fill="#f5fdff"/>
  `)
}

function conceptD() {
  return documentSvg(`
    <linearGradient id="bg" x1="50" y1="22" x2="465" y2="489" gradientUnits="userSpaceOnUse"><stop stop-color="#174139"/><stop offset="0.5" stop-color="#0b2729"/><stop offset="1" stop-color="#061214"/></linearGradient>
    <linearGradient id="stroke" x1="114" y1="111" x2="402" y2="403" gradientUnits="userSpaceOnUse"><stop stop-color="#d7fff6"/><stop offset="0.48" stop-color="#67e0cc"/><stop offset="1" stop-color="#31a8ba"/></linearGradient>
    <linearGradient id="scene" x1="141" y1="215" x2="370" y2="381" gradientUnits="userSpaceOnUse"><stop stop-color="#6be1ce"/><stop offset="1" stop-color="#2d8dc2"/></linearGradient>
    <radialGradient id="sun" cx="0" cy="0" r="1" gradientTransform="translate(338 196) rotate(90) scale(88)"><stop stop-color="#eafff9" stop-opacity="0.52"/><stop offset="1" stop-color="#eafff9" stop-opacity="0"/></radialGradient>`, `
    <path d="${SHELL}" fill="url(#bg)"/>
    <path d="M406 18L494 106H438C420.3 106 406 91.7 406 74V18Z" fill="#5be0cf" opacity="0.15"/>
    <path d="M145 96H358L405 143V328" fill="none" stroke="#47b6b0" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>
    <path d="M116 126H329L376 173V358" fill="none" stroke="#73dec9" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" opacity="0.58"/>
    <path d="M85 169C85 155.7 95.7 145 109 145H302L357 200V385C357 398.3 346.3 409 333 409H109C95.7 409 85 398.3 85 385V169Z" fill="#071a1c" stroke="url(#stroke)" stroke-width="18" stroke-linejoin="round"/>
    <path d="M302 146V179C302 190.6 311.4 200 323 200H356" fill="none" stroke="#c5fff1" stroke-width="16"/>
    <circle cx="299" cy="232" r="64" fill="url(#sun)"/>
    <circle cx="299" cy="232" r="22" fill="#e8fff9"/>
    <path d="M111 373L189 283L242 335L280 299L334 373H111Z" fill="url(#scene)"/>
    <path d="M189 283L242 335" stroke="#bcfff1" stroke-width="10" stroke-linecap="round" opacity="0.74"/>
  `)
}

function conceptE() {
  return documentSvg(`
    <linearGradient id="bg" x1="48" y1="32" x2="464" y2="478" gradientUnits="userSpaceOnUse"><stop stop-color="#33290f"/><stop offset="0.5" stop-color="#19170e"/><stop offset="1" stop-color="#0c0c09"/></linearGradient>
    <linearGradient id="gold" x1="116" y1="142" x2="390" y2="408" gradientUnits="userSpaceOnUse"><stop stop-color="#fff3b2"/><stop offset="0.42" stop-color="#ffd65b"/><stop offset="1" stop-color="#df8f25"/></linearGradient>
    <linearGradient id="beam" x1="256" y1="123" x2="256" y2="363" gradientUnits="userSpaceOnUse"><stop stop-color="#fffdf0"/><stop offset="0.42" stop-color="#ffe477"/><stop offset="1" stop-color="#f2a632" stop-opacity="0"/></linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(256 163) rotate(90) scale(167)"><stop stop-color="#ffe372" stop-opacity="0.4"/><stop offset="1" stop-color="#ffe372" stop-opacity="0"/></radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="20"/></filter>`, `
    <path d="${SHELL}" fill="url(#bg)"/>
    <path d="M406 18L494 106H438C420.3 106 406 91.7 406 74V18Z" fill="#ffd75d" opacity="0.13"/>
    <circle cx="256" cy="171" r="116" fill="url(#glow)" filter="url(#blur)"/>
    <path d="M256 110L284 145L326 154L292 181L294 224L256 202L218 224L220 181L186 154L228 145L256 110Z" fill="url(#gold)"/>
    <path d="M244 204H268L301 357H211L244 204Z" fill="url(#beam)" opacity="0.88"/>
    <path d="M101 285H172L199 320H313L340 285H411L384 401C381 414 369.4 423 356 423H156C142.6 423 131 414 128 401L101 285Z" fill="#15150e" stroke="url(#gold)" stroke-width="19" stroke-linejoin="round"/>
    <path d="M132 336H380" stroke="#fff0a7" stroke-width="16" stroke-linecap="round" opacity="0.91"/>
    <path d="M164 382H348" stroke="#d99a2b" stroke-width="12" stroke-linecap="round" opacity="0.54"/>
  `)
}

async function makeComparison(items) {
  const width = 1800
  const height = 620
  const iconSize = 280
  const startX = 60
  const gap = 340
  const iconY = 108
  const composites = []
  const labels = []
  for (let i = 0; i < items.length; i += 1) {
    const left = startX + i * gap
    composites.push({ input: items[i].png, left, top: iconY })
    labels.push(`<text x="${left + iconSize / 2}" y="445" fill="#f3f7fa" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="32" font-weight="700" text-anchor="middle">${items[i].letter} · ${items[i].name}</text>`)
    labels.push(`<text x="${left + iconSize / 2}" y="486" fill="#8293a1" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="20" text-anchor="middle">${items[i].subtitle}</text>`)
  }
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <text x="60" y="58" fill="#f4f8fb" font-family="Segoe UI, sans-serif" font-size="30" font-weight="700" letter-spacing="6">LUMEN · ICON DIRECTIONS</text>
    <path d="M60 79H1740" stroke="#25323d" stroke-width="2"/>
    ${labels.join('')}
  </svg>`)
  await sharp({ create: { width, height, channels: 4, background: '#0b1016' } })
    .composite([...composites, { input: overlay, left: 0, top: 0 }])
    .png()
    .toFile(path.join(OUT, 'lumen-icon-comparison.png'))
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const candidates = [
    { letter: 'B', slug: 'light-grid', name: '光格', subtitle: '素材网格 + L', svg: conceptB() },
    { letter: 'C', slug: 'lumen-prism', name: '光棱', subtitle: '光圈 + 棱镜', svg: conceptC() },
    { letter: 'D', slug: 'media-stack', name: '叠影', subtitle: '多层素材卡片', svg: conceptD() },
    { letter: 'E', slug: 'light-vault', name: '光库', subtitle: '收藏容器 + 光源', svg: conceptE() }
  ]

  const rendered = []
  const currentPng = await sharp(path.join(__dirname, '..', 'build', 'icon.png')).resize(280, 280).png().toBuffer()
  rendered.push({ letter: 'A', name: '光匣', subtitle: '当前方案：L + 素材框', png: currentPng })

  for (const candidate of candidates) {
    const svgPath = path.join(OUT, `${candidate.letter.toLowerCase()}-${candidate.slug}.svg`)
    const pngPath = path.join(OUT, `${candidate.letter.toLowerCase()}-${candidate.slug}.png`)
    fs.writeFileSync(svgPath, candidate.svg)
    await sharp(Buffer.from(candidate.svg)).png().toFile(pngPath)
    rendered.push({ ...candidate, png: await sharp(pngPath).resize(280, 280).png().toBuffer() })
  }

  await makeComparison(rendered)
  console.log(`generated ${candidates.length} new concepts in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
