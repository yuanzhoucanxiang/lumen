import { existsSync } from 'fs'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { createReadStream } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { spawn } from 'child_process'
import { cpus } from 'os'
import { app } from 'electron'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { readPsd, initializeCanvas } from 'ag-psd'
import * as fontkit from 'fontkit'
import { getDb } from './db'
import { getLibraryPath } from './library'
import { renderAiThumb } from './aiThumb'
import { stmt } from './stmtCache'
import { logger } from './logger'
import { parseExif } from './exif'
import { computeNamePinyin } from './pinyin'
import type { ImportResult } from '../shared/types'

// Electron 主进程无 DOM canvas：注入纯 JS ImageData 工厂，
// 使 ag-psd 无需 node-canvas 原生依赖即可解码 PSD 合成图
initializeCanvas(
  () => {
    throw new Error('no canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
)

const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'tiff', 'tif', 'psd', 'ai', 'heic', 'heif'
])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'])
const FONT_EXTS = new Set(['ttf', 'otf', 'ttc', 'woff', 'woff2'])

export interface ImportOptions {
  /** 来源链接（浏览器剪藏时记录） */
  sourceUrl?: string
  /** true = 导入后删除源文件 */
  move?: boolean
  /** true = 查重时检查 deleted_files tombstone(已删除文件不再自动重导入)。
   *  监控/启动同步设 true;用户主动导入(对话框/拖拽/剪藏)不设,允许重新导入已删文件 */
  checkTombstone?: boolean
  /** true = 结果附带逐文件明细 files(Agent /import 需要;其余渠道省内存不填) */
  detail?: boolean
  /** 导入来源标记:'' = 用户手动;agent/clip/watcher/startup/screenshot(支撑来源统计/筛选) */
  source?: string
  /** 导入进度回调:阶段 A 每完成一个文件触发一次('prepare'),阶段 B 事务提交后触发一次('commit') */
  onProgress?: (phase: 'prepare' | 'commit', done: number, total: number) => void
}

export function assetKindOf(ext: string): 'image' | 'video' | 'audio' | 'other' {
  const e = ext.toLowerCase()
  if (IMAGE_EXTS.has(e)) return 'image'
  if (VIDEO_EXTS.has(e)) return 'video'
  if (AUDIO_EXTS.has(e)) return 'audio'
  return 'other'
}

/**
 * 浏览器"另存为网页"产生的资源夹判定:X_files 且同级存在 X.html / X.htm。
 * 这类目录装的全是页面碎片（站标/头像/缩略图,实测一次保存 = 971 张 72px 小图），
 * 监控文件夹递归或手动导入都不应吞进来（里程碑 170）。
 * 签名足够精确（同名 html 兄弟文件）——普通叫 xxx_files 的素材文件夹不受影响；
 * 夹内单个文件仍可直接指定路径导入。
 */
function isWebSaveAssetsDir(dirPath: string): boolean {
  if (!dirPath.endsWith('_files')) return false
  const base = dirPath.slice(0, -'_files'.length)
  return existsSync(`${base}.html`) || existsSync(`${base}.htm`)
}

/** 文件是否位于网页保存资源夹内（沿父级链向上查，含子目录）。
 *  watcher 的实时文件事件不经过 collectFiles，需要独立判定（里程碑 170）。 */
export function isInWebSaveDir(filePath: string, maxUp = 8): boolean {
  let dir = dirname(filePath)
  for (let i = 0; i < maxUp; i++) {
    if (isWebSaveAssetsDir(dir)) return true
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return false
}

/** 递归展开路径列表，返回所有可导入的文件路径（异步遍历，不阻塞主进程）。
 *  同一批调用里的重叠路径（目录+目录内文件 / 同一路径传两次）会展开出重复条目，
 *  而阶段 A 并发准备时彼此不可见（尚未提交），重复条目会把同一文件入库两次 —— 按路径归一去重兜底。 */
export async function collectFiles(paths: string[], acc: string[] = []): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  const keyOf = (p: string) =>
    process.platform === 'win32' ? p.replace(/\//g, '\\').toLowerCase() : p
  const walk = async (p: string): Promise<void> => {
    let st
    try {
      st = await stat(p)
    } catch {
      return // 路径不存在/不可访问(与原 existsSync 预检语义一致)
    }
    if (st.isDirectory()) {
      if (isWebSaveAssetsDir(p)) return // 网页保存资源夹:整夹跳过
      for (const e of await readdir(p, { withFileTypes: true })) {
        // 跳过符号链接/junction:目录联接可指向库外,递归会把外部目录整棵搬进库(Windows 建 junction 无需特权)
        if (e.isSymbolicLink()) continue
        await walk(join(p, e.name))
      }
    } else {
      const key = keyOf(p)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(p)
      }
    }
  }
  for (const p of paths) await walk(p)
  acc.push(...out)
  return acc
}

