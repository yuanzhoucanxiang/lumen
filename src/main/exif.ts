/**
 * 极简 EXIF 解析器：从 sharp metadata().exif（TIFF/EXIF Buffer）提取常用字段。
 * 不引入第三方依赖，只解析 IFD0 的 Make/Model/DateTime 和 ExifIFD 的光圈/快门/ISO/焦距。
 */

export interface ExifInfo {
  make?: string
  model?: string
  dateTime?: string
  fNumber?: number
  exposureTime?: number
  iso?: number
  focalLength?: number
}

// EXIF/TIFF 类型常量
const TYPE_ASCII = 2
const TYPE_SHORT = 3
const TYPE_LONG = 4
const TYPE_RATIONAL = 5

// ExifIFD 指针在 IFD0 中的 tag
const TAG_EXIF_IFD = 0x8769
// IFD0 字段
const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_DATETIME = 0x0132
// ExifIFD 字段
const TAG_FNUMBER = 0x829d
const TAG_EXPOSURE_TIME = 0x829a
const TAG_ISO = 0x8827
const TAG_FOCAL_LENGTH = 0x920a

function readUint16(buf: Buffer, offset: number, little: boolean): number {
  return little ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset)
}
function readUint32(buf: Buffer, offset: number, little: boolean): number {
  return little ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset)
}

/** 解析一个 IFD，返回 tag->value 的映射（仅取需要的字段） */
function parseIfd(
  buf: Buffer,
  ifdOffset: number,
  little: boolean,
  tiffStart: number,
  wanted: Set<number>
): Map<number, number | string> {
  const result = new Map<number, number | string>()
  const count = readUint16(buf, ifdOffset, little)
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12
    if (entryOffset + 12 > buf.length) break
    const tag = readUint16(buf, entryOffset, little)
    if (!wanted.has(tag)) continue
    const type = readUint16(buf, entryOffset + 2, little)
    const valueOffset = entryOffset + 8
    if (type === TYPE_ASCII) {
      // ASCII：长度<=4 内联，否则值字段是指针
      const num = readUint32(buf, entryOffset + 4, little)
      let strOffset = valueOffset
      if (num > 4) strOffset = tiffStart + readUint32(buf, valueOffset, little)
      if (strOffset < buf.length) {
        let s = buf.toString('ascii', strOffset, strOffset + num - 1).trim()
        // 去掉末尾 \0 后的乱码
        s = s.replace(/\0.*$/, '')
        result.set(tag, s)
      }
    } else if (type === TYPE_SHORT) {
      result.set(tag, readUint16(buf, valueOffset, little))
    } else if (type === TYPE_LONG) {
      result.set(tag, readUint32(buf, valueOffset, little))
    } else if (type === TYPE_RATIONAL) {
      // RATIONAL：8 字节（分子+分母），值字段是指针
      const ptr = tiffStart + readUint32(buf, valueOffset, little)
      if (ptr + 8 <= buf.length) {
        const num = readUint32(buf, ptr, little)
        const den = readUint32(buf, ptr + 4, little)
        result.set(tag, den !== 0 ? num / den : 0)
      }
    }
  }
  return result
}

/** 从 sharp 的 exif Buffer 解析出常用 EXIF 字段 */
export function parseExif(exifBuf: Buffer | undefined): ExifInfo | null {
  if (!exifBuf || exifBuf.length < 8) return null
  // EXIF 以 "Exif\0\0" 开头（6 字节），后面是 TIFF 数据
  let tiffStart = 0
  if (exifBuf.length >= 6 && exifBuf.toString('ascii', 0, 4) === 'Exif') {
    tiffStart = 6
  }
  const buf = exifBuf
  // TIFF header：字节序标记 + magic + IFD0 偏移
  const byteOrder = buf.toString('ascii', tiffStart, tiffStart + 2)
  const little = byteOrder === 'II'
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null
  const ifd0Offset = tiffStart + readUint32(buf, tiffStart + 4, little)
  if (ifd0Offset + 2 > buf.length) return null

  const ifd0Wanted = new Set([TAG_MAKE, TAG_MODEL, TAG_DATETIME, TAG_EXIF_IFD])
  const ifd0 = parseIfd(buf, ifd0Offset, little, tiffStart, ifd0Wanted)

  const info: ExifInfo = {}
  if (ifd0.has(TAG_MAKE)) info.make = ifd0.get(TAG_MAKE) as string
  if (ifd0.has(TAG_MODEL)) info.model = ifd0.get(TAG_MODEL) as string
  if (ifd0.has(TAG_DATETIME)) info.dateTime = ifd0.get(TAG_DATETIME) as string

  // 解析 ExifIFD（如果存在）
  if (ifd0.has(TAG_EXIF_IFD)) {
    const exifIfdOffset = tiffStart + (ifd0.get(TAG_EXIF_IFD) as number)
    if (exifIfdOffset + 2 <= buf.length) {
      const exifWanted = new Set([TAG_FNUMBER, TAG_EXPOSURE_TIME, TAG_ISO, TAG_FOCAL_LENGTH])
      const exifIfd = parseIfd(buf, exifIfdOffset, little, tiffStart, exifWanted)
      if (exifIfd.has(TAG_FNUMBER)) info.fNumber = exifIfd.get(TAG_FNUMBER) as number
      if (exifIfd.has(TAG_EXPOSURE_TIME)) info.exposureTime = exifIfd.get(TAG_EXPOSURE_TIME) as number
      if (exifIfd.has(TAG_ISO)) info.iso = exifIfd.get(TAG_ISO) as number
      if (exifIfd.has(TAG_FOCAL_LENGTH)) info.focalLength = exifIfd.get(TAG_FOCAL_LENGTH) as number
    }
  }

  // 至少有一个字段才算有效
  return Object.keys(info).length > 0 ? info : null
}
