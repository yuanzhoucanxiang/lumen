/**
 * 流式 ZIP 备份验证脚本(后端优化阶段 3):
 *   1) 字节等价:同一批文件,内存式 zipStore(旧实现逻辑,此处内联复刻)与
 *      zipStoreStreamToFile(新实现)输出逐字节一致 -- 证明格式零变化,兼容所有解压工具。
 *   2) 真库冒烟:对当前素材库跑一次流式备份,zipRead 回读校验条目数/CRC。
 *
 * 纯脚本不走 CDP;better-sqlite3 未用到,但主进程代码是 TS,故直接对编译前源码
 * 做等价复刻验证(算法逐行一致)。用法:
 *   node scripts/bench-backup.cjs            # 等价性 + 真库冒烟
 *   node scripts/bench-backup.cjs --mem      # 额外输出大文件流式写入的堆内存快照
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

/* ---- 旧实现复刻(exporter.ts 流式化前的 zipStore,逐行一致) ---- */
let CRC_TABLE = null
function crc32(buf) {
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
function zipStoreOld(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8')
    const crc = crc32(e.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x0800, 6)
    lh.writeUInt16LE(0, 8)
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

/* ---- zipRead 复刻(zipLib.ts 逐行一致,用于回读校验) ---- */
const { inflateRawSync } = require('zlib')
function zipRead(buf) {
  let eocd = -1
  const searchStart = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      const cdSize = buf.readUInt32LE(i + 12)
      const cdOffset = buf.readUInt32LE(i + 16)
      if (cdOffset + cdSize <= buf.length) { eocd = i; break }
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件')
  const entryCount = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)
  const out = new Map()
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
    if (!name.endsWith('/')) {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP 本地头损坏')
      const lNameLen = buf.readUInt16LE(localOffset + 26)
      const lExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lNameLen + lExtraLen
      if (dataStart < 0 || dataStart + compSize > buf.length) throw new Error('ZIP 数据越界: ' + name)
      const data = buf.subarray(dataStart, dataStart + compSize)
      const content = method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : null
      if (!content) throw new Error('不支持的 ZIP 压缩方式: ' + method)
      if (crc32(content) !== crc) throw new Error('ZIP 数据校验失败(CRC32): ' + name)
      out.set(name, content)
    }
    cdOffset += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function main() {
  let failed = 0
  const ok = (m) => console.log('  ✓', m)
  const fail = (m) => { console.error('  ✗', m); failed++ }

  /* ---------- 1. 字节等价:内存式 vs 流式 ---------- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-zip-'))
  const mk = (name, size) => {
    const p = path.join(tmp, name)
    const buf = Buffer.alloc(size)
    for (let i = 0; i < size; i++) buf[i] = (i * 31 + name.length * 7) & 0xff
    fs.writeFileSync(p, buf)
    return p
  }
  // 混合大小:小清单/中等图/大视频替代(>16MB 跨块边界验证分块读写)
  const fa = mk('a.txt', 1024)
  const fb = mk('b.bin', 512 * 1024)
  const fc = mk('c.big', 20 * 1024 * 1024 + 12345)
  const entries = [
    { name: 'metadata.json', data: Buffer.from(JSON.stringify({ hello: '流式' }, null, 2), 'utf-8') },
    { name: '中文目录/文件 a.txt', filePath: fa },
    { name: 'b.bin', filePath: fb },
    { name: 'big/c.big', filePath: fc }
  ]
  const oldBuf = zipStoreOld([
    { name: 'metadata.json', data: entries[0].data },
    { name: '中文目录/文件 a.txt', data: fs.readFileSync(fa) },
    { name: 'b.bin', data: fs.readFileSync(fb) },
    { name: 'big/c.big', data: fs.readFileSync(fc) }
  ])

  // 流式实现直接从 zipLib.ts 现场转译(esbuild,node 内置依赖可 bundle),
  // 保证验证的是真实源码而非手工镜像
  const esbuild = require('esbuild')
  const zipLibTs = path.join(__dirname, '..', 'src', 'main', 'zipLib.ts')
  const zipLibJs = path.join(tmp, 'zipLib.cjs')
  esbuild.buildSync({
    entryPoints: [zipLibTs],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: zipLibJs
  })
  const zipLib = require(zipLibJs)
  const newPath = path.join(tmp, 'new.zip')
  const memBefore = process.memoryUsage().heapUsed
  const count = await zipLib.zipStoreStreamToFile(entries, newPath)
  const memAfter = process.memoryUsage().heapUsed
  const newBuf = fs.readFileSync(newPath)

  if (count === 4) ok(`流式写入 4 个条目`)
  else fail(`流式写入条目数异常: ${count}`)
  if (oldBuf.equals(newBuf)) ok(`输出与旧内存式实现逐字节一致(${newBuf.length} 字节)`)
  else fail(`输出与旧实现不一致! old=${oldBuf.length} new=${newBuf.length}`)

  const back = zipRead(newBuf)
  if (back.size === 4 && back.get('中文目录/文件 a.txt').length === 1024) ok(`zipRead 回读 4 条目含中文名,CRC 全过`)
  else fail(`zipRead 回读异常: ${back.size}`)

  if (process.argv.includes('--mem')) {
    console.log(`  堆内存变化: ${(memAfter / 1048576).toFixed(1)}MB(含 20MB 文件条目,旧实现需 ~60MB+)`)
  }

  /* ---------- 2. 真库冒烟:流式备份当前素材库并回读 ---------- */
  const cfgPath = path.join(process.env.APPDATA || '', 'LUMEN', 'config.json')
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    const lib = cfg.current
    const files = []
    const walk = (dir) => {
      for (const n of fs.readdirSync(dir)) {
        const abs = path.join(dir, n)
        const st = fs.statSync(abs)
        if (st.isDirectory()) walk(abs)
        else files.push({ rel: path.relative(lib, abs).replace(/\\/g, '/'), abs })
      }
    }
    walk(lib)
    const libZip = path.join(tmp, 'lib.zip')
    const mem0 = process.memoryUsage().heapUsed
    const n = await zipLib.zipStoreStreamToFile(files.map((f) => ({ name: f.rel, filePath: f.abs })), libZip)
    const mem1 = process.memoryUsage().heapUsed
    const rd = zipRead(fs.readFileSync(libZip))
    ok(`真库流式备份 ${n} 个文件,回读 ${rd.size} 条目全部 CRC 通过`)
    console.log(`  库总大小 ${(fs.statSync(libZip).size / 1048576).toFixed(1)}MB,备份期间堆增长 ${((mem1 - mem0) / 1048576).toFixed(1)}MB`)
  } else {
    console.log('  (跳过真库冒烟:无 config.json)')
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(failed === 0 ? '\n✓ 全部通过' : `\n${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('BENCH CRASH:', e)
  process.exit(1)
})
