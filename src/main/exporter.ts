import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { assetPaths } from './repository'
import { getDb } from './db'
import type { ExportOptions } from '../shared/types'

/** 文件名去重：a.jpg → a (1).jpg（同时避开目标目录已存在的文件） */
function uniqueName(name: string, taken: Set<string>, dir?: string): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  if (!taken.has(name) && !(dir && existsSync(join(dir, name)))) {
    taken.add(name)
    return name
  }
  for (let i = 1; i < 1000; i++) {
    const n = `${stem} (${i})${ext}`
    if (!taken.has(n) && !(dir && existsSync(join(dir, n)))) {
      taken.add(n)
      return n
    }
  }
  return `${stem}_${Date.now()}${ext}`
}

/** 清洗文件名/文件夹名中的非法字符（Windows 保留字符） */
function safePathSegment(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').trim() || '_'
}

/* ---------------- 纯 JS ZIP（store 无压缩，图片类素材压不动） ---------------- */

let CRC_TABLE: Int32Array | null = null
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Buffer
}

function zipStore(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8')
    const crc = crc32(e.data)

    // Local file header（bit 11 = UTF-8 文件名）
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4) // version needed
    lh.writeUInt16LE(0x0800, 6) // flags: UTF-8
    lh.writeUInt16LE(0, 8) // method: store
    lh.writeUInt16LE(0, 10) // mod time
    lh.writeUInt16LE(0x21, 12) // mod date (1980-01-01)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(e.data.length, 18)
    lh.writeUInt32LE(e.data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    locals.push(lh, nameBuf, e.data)

    // Central directory
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(e.data.length, 20)
    cd.writeUInt32LE(e.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    centrals.push(cd, nameBuf)

    offset += lh.length + nameBuf.length + e.data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuf, end])
}

/* ---------------- 导出 ---------------- */

interface ExportAssetInfo {
  id: string
  name: string
  ext: string
  size: number
  width: number
  height: number
  star: number
  comment: string
  url: string
  /** 第一个标签名（按名称排序，无标签为空串），供命名模板/分文件夹用 */
  firstTag: string
}

function loadAssets(ids: string[]): ExportAssetInfo[] {
  const placeholders = ids.map(() => '?').join(',')
  return getDb()
    .prepare(
      `SELECT id, name, ext, size, width, height, star, comment, url,
              (SELECT t.name FROM asset_tags at JOIN tags t ON t.id = at.tag_id
               WHERE at.asset_id = assets.id ORDER BY t.name LIMIT 1) AS firstTag
       FROM assets WHERE id IN (${placeholders})`
    )
    .all(...ids) as ExportAssetInfo[]
}

/** 按命名模板生成文件名(不含目录) */
function buildName(a: ExportAssetInfo, index: number, naming: ExportOptions['naming']): string {
  const stem = a.name.replace(/\.[^.]+$/, '')
  const tag = a.firstTag || '未分类'
  switch (naming) {
    case 'tag_name':
      return `${safePathSegment(tag)}_${safePathSegment(stem)}.${a.ext}`
    case 'tag_index':
      return `${safePathSegment(tag)}_${String(index).padStart(3, '0')}.${a.ext}`
    case 'name_index':
      return `${safePathSegment(stem)}_${String(index).padStart(3, '0')}.${a.ext}`
    default:
      return a.name
  }
}

/** 目标子目录（按标签分组时） */
function subDir(a: ExportAssetInfo, opts: ExportOptions): string {
  return opts.groupByTag ? safePathSegment(a.firstTag || '未分类') : ''
}

/** 复制到文件夹（支持命名模板 + 按标签分文件夹；不同子目录同名不互相加重名后缀） */
export function exportToFolder(ids: string[], dir: string, opts: ExportOptions): number {
  const assets = loadAssets(ids)
  const takenByDir = new Map<string, Set<string>>()
  let n = 0
  for (const a of assets) {
    const paths = assetPaths(a.id)
    if (!paths) continue
    const sub = subDir(a, opts)
    const targetDir = sub ? join(dir, sub) : dir
    if (sub) mkdirSync(targetDir, { recursive: true })
    let taken = takenByDir.get(targetDir)
    if (!taken) {
      taken = new Set()
      takenByDir.set(targetDir, taken)
    }
    const name = buildName(a, n + 1, opts.naming)
    const target = join(targetDir, uniqueName(name, taken, targetDir))
    copyFileSync(paths.original, target)
    n++
  }
  return n
}

/** 打包为 ZIP（原文件 + metadata.json 清单，支持命名模板 + 按标签分文件夹） */
export function exportToZip(ids: string[], zipPath: string, opts: ExportOptions): number {
  const assets = loadAssets(ids)
  const takenByDir = new Map<string, Set<string>>()
  const entries: ZipEntry[] = []
  const meta: unknown[] = []
  for (const a of assets) {
    const paths = assetPaths(a.id)
    if (!paths) continue
    const sub = subDir(a, opts)
    const name = buildName(a, meta.length + 1, opts.naming)
    const zipDir = sub || ''
    let taken = takenByDir.get(zipDir)
    if (!taken) {
      taken = new Set()
      takenByDir.set(zipDir, taken)
    }
    const finalName = uniqueName(name, taken)
    const zipName = sub ? `${sub}/${finalName}` : finalName
    entries.push({ name: zipName, data: readFileSync(paths.original) })
    meta.push({
      file: zipName,
      id: a.id,
      ext: a.ext,
      size: a.size,
      width: a.width,
      height: a.height,
      star: a.star,
      comment: a.comment,
      url: a.url
    })
  }
  entries.push({ name: 'metadata.json', data: Buffer.from(JSON.stringify(meta, null, 2), 'utf-8') })
  writeFileSync(zipPath, zipStore(entries))
  return entries.length - 1
}
