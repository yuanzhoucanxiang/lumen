/**
 * 纯 JS ZIP(store 无压缩)共享库:写入/读取/流式写入。
 * 原先 exporter.ts 与 backup.ts 各持一份复制实现,现统一于此。
 * 图片类素材 store 与 deflate 压缩比几乎无差,故写入始终用 store;
 * 读取兼容 store(0)/deflate(8),可解开其他工具重压缩过的文件。
 */
import { createReadStream } from 'fs'
import { createWriteStream } from 'fs'
import type { Writable } from 'stream'
import { inflateRawSync } from 'zlib'

/* ---------------- CRC32 ---------------- */

let CRC_TABLE: Int32Array | null = null
function table(): Int32Array {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  return CRC_TABLE
}

export function crc32(buf: Buffer): number {
  const t = table()
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 流式 CRC32:逐块喂入,finish 取最终值 */
export function crc32Stream() {
  const t = table()
  let c = 0xffffffff
  return {
    update(chunk: Buffer): void {
      for (let i = 0; i < chunk.length; i++) c = t[(c ^ chunk[i]) & 0xff] ^ (c >>> 8)
    },
    finish(): number {
      return (c ^ 0xffffffff) >>> 0
    }
  }
}

/* ---------------- 内存式写入(小批量:metadata/清单/.lumenboard) ---------------- */

export interface ZipEntry {
  name: string
  data: Buffer
}

/** ZIP64 限制守卫(条目数/单条目大小/文件名长度),超限明确报错而非静默截断 */
function zip64Guard(count: number, name: string, size: number, nameLen: number): void {
  if (count > 65535) throw new Error('ZIP 条目数超出 65535(不支持 ZIP64),请分批导出')
  if (size > 0xffffffff) throw new Error(`ZIP 条目超过 4GB(不支持 ZIP64): ${name}`)
  if (nameLen > 65535) throw new Error(`ZIP 文件名过长: ${name}`)
}

/** 纯 JS ZIP 写入(store 无压缩) */
export function zipStore(entries: ZipEntry[]): Buffer {
  if (entries.length > 65535) throw new Error('ZIP 条目数超出 65535(不支持 ZIP64),请分批导出')
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8')
    zip64Guard(entries.length, e.name, e.data.length, nameBuf.length)
    const crc = crc32(e.data)

    // Local file header(bit 11 = UTF-8 文件名)
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

    centrals.push(centralEntry(nameBuf, crc, e.data.length, offset))
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

/** 中央目录条目(46 字节 + 文件名) */
function centralEntry(nameBuf: Buffer, crc: number, size: number, offset: number): Buffer {
  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt16LE(20, 4)
  cd.writeUInt16LE(20, 6)
  cd.writeUInt16LE(0x0800, 8)
  cd.writeUInt16LE(0, 10)
  cd.writeUInt16LE(0, 12)
  cd.writeUInt16LE(0x21, 14)
  cd.writeUInt32LE(crc, 16)
  cd.writeUInt32LE(size, 20)
  cd.writeUInt32LE(size, 24)
  cd.writeUInt16LE(nameBuf.length, 28)
  cd.writeUInt16LE(0, 30)
  cd.writeUInt16LE(0, 32)
  cd.writeUInt16LE(0, 34)
  cd.writeUInt16LE(0, 36)
  cd.writeUInt32LE(0, 38)
  cd.writeUInt32LE(offset, 42)
  return Buffer.concat([cd, nameBuf])
}

/** 本地文件头(30 字节 + 文件名) */
function localHeader(nameBuf: Buffer, crc: number, size: number): Buffer {
  const lh = Buffer.alloc(30)
  lh.writeUInt32LE(0x04034b50, 0)
  lh.writeUInt16LE(20, 4)
  lh.writeUInt16LE(0x0800, 6)
  lh.writeUInt16LE(0, 8)
  lh.writeUInt16LE(0, 10)
  lh.writeUInt16LE(0x21, 12)
  lh.writeUInt32LE(crc, 14)
  lh.writeUInt32LE(size, 18)
  lh.writeUInt32LE(size, 22)
  lh.writeUInt16LE(nameBuf.length, 26)
  lh.writeUInt16LE(0, 28)
  return Buffer.concat([lh, nameBuf])
}

/* ---------------- 流式写入(大库备份/大批导出:逐文件过流,不整库进内存) ---------------- */

/** 流式条目:data = 内存内容(小文件/清单),filePath = 磁盘文件(大文件,两遍法:先算 CRC 再复制) */
export interface ZipStreamEntry {
  name: string
  data?: Buffer
  filePath?: string
}

const STREAM_CHUNK = 16 * 1024 * 1024

/** 等待 WriteStream 排空(backpressure);完成后移除监听,避免累积触发 MaxListeners 告警 */
function drain(ws: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = (): void => {
      ws.off('error', onError)
      resolve()
    }
    const onError = (e: Error): void => {
      ws.off('drain', onDrain)
      reject(e)
    }
    ws.once('drain', onDrain)
    ws.once('error', onError)
  })
}

async function writeChunk(ws: Writable, chunk: Buffer): Promise<void> {
  if (!ws.write(chunk)) await drain(ws)
}