/**
 * 文件内容 SHA-256（流式，不整文件进内存）。导入与查重核实共用。
 * 用 sha256 作判重终审：dHash 是"长得像"，同名同大小只是"形似"，
 * 两者都不能证明是同一个文件——GIR 连续样张这类画面相似的图会被 dHash 误判。里程碑 182
 */
async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(path)
    s.on('data', (c) => h.update(c))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

/** 库内已有素材的内容哈希（本次会话内存缓存；存量记录没存列时按需现算，不回写数据库）。
 *  查重发生在"阶段 A 不写数据库"期间，故缓存只在内存。 */
const assetShaCache = new Map<string, string>()

/** 库内素材的**原始导入文件**路径（刻意不含编辑版）。查重要比的是"导入时那份字节"，
 *  编辑过的素材回退到未编辑原图，才能和导入时写入的 sha256 对上。
 *  这里不引 repository/assetPaths：本模块与 repository 已有反向依赖，避免形成循环。 */
function storedOriginalPath(id: string): string | null {
  const row = stmt(getDb(), 'SELECT rel_dir, ext FROM assets WHERE id = ?').get(id) as
    | { rel_dir: string; ext: string }
    | undefined
  if (!row) return null
  return join(getLibraryPath(), row.rel_dir, `${id}.${row.ext || 'file'}`)
}

async function assetSha256(id: string): Promise<string> {
  const hit = assetShaCache.get(id)
  if (hit) return hit
  const row = getDb().prepare('SELECT sha256 FROM assets WHERE id = ?').get(id) as { sha256?: string } | undefined
  if (!row) return ''
  if (row.sha256) {
    assetShaCache.set(id, row.sha256)
    return row.sha256
  }
  const p = storedOriginalPath(id)
  if (!p) return ''
  try {
    const h = await sha256File(p)
    if (h) assetShaCache.set(id, h)
    return h
  } catch {
    return ''
  }
}

/**
 * 查重：判断文件是否已在库中或已被删除，并给出命中素材 id。
 * - ⓪ sha256 精确命中活跃记录（新导入素材都带内容哈希，一步定案）
 * - ① name+size 候选活跃记录 → **sha256 核实内容**才判重（同名同大小的不同文件不再误判）
 * - ② dHash+size 候选活跃记录（AI 改名后 name 变但画面不变）→ 同样要 sha256 核实
 * - ③ tombstone（仅 checkTombstone）：之前删过的文件不再自动重导入
 *   图片走 hash+size，非图片回退 name+size（删除后无文件可比，只能沿用旧判据）
 *
 * 核实失败（读不到文件/算不出哈希）时**不判重**——宁可多导入一份，也不能悄悄吞掉一张图。
 */
