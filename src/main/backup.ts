import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { getDb } from './db'
import { getLibraryPath } from './library'
import { logger } from './logger'

/* ---------------- 纯 JS ZIP 写入器（与 exporter.ts 同算法，store 无压缩） ---------------- */

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
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    lh.writeUInt16LE(0, 8) // store
    lh.writeUInt16LE(0, 10)
    lh.writeUInt16LE(0x21, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(e.data.length, 18)
    lh.writeUInt32LE(e.data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    locals.push(lh, nameBuf, e.data)
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

/* ---------------- 备份 ---------------- */

/**
 * 备份数据库到 library.db.bak（同目录，覆盖旧备份）。
 * 使用 better-sqlite3 的 backup API 在线热备，不阻塞读写。
 */
export function backupDatabase(): string {
  const libPath = getLibraryPath()
  const target = join(libPath, 'library.db.bak')
  const db = getDb()
  db.backup(target)
  logger.info('[backup]', `数据库已备份到 ${target}`)
  return target
}

/** 递归收集目录下所有文件，返回相对库根目录的路径 */
function collectFiles(dir: string, base: string, acc: { rel: string; abs: string }[]): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      collectFiles(abs, base, acc)
    } else {
      acc.push({ rel: relative(base, abs).replace(/\\/g, '/'), abs })
    }
  }
}

/**
 * 把整个当前库目录打包成 ZIP（含 assets 原图 + 缩略图 + library.db）。
 * 用于完整灾难恢复。返回写入的文件数。
 */
export function backupLibraryToZip(zipPath: string): number {
  const libPath = getLibraryPath()
  const files: { rel: string; abs: string }[] = []
  collectFiles(libPath, libPath, files)

  const entries: ZipEntry[] = []
  let count = 0
  for (const f of files) {
    try {
      entries.push({ name: f.rel, data: readFileSync(f.abs) })
      count++
    } catch (e) {
      logger.warn('[backup]', `跳过无法读取的文件 ${f.rel}: ${(e as Error).message}`)
    }
  }
  writeFileSync(zipPath, zipStore(entries))
  logger.info('[backup]', `完整库已备份到 ${zipPath}（${count} 个文件）`)
  return count
}
