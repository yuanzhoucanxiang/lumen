const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'design-proposals', 'icon-raven-photo-vector')
const sourcePath = path.join(root, 'build', 'raven-icon-source.png')

fs.mkdirSync(outDir, { recursive: true })

const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">Raven silhouette icon</title>
  <desc id="desc">A clean vector interpretation of a side-profile raven with a long beak, hunched back, heavy body and raised claw.</desc>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d6d7d8"/>
      <stop offset="0.52" stop-color="#bfc1c3"/>
      <stop offset="1" stop-color="#a8abad"/>
    </linearGradient>
    <linearGradient id="raven" x1="0.1" y1="0" x2="0.88" y2="1">
      <stop offset="0" stop-color="#15171a"/>
      <stop offset="0.55" stop-color="#090a0c"/>
      <stop offset="1" stop-color="#030405"/>
    </linearGradient>
    <clipPath id="tile">
      <rect x="16" y="16" width="480" height="480" rx="78"/>
    </clipPath>
  </defs>

  <g clip-path="url(#tile)">
    <rect x="16" y="16" width="480" height="480" fill="url(#sky)"/>

    <!-- One continuous head, beak, neck and body silhouette. -->
    <path fill="url(#raven)" d="
      M 484 204
      C 465 187 437 173 399 157
      C 374 147 354 136 338 118
      C 319 97 295 86 269 83
      C 238 80 210 88 185 106
      C 158 126 143 151 120 176
      C 99 198 77 210 59 225
      L 71 229
      L 54 236
      C 32 250 23 277 25 311
      C 27 357 38 405 50 449
      L 68 512
      L 418 512
      C 413 478 403 439 387 401
      C 373 364 350 329 337 297
      C 325 267 330 245 349 231
      C 368 217 392 212 417 212
      C 443 212 466 217 484 215
      Q 491 211 484 204
      Z"/>

    <!-- Raised tarsus: narrow and slightly uneven, like the photographed leg. -->
    <path fill="#050607" d="
      M 396 437
      C 406 452 416 461 427 458
      C 436 454 442 444 445 430
      C 451 440 459 446 469 447
      C 476 448 481 444 484 437
      C 479 440 472 439 466 435
      C 456 429 451 419 450 405
      L 450 321
      C 452 313 452 304 448 300
      C 444 296 440 300 439 307
      C 438 315 441 323 441 332
      L 441 413
      C 441 430 438 445 428 450
      C 420 454 411 448 402 437
      Z"/>

    <!-- Upright digit: short hook, swollen joints, and an uneven inner edge. -->
    <path fill="#050607" d="
      M 440 310
      C 438 301 439 291 443 283
      C 447 275 447 267 443 260
      C 439 252 439 243 445 237
      L 450 233
      C 447 242 449 250 454 256
      C 459 262 459 270 456 277
      C 452 285 453 292 457 298
      C 461 305 459 312 454 317
      C 449 321 443 317 440 310
      Z"/>

    <!-- Upper forward digit: kept narrow instead of leaf-shaped. -->
    <path fill="#050607" d="
      M 447 309
      C 451 298 455 289 462 281
      C 469 274 477 267 486 265
      L 493 266
      C 484 270 479 277 477 284
      C 474 292 469 299 462 304
      C 457 309 453 313 450 318
      Z"/>

    <!-- Lower forward digit: shorter, with a compact hooked tip. -->
    <path fill="#050607" d="
      M 449 315
      C 457 307 465 299 474 295
      C 481 292 488 293 493 298
      C 486 297 480 301 476 306
      C 469 314 460 320 451 322
      Z"/>

    <!-- Small joint masses stop the foot reading as decorative foliage. -->
    <circle cx="446" cy="310" r="8" fill="#050607"/>
    <circle cx="448" cy="283" r="5" fill="#050607"/>
    <circle cx="459" cy="302" r="4.5" fill="#050607"/>

    <!-- Rear digit curling down beside the tarsus, as in the photograph. -->
    <path fill="#050607" d="
      M 446 374
      C 451 397 458 418 467 427
      C 473 433 480 435 486 432
      C 483 441 477 446 469 444
      C 458 441 450 432 445 418
      C 440 403 439 386 446 374
      Z"/>
  </g>