async function classifyExisting(
  name: string,
  size: number,
  dhash: string,
  srcSha: string,
  checkTombstone: boolean
): Promise<{ dup: boolean; matchedId: string | null }> {
  const db = getDb()
  // ⓪ 内容精确命中（新导入素材都写了 sha256，这一步就够）
  if (srcSha) {
    const exact = stmt(db, 'SELECT id FROM assets WHERE sha256 = ? AND deleted_at IS NULL LIMIT 1').get(srcSha) as
      | { id: string }
      | undefined
    if (exact) return { dup: true, matchedId: exact.id }
  }
  // ① name+size 候选 → 内容核实（主要覆盖升级前导入、sha256 列为空的存量素材）
  const byName = stmt(
    db,
    'SELECT id, sha256 FROM assets WHERE name = ? AND size = ? AND deleted_at IS NULL LIMIT 8'
  ).all(name, size) as { id: string; sha256: string }[]
  for (const c of byName) {
    const stored = c.sha256 || (await assetSha256(c.id))
    if (srcSha && stored && stored === srcSha) return { dup: true, matchedId: c.id }
  }
  // ② dHash+size 候选（改名/跨目录同名不同内容时的兜底）→ 内容核实
  if (dhash) {
    const byHash = stmt(
      db,
      'SELECT id, sha256 FROM assets WHERE hash = ? AND size = ? AND deleted_at IS NULL LIMIT 8'
    ).all(dhash, size) as { id: string; sha256: string }[]
    for (const c of byHash) {
      const stored = c.sha256 || (await assetSha256(c.id))
      if (srcSha && stored && stored === srcSha) return { dup: true, matchedId: c.id }
    }
    // tombstone：已删除的图片（仅监控/启动同步检查）
    if (checkTombstone) {
      if (stmt(db, 'SELECT 1 FROM deleted_files WHERE hash = ? AND size = ? LIMIT 1').get(dhash, size))
        return { dup: true, matchedId: null }
    }
  }
  // ③ 无 hash 的 tombstone 回退（视频/PSD/字体）：按 name+size
  if (checkTombstone) {
    if (stmt(db, 'SELECT 1 FROM deleted_files WHERE name = ? AND size = ? LIMIT 1').get(name, size))
      return { dup: true, matchedId: null }
  }
  return { dup: false, matchedId: null }
}

/** 只读查重:name+size 是否命中活跃素材(validate 试运行渠道用,不解码不算哈希)。
 *  试运行只做"预估"，不读文件内容，故这里保持粗判据（宁可少报跳过，不误报跳过）。 */
export function isKnownAssetByNameSize(name: string, size: number): boolean {
  return !!stmt(
    getDb(),
    'SELECT 1 FROM assets WHERE name = ? AND size = ? AND deleted_at IS NULL LIMIT 1'
  ).get(name, size)
}

/* ---------------- 并发控制（自写极简池，不引入新依赖） ---------------- */

/**
 * 安全删除临时文件：Windows 上 ffmpeg 刚写完的文件可能被 Defender 实时扫描短暂锁定，
 * rm 会抛 EPERM。这里重试几次（每次 150ms），仍失败只记 debug 日志，绝不阻断主流程。
 */
async function rmSafe(p: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await rm(p, { force: true })
      return
    } catch (e) {
      if (i === 4) {
        logger.debug('[importer]', `临时文件删除失败(重试5次) ${p}: ${(e as Error).message}`)
        return
      }
      // 异步等待 150ms 再重试(不阻塞主进程事件循环)
      await new Promise((r) => setTimeout(r, 150))
    }
  }
}

/** 按 limit 并发执行 fn，保持结果顺序。limit <= 1 时退化为串行。 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

/** 阶段 A 产出：一个已复制到库内、缩略图/主色/dHash 已计算完毕的待提交记录 */
interface PreparedAsset {
  status: 'ok' | 'skip' | 'fail'
  filePath: string
  name: string
  /** 仅 status='ok' 时有效 */
  id?: string
  /** 仅 status='skip' 且命中库内活跃素材时有效(tombstone 跳过无 id) */
  matchedId?: string
  relDir?: string
  absDir?: string
  ext?: string
  size?: number
  width?: number
  height?: number
  colors?: number[][]
  hash?: string
  mtimeMs?: number
  sourceUrl?: string
  exif?: string
  /** 文件内容 SHA-256（里程碑 182，查重终审判据） */
  sha256?: string
  /** 移动导入：提交成功后要删的源文件路径（失败则保留，绝不提前删） */
  moveSource?: string
}

