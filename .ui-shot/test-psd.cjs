/* PSD 管线自测（node 直跑）：writePsd 造图 → readPsd 取合成图 → sharp 缩略图 */
const { writePsd, readPsd, initializeCanvas } = require('ag-psd')
const sharp = require('sharp')
const fs = require('fs')

// Node 环境无 canvas：注入纯 JS ImageData 工厂（仅解码合成图用不到真 canvas）
initializeCanvas(
  () => {
    throw new Error('no canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
)

async function main() {
  const w = 96
  const h = 64
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      data[i] = Math.round((x / w) * 200 + 30)
      data[i + 1] = Math.round((y / h) * 120 + 40)
      data[i + 2] = 180
      data[i + 3] = 255
    }
  }
  const out = writePsd({ width: w, height: h, imageData: { width: w, height: h, data } })
  const file = '.ui-shot/test.psd'
  fs.writeFileSync(file, Buffer.from(out))
  console.log('psd written:', fs.statSync(file).size, 'bytes')

  // 与 importer.ts 相同的读取路径
  const psd = readPsd(fs.readFileSync(file), { useImageData: true, skipThumbnail: true })
  const img = psd.imageData
  if (!img) throw new Error('no composite imageData!')
  console.log('composite:', img.width, 'x', img.height)

  const buf = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  const thumb = await sharp(buf, { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  fs.writeFileSync('.ui-shot/test-thumb.jpg', thumb)
  const meta = await sharp(thumb).metadata()
  console.log('thumbnail:', meta.width, 'x', meta.height, 'OK')
}

main().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