</svg>`

const svgPath = path.join(outDir, 'raven-vector-v3.svg')
const pngPath = path.join(outDir, 'raven-vector-v3.png')
const smallPath = path.join(outDir, 'raven-vector-v3-64.png')
const comparisonPath = path.join(outDir, 'raven-vector-v3-comparison.png')
const clawDetailPath = path.join(outDir, 'raven-vector-v3-claw-detail.png')

fs.writeFileSync(svgPath, iconSvg, 'utf8')

const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

async function run() {
  const svgBuffer = Buffer.from(iconSvg)

  await sharp(svgBuffer, { density: 288 })
    .resize(1024, 1024)
    .png()
    .toFile(pngPath)

  await sharp(svgBuffer, { density: 192 })
    .resize(64, 64)
    .png()
    .toFile(smallPath)

  const reference = await sharp(sourcePath)
    .resize(420, 420, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const vector = await sharp(svgBuffer, { density: 192 })
    .resize(420, 420)
    .png()
    .toBuffer()

  const tiny = await sharp(svgBuffer, { density: 192 })
    .resize(64, 64)
    .png()
    .toBuffer()

  const boardSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
      <rect width="1200" height="720" fill="#0b0f13"/>
      <text x="54" y="64" fill="#f4f5f6" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="29" font-weight="700" letter-spacing="5">RAVEN PHOTO → VECTOR TRACE</text>
      <text x="54" y="103" fill="#87929d" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="18">${esc('保留长嘴、拱背、低垂身体与抬爪；SVG 内不嵌入原位图')}</text>

      <rect x="50" y="138" width="520" height="520" rx="28" fill="#151b21" stroke="#2a323b"/>
      <rect x="630" y="138" width="520" height="520" rx="28" fill="#151b21" stroke="#2a323b"/>

      <text x="82" y="603" fill="#f2f4f5" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="27" font-weight="700">参考照片</text>
      <text x="662" y="603" fill="#f2f4f5" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="27" font-weight="700">矢量剪影 V3 · 照片比例鸟爪</text>
      <text x="82" y="635" fill="#8a96a2" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="15" letter-spacing="1">SOURCE / CROPPED</text>
      <text x="662" y="635" fill="#ff5149" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="15" letter-spacing="1">PURE SVG / 64 PX CHECK</text>
      <text x="1027" y="633" fill="#8a96a2" font-family="Arial, sans-serif" font-size="13">64 px</text>
    </svg>`

  await sharp(Buffer.from(boardSvg))
    .composite([
      { input: reference, left: 100, top: 165 },
      { input: vector, left: 680, top: 165 },
      { input: tiny, left: 1025, top: 540 },
    ])
    .png()
    .toFile(comparisonPath)

  const referenceClaw = await sharp(sourcePath)
    .extract({ left: 650, top: 320, width: 220, height: 430 })
    .resize(280, 440, { fit: 'contain', background: '#c4c5c6' })
    .png()
    .toBuffer()

  const vectorLarge = await sharp(svgBuffer, { density: 288 })
    .resize(1024, 1024)
    .png()
    .toBuffer()

  const vectorClaw = await sharp(vectorLarge)
    .extract({ left: 720, top: 420, width: 260, height: 520 })
    .resize(280, 440, { fit: 'contain', background: '#c4c5c6' })
    .png()
    .toBuffer()

  const detailSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="920" height="620" viewBox="0 0 920 620">
      <rect width="920" height="620" fill="#0b0f13"/>
      <text x="50" y="60" fill="#f4f5f6" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="28" font-weight="700" letter-spacing="4">CLAW SHAPE · V3</text>
      <text x="50" y="94" fill="#87929d" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="17">${esc('按照片比例收窄腕部；趾骨更短、更硬，保留关节结块与钩尖')}</text>
      <rect x="70" y="125" width="340" height="450" rx="22" fill="#151b21" stroke="#2a323b"/>
      <rect x="510" y="125" width="340" height="450" rx="22" fill="#151b21" stroke="#2a323b"/>
      <text x="100" y="557" fill="#f2f4f5" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="22" font-weight="700">参考照片局部</text>
      <text x="540" y="557" fill="#f2f4f5" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="22" font-weight="700">V3 矢量鸟爪</text>
    </svg>`

  await sharp(Buffer.from(detailSvg))
    .composite([
      { input: referenceClaw, left: 100, top: 135 },
      { input: vectorClaw, left: 540, top: 135 },
    ])
    .png()
    .toFile(clawDetailPath)

  process.stdout.write([
    svgPath,
    pngPath,
    smallPath,
    comparisonPath,
    clawDetailPath,
  ].join('\n'))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