/** 提取图片主色调：降采样后统计量化颜色，返回最多 4 个 [r,g,b] */
export async function extractColors(input: string | Buffer): Promise<number[][]> {
  try {
    const { data } = await sharp(input)
      .resize(32, 32, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const counts = new Map<string, { n: number; r: number; g: number; b: number }>()
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`
      const c = counts.get(key)
      if (c) {
        c.n++; c.r += r; c.g += g; c.b += b
      } else {
        counts.set(key, { n: 1, r, g, b })
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 4)
      .map((c) => [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)])
  } catch (e) {
    logger.debug('[importer]', `extractColors 失败: ${(e as Error).message}`)
    return []
  }
}

/** dHash 感知哈希（9x8 灰度差分，64 位），用于相似图片检测 */
export async function computeDHash(input: string | Buffer): Promise<string> {
  try {
    const { data } = await sharp(input)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let hash = ''
    for (let y = 0; y < 8; y++) {
      let byte = 0
      for (let x = 0; x < 8; x++) {
        if (data[y * 9 + x] < data[y * 9 + x + 1]) byte |= 1 << (7 - x)
      }
      hash += byte.toString(16).padStart(2, '0')
    }
    return hash
  } catch (e) {
    logger.debug('[importer]', `computeDHash 失败: ${(e as Error).message}`)
    return ''
  }
}

/** 用 ag-psd 读取 PSD 合成图（保存时需勾选「最大兼容性」才有），返回 RGBA raw */
async function psdToRaw(
  filePath: string
): Promise<{ data: Buffer; width: number; height: number } | null> {
  try {
    const psd = readPsd(await readFile(filePath), { useImageData: true, skipThumbnail: true })
    const img = psd.imageData
    if (!img || img.width <= 0 || img.height <= 0) return null
    return {
      data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength),
      width: img.width,
      height: img.height
    }
  } catch (e) {
    logger.warn('[importer]', `PSD 解码失败 ${filePath}: ${(e as Error).message}`)
    return null
  }
}

/** 用 fontkit 渲染字体样张（SVG 内嵌字形轮廓 → sharp 出图），无需 DOM canvas */
async function renderFontThumb(
  filePath: string
): Promise<{ data: Buffer; width: number; height: number } | null> {
  try {
    const opened = fontkit.openSync(filePath) as fontkit.Font | fontkit.FontCollection
    const font: fontkit.Font = 'fonts' in opened ? opened.fonts[0] : opened
    const upm = font.unitsPerEm || 1000
    const hasCjk = font.hasGlyphForCodePoint(0x66f8) // 「书」
    const sample = hasCjk ? '拾光 Aa 123' : 'Aa Bb Rr 123'

    const W = 512
    const H = 256
    const marginX = 32
    const glyphs = [...font.glyphsForString(sample)]

    // 单行自适应：先按 96px 量总宽，超宽则整体缩小字号
    let fontSize = 96
    let scale = fontSize / upm
    const spacing = () => fontSize * 0.06
    let totalAdv = 0
    for (const g of glyphs) totalAdv += g.advanceWidth * scale + spacing()
    const maxW = W - marginX * 2
    if (totalAdv > maxW) {
      fontSize = Math.max(36, Math.floor(fontSize * (maxW / totalAdv)))
      scale = fontSize / upm
    }

    const baseline = 170
    let x = marginX
    const paths: string[] = []
    for (const glyph of glyphs) {
      const adv = glyph.advanceWidth * scale
      if (glyph.path.commands.length > 0) {
        paths.push(
          `<path d="${glyph.path.toSVG()}" fill="#d5dbe2" transform="translate(${x.toFixed(1)},${baseline.toFixed(1)}) scale(${scale.toFixed(4)},${(-scale).toFixed(4)})"/>`
        )
      }
      x += adv + spacing()
    }
    const family = (font.fullName ?? font.familyName ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="#0d0f12"/>
      <text x="${marginX}" y="32" font-family="sans-serif" font-size="16" fill="#57626d">${family}</text>
      ${paths.join('\n')}
    </svg>`
    const data = await sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer()
    return { data, width: W, height: H }
  } catch (e) {
    logger.warn('[importer]', `字体样张渲染失败 ${filePath}: ${(e as Error).message}`)
    return null
  }
}

/**
 * 给 sharp 喂图：先按文件路径（零拷贝、可流式），失败再把整张读成 buffer 重试一次。
 * 需要兜底的原因：libvips 的 heif 输入只登记了 .avif 后缀，.heic/.heif 走文件路径会被
 * 按后缀分流直接拒掉；从 buffer 输入则让 libvips 自己嗅 ftyp 容器识别。
 */
async function withSharp<T>(path: string, fn: (input: string | Buffer) => Promise<T>): Promise<T> {
  try {
    return await fn(path)
  } catch (e) {
    logger.debug('[importer]', `按路径解码失败，改从 buffer 重试 ${basename(path)}: ${(e as Error).message}`)
    return await fn(await readFile(path))
  }
}

/** 512px 内的缩略图 JPEG（依据 EXIF 方向旋转，与尺寸/主色/哈希同源） */
function jpegThumb(path: string): Promise<Buffer> {
  return withSharp(path, (input) =>
    sharp(input)
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()
  )
}

/** ffmpeg 路径（打包后位于 asar.unpacked） */
function ffmpegBin(): string | null {
  if (!ffmpegPath) return null
  return app.isPackaged ? ffmpegPath.replace('app.asar', 'app.asar.unpacked') : ffmpegPath
}

/** 用 ffmpeg 提取视频指定时间点的帧（默认首帧） */
async function extractVideoFrame(videoPath: string, outPath: string, seekSec?: number): Promise<boolean> {
  const bin = ffmpegBin()
  if (!bin) return false
  return new Promise((resolve) => {
    const args = ['-y']
    if (seekSec !== undefined) args.push('-ss', String(seekSec))
    args.push('-i', videoPath, '-frames:v', '1', '-vf', 'scale=512:-2', outPath)
    const p = spawn(bin, args, {
      windowsHide: true,
      stdio: 'ignore'
    })
    const timer = setTimeout(() => {
      p.kill()
      resolve(false)
    }, 15000)
    p.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

/**
 * 获取视频时长（秒）。
 * 注意：ffmpeg-static 只打包 ffmpeg.exe 不带 ffprobe，所以用 `ffmpeg -i` 探测——
 * 格式信息输出到 stderr，解析其中的 Duration 行。
 */
function getVideoDuration(videoPath: string): number {
  const bin = ffmpegBin()
  if (!bin) return 0
  try {
    const result = require('child_process').spawnSync(bin, ['-i', videoPath], {
      windowsHide: true,
      encoding: 'utf-8',
      timeout: 10000
    })
    const m = (result.stderr ?? '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (!m) return 0
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])
  } catch {
    return 0
  }
}

/**
 * 生成视频故事板：提取 4 个时间点（10%/35%.60%.85%）的帧，
 * 用 sharp 拼成横向 2x2 网格 storyboard.jpg。
 */
async function generateStoryboard(videoPath: string, absDir: string, duration: number): Promise<void> {
  if (duration <= 0) return
  const positions = [0.1, 0.35, 0.6, 0.85].map((p) => duration * p)
  const frames: Buffer[] = []
  for (const sec of positions) {
    const tmpPath = join(absDir, `_sb_${sec}.jpg`)
    const ok = await extractVideoFrame(videoPath, tmpPath, sec)
    if (ok && existsSync(tmpPath)) {
      try {
        const buf = await sharp(tmpPath).resize(256, 144, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
        frames.push(buf)
      } catch { /* ignore */ }
      await rmSafe(tmpPath)
    }
  }
  if (frames.length < 2) return // 至少 2 帧才拼故事板
  // 2x2 网格拼接（不足 4 帧时补空）
  while (frames.length < 4) frames.push(Buffer.alloc(0))
  const W = 256 * 2
  const H = 144 * 2
  const composites = frames.slice(0, 4).map((buf, i) => ({
    input: buf,
    top: Math.floor(i / 2) * 144,
    left: (i % 2) * 256
  })).filter((c) => c.input.length > 0)
  await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 13, g: 15, b: 18 } }
  }).composite(composites).jpeg({ quality: 80 }).toFile(join(absDir, 'storyboard.jpg'))
}

