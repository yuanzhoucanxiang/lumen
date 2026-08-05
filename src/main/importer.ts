import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { cpus } from 'os'
import { app } from 'electron'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { readPsd, initializeCanvas } from 'ag-psd'
import * as fontkit from 'fontkit'
import { getDb } from './db'
import { getLibraryPath } from './library'
import { logger } from './logger'
import { parseExif } from './exif'
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
}

export function assetKindOf(ext: string): 'image' | 'video' | 'audio' | 'other' {
  const e = ext.toLowerCase()
  if (IMAGE_EXTS.has(e)) return 'image'
  if (VIDEO_EXTS.has(e)) return 'video'
  if (AUDIO_EXTS.has(e)) return 'audio'
  return 'other'
}

/** 递归展开路径列表，返回所有可导入的文件路径 */
export function collectFiles(paths: string[], acc: string[] = []): string[] {
  for (const p of paths) {
    if (!existsSync(p)) continue
    const st = statSync(p)
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) collectFiles([join(p, name)], acc)
    } else {
      acc.push(p)
    }
  }
  return acc
}

function isDuplicate(name: string, size: number): boolean {
  const row = getDb()
    .prepare('SELECT id FROM assets WHERE name = ? AND size = ? AND deleted_at IS NULL LIMIT 1')
    .get(name, size)
  return !!row
}

/* ---------------- 并发控制（自写极简池，不引入新依赖） ---------------- */

/**
 * 安全删除临时文件：Windows 上 ffmpeg 刚写完的文件可能被 Defender 实时扫描短暂锁定，
 * rmSync 会抛 EPERM。这里重试几次（每次 150ms），仍失败只记 debug 日志，绝不阻断主流程。
 */
function rmSafe(p: string): void {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(p, { force: true })
      return
    } catch (e) {
      if (i === 4) {
        logger.debug('[importer]', `临时文件删除失败(重试5次) ${p}: ${(e as Error).message}`)
        return
      }
      // 同步等待 150ms 再重试
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)
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
    const psd = readPsd(readFileSync(filePath), { useImageData: true, skipThumbnail: true })
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
      rmSafe(tmpPath)
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
    const st = statSync(filePath)
    if (isDuplicate(name, st.size)) return { status: 'skip', filePath, name }

    const id = randomUUID().replace(/-/g, '').slice(0, 16)
    const relDir = join('assets', id.slice(0, 2), id)
    const absDir = join(getLibraryPath(), relDir)
    mkdirSync(absDir, { recursive: true })

    const originalName = `${id}.${ext || 'file'}`
    const targetPath = join(absDir, originalName)
    copyFileSync(filePath, targetPath)
    if (opts.move) rmSync(filePath, { force: true })

    let width = 0
    let height = 0
    let colors: number[][] = []
    let hash = ''
    let exifJson = ''
    const kind = assetKindOf(ext)

    if (kind === 'image' && ext !== 'svg') {
      try {
        let base: sharp.Sharp
        if (ext === 'psd') {
          // PSD：取合成图（ag-psd），无合成图则降级为格式图标
          const raw = await psdToRaw(targetPath)
          if (!raw) throw new Error('psd: no composite image')
          width = raw.width
          height = raw.height
          base = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
        } else {
          const meta = await sharp(targetPath).metadata()
          width = meta.width ?? 0
          height = meta.height ?? 0
          base = sharp(targetPath).rotate() // 依据 EXIF 方向
          // 读取 EXIF 元数据（相机型号/拍摄时间/光圈/快门/ISO/焦距）
          const exifInfo = parseExif(meta.exif)
          if (exifInfo) exifJson = JSON.stringify(exifInfo)
        }
        const thumbBuf = await base
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer()
        writeFileSync(join(absDir, 'thumbnail.jpg'), thumbBuf)
        colors = await extractColors(thumbBuf)
        hash = await computeDHash(thumbBuf)
      } catch (e) {
        /* 缩略图失败不阻断导入（如 PSD 无合成图/AI/HEIC 部分格式） */
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
          rmSafe(framePath)
        }
      }
    } else if (FONT_EXTS.has(ext)) {
      // 字体：渲染样张作为缩略图（fontkit 字形轮廓 -> SVG -> sharp）
      try {
        const thumb = await renderFontThumb(targetPath)
        if (thumb) {
          width = thumb.width
          height = thumb.height
          writeFileSync(join(absDir, 'thumbnail.jpg'), thumb.data)
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
      exif: exifJson
    }
  } catch (e) {
    logger.error('[importer]', `导入失败 ${filePath}: ${(e as Error).message}`)
    return { status: 'fail', filePath, name: basename(filePath) }
  }
}

/**
 * 阶段 B：把一批已准备好的记录原子写入数据库 + metadata.json。
 * 用 better-sqlite3 事务包裹，任一失败整批回滚（已复制的文件保留，下次启动 isDuplicate 会判重）。
 */
function commitBatch(records: PreparedAsset[]): void {
  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO assets (id, name, ext, rel_dir, size, width, height, colors, hash, star, comment, url, created_at, imported_at, exif)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?)`
  )
  const run = db.transaction((recs: PreparedAsset[]) => {
    const now = Date.now()
    for (const r of recs) {
      insert.run(
        r.id, r.name, r.ext, r.relDir, r.size, r.width, r.height,
        JSON.stringify(r.colors), r.hash, r.sourceUrl ?? '', r.mtimeMs, now, r.exif ?? ''
      )
      // 附带 metadata.json（与 Eagle 格式兼容的基础元数据）
      const metaJson = {
        id: r.id, name: r.name, ext: r.ext, size: r.size, width: r.width, height: r.height,
        colors: r.colors, star: 0, annotation: '', url: r.sourceUrl ?? '',
        palettes: r.colors, modificationTime: now, creationTime: r.mtimeMs
      }
      try {
        writeFileSync(join(r.absDir!, 'metadata.json'), JSON.stringify(metaJson, null, 2), 'utf-8')
      } catch (e) {
        logger.warn('[importer]', `metadata.json 写入失败 ${r.name}: ${(e as Error).message}`)
      }
    }
  })
  run(records)
}

export async function importFiles(paths: string[], opts: ImportOptions = {}): Promise<ImportResult> {
  const files = collectFiles(paths)
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, failedFiles: [] }
  if (files.length === 0) return result

  // 阶段 A：并发复制 + 计算（IO/CPU 密集，按 CPU 核心数并发）
  const concurrency = Math.max(1, cpus().length)
  const prepared = await mapWithConcurrency(files, concurrency, (f) => prepareOne(f, opts))

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

  // 阶段 B：事务原子写入数据库 + metadata.json（串行，任一失败整批回滚）
  if (okRecords.length > 0) {
    try {
      commitBatch(okRecords)
      result.imported = okRecords.length
    } catch (e) {
      // 事务失败（DB 磁盘满/损坏等极端情况）：整批算失败，已复制文件保留待重试
      logger.error('[importer]', `事务提交失败，${okRecords.length} 条记录回滚: ${(e as Error).message}`)
      result.failed += okRecords.length
      for (const r of okRecords) result.failedFiles!.push(r.name)
    }
  }

  return result
}