/** 逐块读文件并回调(回调可异步,for await 原生背压:回调未完成即暂停读取);返回总字节数 */
async function scanFile(
  filePath: string,
  onChunk: (b: Buffer) => void | Promise<void>
): Promise<number> {
  let total = 0
  for await (const b of createReadStream(filePath, { highWaterMark: STREAM_CHUNK })) {
    total += b.length
    await onChunk(b)
  }
  return total
}

/**
 * 流式写 ZIP(store):逐条目写入 out,内存占用仅中央目录(每条目 ~46+文件名字节)。
 * 文件条目两遍法:第一遍算 CRC32/字节数,第二遍流式复制--本地头写真实 CRC/size,
 * 与内存式输出字节完全一致(zipStore/zipRead/系统解压工具全兼容)。
 * 返回成功写入的条目数。
 */
export async function zipStoreStream(entries: ZipStreamEntry[], out: Writable): Promise<number> {
  if (entries.length > 65535) throw new Error('ZIP 条目数超出 65535(不支持 ZIP64),请分批导出')
  const centrals: Buffer[] = []
  let offset = 0
  let count = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8')
    let crc: number
    let size: number
    if (e.data !== undefined) {
      zip64Guard(entries.length, e.name, e.data.length, nameBuf.length)
      crc = crc32(e.data)
      size = e.data.length
      await writeChunk(out, localHeader(nameBuf, crc, size))
      await writeChunk(out, e.data)
    } else if (e.filePath !== undefined) {
      // 第一遍:CRC 与大小
      const h = crc32Stream()
      size = await scanFile(e.filePath, (b) => h.update(b))
      zip64Guard(entries.length, e.name, size, nameBuf.length)
      crc = h.finish()
      // 第二遍:写头 + 流式复制(逐块等待 backpressure,不整文件进内存)
      await writeChunk(out, localHeader(nameBuf, crc, size))
      await scanFile(e.filePath, async (b) => {
        if (!out.write(b)) await drain(out)
      })
    } else {
      throw new Error(`ZIP 条目缺 data/filePath: ${e.name}`)
    }
    centrals.push(centralEntry(nameBuf, crc, size, offset))
    offset += 30 + nameBuf.length + size
    count++
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  await writeChunk(out, centralBuf)
  await writeChunk(out, end)
  return count
}

/** 便捷封装:流式写出到文件路径 */
export async function zipStoreStreamToFile(entries: ZipStreamEntry[], zipPath: string): Promise<number> {
  const ws = createWriteStream(zipPath)
  const errPromise = new Promise<never>((_, reject) => ws.once('error', reject))
  try {
    const result = await Promise.race([zipStoreStream(entries, ws), errPromise])
    await new Promise<void>((resolve, reject) => ws.end((err?: Error | null) => (err ? reject(err) : resolve())))
    return result
  } catch (e) {
    ws.destroy()
    throw e
  }
}

/* ---------------- 读取 ---------------- */

/**
 * 纯 JS ZIP 读取(.lumenboard 用):解析 EOCD + 中央目录 + 本地头。
 * 支持 store(0) 与 deflate(8) 两种压缩方式,兼容其他工具重压缩过的文件。
 * 目录条目忽略;CRC32 校验 + 数据越界检查(损坏/伪造数据在此拦截)。
 */
export function zipRead(buf: Buffer): Map<string, Buffer> {
  // 从尾部倒查 EOCD 签名(注释最长 65535 字节)。
  // ZIP 注释区在真 EOCD 之后,倒查可能先命中注释内容里的假签名,
  // 命中后用 EOCD 里的 cdSize/cdOffset 做自洽校验,不通过则继续向前找
  let eocd = -1
  const searchStart = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      const cdSize = buf.readUInt32LE(i + 12)
      const cdOffset = buf.readUInt32LE(i + 16)
      // 中央目录需完整落在文件内
      if (cdOffset + cdSize <= buf.length) {
        eocd = i
        break
      }
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件')
  const entryCount = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
    const method = buf.readUInt16LE(cdOffset + 10)
    const crc = buf.readUInt32LE(cdOffset + 16)
    const compSize = buf.readUInt32LE(cdOffset + 20)
    const nameLen = buf.readUInt16LE(cdOffset + 28)
    const extraLen = buf.readUInt16LE(cdOffset + 30)
    const commentLen = buf.readUInt16LE(cdOffset + 32)
    const localOffset = buf.readUInt32LE(cdOffset + 42)
    const name = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf-8')
    // 跳过目录条目
    if (!name.endsWith('/')) {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP 本地头损坏')
      const lNameLen = buf.readUInt16LE(localOffset + 26)
      const lExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lNameLen + lExtraLen
      // 越界即报错(伪造/截断的文件不得静默返回截断数据)
      if (dataStart < 0 || dataStart + compSize > buf.length) throw new Error(`ZIP 数据越界: ${name}`)
      const data = buf.subarray(dataStart, dataStart + compSize)
      let content: Buffer
      if (method === 0) content = Buffer.from(data)
      else if (method === 8) content = inflateRawSync(data)
      else throw new Error(`不支持的 ZIP 压缩方式: ${method}`)
      // CRC32 校验:损坏数据在此拦截,避免把坏图当新素材走导入管线入库
      if (crc32(content) !== crc) throw new Error(`ZIP 数据校验失败(CRC32): ${name}`)
      out.set(name, content)
    }
    cdOffset += 46 + nameLen + extraLen + commentLen
  }
  return out
}