/**
 * 阶段 A：复制文件到库内 + 生成缩略图/主色/dHash/视频封面/字体样张。
 * 可并发调用（sharp/ffmpeg/fontkit 互不影响）。不写数据库。
 */
async function prepareOne(filePath: string, opts: ImportOptions): Promise<PreparedAsset> {
  try {
    const name = basename(filePath)
    const ext = extname(filePath).slice(1).toLowerCase()
    const st = await stat(filePath)
    const kind = assetKindOf(ext)
    const checkTombstone = !!opts.checkTombstone

    // 文件内容哈希(里程碑 182):查重的终审判据,同时写进素材记录供以后核实
    let srcSha = ''
    try {
      srcSha = await sha256File(filePath)
    } catch (e) {
      logger.debug('[importer]', `内容哈希计算失败 ${name}: ${(e as Error).message}`)
    }

    // 快速预检:name+size 有候选 -> sha256 核实内容才判重(同名同大小的不同文件不再被吞)
    const quick = await classifyExisting(name, st.size, '', srcSha, false)
    if (quick.dup) {
      return { status: 'skip', filePath, name, matchedId: quick.matchedId ?? undefined }
    }

    // 图片:从源文件预算缩略图 + 哈希(与已存储哈希同源:512 缩略图 -> dHash),
    // 用 hash 做二次查重(AI 改名/已删除都能命中)。算出的 thumbBuf 复用写入磁盘。
    // psd 走 ag-psd 不经过 sharp,不预算;ai 走 mupdf,预算结果连渲染产物一起复用。
    let preThumbBuf: Buffer | null = null
    let preHash = ''
    let preAi: Awaited<ReturnType<typeof renderAiThumb>> = null
    if (kind === 'image' && ext !== 'svg' && ext !== 'psd') {
      try {
        if (ext === 'ai') {
          preAi = await renderAiThumb(filePath)
          preThumbBuf = preAi?.jpeg ?? null
        } else {
          preThumbBuf = await jpegThumb(filePath)
        }
        if (preThumbBuf) preHash = await computeDHash(preThumbBuf)
      } catch (e) {
        /* 预算失败(损坏图/缺解码器的 exotic 格式)留空,后续正式流程再降级处理 */
        logger.debug('[importer]', `预算缩略图失败 ${name}: ${(e as Error).message}`)
      }
    }
    // 二次查重(dHash 候选 + 可选 tombstone):命中候选后仍要 sha256 核实,避免相似画面误判
    const second = await classifyExisting(name, st.size, preHash, srcSha, checkTombstone)
    if (second.dup) {
      return { status: 'skip', filePath, name, matchedId: second.matchedId ?? undefined }
    }

    const id = randomUUID().replace(/-/g, '').slice(0, 16)
    const relDir = join('assets', id.slice(0, 2), id)
    const absDir = join(getLibraryPath(), relDir)
    await mkdir(absDir, { recursive: true })

    const originalName = `${id}.${ext || 'file'}`
    const targetPath = join(absDir, originalName)
    await copyFile(filePath, targetPath)
    // 移动导入的源文件不在这里删（本函数属"不写数据库"的阶段 A）：
    // 提交失败时源文件已消失、库里也没记录 = 两头落空。改由 importFiles 在事务提交成功后删。里程碑 182
    const moveSource = opts.move ? filePath : ''

    let width = 0
    let height = 0
    let colors: number[][] = []
    let hash = preHash
    let exifJson = ''

    if (kind === 'image' && ext !== 'svg') {
      try {
        let thumbBuf: Buffer | null = preThumbBuf
        if (ext === 'psd') {
          // PSD:源文件无法直接 sharp,从已复制的 targetPath 取合成图(ag-psd)
          const raw = await psdToRaw(targetPath)
          if (!raw) throw new Error('psd: no composite image')
          width = raw.width
          height = raw.height
          thumbBuf = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
            .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toBuffer()
        } else if (ext === 'ai') {
          // AI:勾选过「最大兼容性」的文件本体是 PDF,sharp 解不了,交给 mupdf 渲染首页
          const r = preAi ?? (await renderAiThumb(targetPath))
          if (!r) throw new Error('ai: 文件无 PDF 兼容层(保存时未勾选最大兼容性)')
          width = r.width
          height = r.height
          thumbBuf = r.jpeg
        } else {
          const meta = await withSharp(targetPath, (input) => sharp(input).metadata())
          width = meta.width ?? 0
          height = meta.height ?? 0
          const exifInfo = parseExif(meta.exif)
          if (exifInfo) exifJson = JSON.stringify(exifInfo)
          // 复用预算的 thumbBuf,否则现算(预算失败过的图走同一条兜底管线)
          thumbBuf = thumbBuf ?? (await jpegThumb(targetPath))
        }
        await writeFile(join(absDir, 'thumbnail.jpg'), thumbBuf)
        colors = await extractColors(thumbBuf)
        if (!hash) hash = await computeDHash(thumbBuf) // PSD/AI 或预算失败时补算
      } catch (e) {
        /* 缩略图失败不阻断导入（如 PSD 无合成图/未开最大兼容性的 AI/损坏图） */
        logger.warn('[importer]', `缩略图生成失败 ${name}: ${(e as Error).message}`)
      }
    } else if (kind === 'video') {
      // 提取首帧作为封面，并从封面读取尺寸/主色
      const framePath = join(absDir, '_frame.jpg')
      const okFrame = await extractVideoFrame(targetPath, framePath)
      if (okFrame && existsSync(framePath)) {
        try {
          const meta = await sharp(framePath).metadata()
          width = meta.width ?? 0
          height = meta.height ?? 0
          colors = await extractColors(framePath)
          await sharp(framePath)
            .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toFile(join(absDir, 'thumbnail.jpg'))
          // 生成故事板（4 帧拼图，用于悬停预览）
          const duration = getVideoDuration(targetPath)
          if (duration > 2) {
            try {
              await generateStoryboard(targetPath, absDir, duration)
            } catch (e) {
              logger.warn('[importer]', `故事板生成失败 ${name}: ${(e as Error).message}`)
            }
          }
        } catch (e) {
          logger.warn('[importer]', `视频封面处理失败 ${name}: ${(e as Error).message}`)
        } finally {
          await rmSafe(framePath)
        }
      }
    } else if (FONT_EXTS.has(ext)) {
      // 字体：渲染样张作为缩略图（fontkit 字形轮廓 -> SVG -> sharp）
      try {
        const thumb = await renderFontThumb(targetPath)
        if (thumb) {
          width = thumb.width
          height = thumb.height
          await writeFile(join(absDir, 'thumbnail.jpg'), thumb.data)
          colors = await extractColors(thumb.data)
          hash = await computeDHash(thumb.data)
        }
      } catch (e) {
        /* 字体解析失败降级为格式图标 */
        logger.warn('[importer]', `字体缩略图写入失败 ${name}: ${(e as Error).message}`)
      }
    }

    return {
      status: 'ok',
      filePath,
      name,
      id,
      relDir,
      absDir,
      ext,
      size: st.size,
      width,
      height,
      colors,
      hash,
      mtimeMs: st.mtimeMs,
      sourceUrl: opts.sourceUrl,
      exif: exifJson,
      sha256: srcSha,
      moveSource
    }
  } catch (e) {
    logger.error('[importer]', `导入失败 ${filePath}: ${(e as Error).message}`)
    return { status: 'fail', filePath, name: basename(filePath) }
  }
}

/**
 * 阶段 B：把一批已准备好的记录原子写入数据库 + metadata.json。
 * 用 better-sqlite3 事务包裹 DB 写入，任一失败整批回滚（已复制的文件保留，下次启动 isDuplicate 会判重）。
 * metadata.json 写盘与 DB 原子性无关，移出事务后异步写（单文件失败仅告警不回滚，行为不变）。
 */
async function commitBatch(records: PreparedAsset[], source = ''): Promise<void> {
  const db = getDb()
  const insert = stmt(
    db,
    `INSERT INTO assets (id, name, ext, rel_dir, size, width, height, colors, color_count, hash, star, comment, url, created_at, imported_at, exif, name_pinyin, name_pinyin_init, source, sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const now = Date.now()
  const run = db.transaction((recs: PreparedAsset[]) => {
    for (const r of recs) {
      const py = computeNamePinyin(r.name)
      insert.run(
        r.id, r.name, r.ext, r.relDir, r.size, r.width, r.height,
        JSON.stringify(r.colors), r.colors ? r.colors.length : 0, r.hash, r.sourceUrl ?? '', r.mtimeMs, now, r.exif ?? '',
        py.full, py.initial, source, r.sha256 ?? ''
      )
    }
  })
  run(records)
  // 附带 metadata.json（与 Eagle 格式兼容的基础元数据）
  for (const r of records) {
    const metaJson = {
      id: r.id, name: r.name, ext: r.ext, size: r.size, width: r.width, height: r.height,
      colors: r.colors, star: 0, annotation: '', url: r.sourceUrl ?? '',
      palettes: r.colors, modificationTime: now, creationTime: r.mtimeMs
    }
    try {
      await writeFile(join(r.absDir!, 'metadata.json'), JSON.stringify(metaJson, null, 2), 'utf-8')
    } catch (e) {
      logger.warn('[importer]', `metadata.json 写入失败 ${r.name}: ${(e as Error).message}`)
    }
  }
}

export async function importFiles(paths: string[], opts: ImportOptions = {}): Promise<ImportResult> {
  const files = await collectFiles(paths)
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, failedFiles: [] }
  if (files.length === 0) return result

  // 阶段 A：并发复制 + 计算（IO/CPU 密集，按 CPU 核心数并发）；每完成一个文件推一次进度
  const concurrency = Math.max(1, cpus().length)
  let done = 0
  const prepared = await mapWithConcurrency(files, concurrency, async (f) => {
    const r = await prepareOne(f, opts)
    done++
    opts.onProgress?.('prepare', done, files.length)
    return r
  })

  // 分离 ok 记录 vs skip/fail
  const okRecords: PreparedAsset[] = []
  for (const r of prepared) {
    if (r.status === 'ok') okRecords.push(r)
    else if (r.status === 'skip') result.skipped++
    else {
      result.failed++
      result.failedFiles!.push(r.name)
    }
  }

  // 跳过的重复文件回填命中的库内素材 id（Agent 渠道幂等补打标签/归档用）
  const matchedIds = new Set<string>()
  for (const r of prepared) {
    if (r.status === 'skip' && r.matchedId) matchedIds.add(r.matchedId)
  }
  if (matchedIds.size > 0) result.matchedIds = [...matchedIds]
  if (opts.detail) {
    result.files = prepared.map((r) => ({
      path: r.filePath,
      name: r.name,
      status: r.status === 'ok' ? 'imported' : r.status === 'skip' ? 'skipped' : 'failed',
      id: r.status === 'ok' ? r.id : r.matchedId
    }))
  }

  // 阶段 B：事务原子写入数据库 + metadata.json（串行，任一失败整批回滚）
  if (okRecords.length > 0) {
    try {
      await commitBatch(okRecords, opts.source ?? '')
      result.imported = okRecords.length
      result.importedIds = okRecords.map((r) => r.id!)
      // 移动导入的源文件此刻才删：数据库已确认落库，删源文件不会再"两头落空"（里程碑 182）。
      // 若在提交后、删除前崩溃，只是源文件多留一份（宁可重复，不可丢失）。
      if (opts.move) {
        for (const r of okRecords) {
          if (!r.moveSource) continue
          try {
            await rm(r.moveSource, { force: true })
          } catch (e) {
            logger.warn('[importer]', `移动导入:源文件删除失败 ${r.moveSource}: ${(e as Error).message}`)
          }
        }
      }
    } catch (e) {
      // 事务失败（DB 磁盘满/损坏等极端情况）：整批算失败，已复制文件保留待重试
      logger.error('[importer]', `事务提交失败，${okRecords.length} 条记录回滚: ${(e as Error).message}`)
      result.failed += okRecords.length
      for (const r of okRecords) result.failedFiles!.push(r.name)
    }
  }
  // 阶段 B 完成：推一次 commit 进度（渲染层据此收尾进度卡片）
  opts.onProgress?.('commit', files.length, files.length)

  return result
}
