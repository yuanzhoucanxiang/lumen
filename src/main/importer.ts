import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { app } from 'electron'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { readPsd, initializeCanvas } from 'ag-psd'
import * as fontkit from 'fontkit'
import { getDb } from './db'
import { getLibraryPath } from './library'
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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
    return null
  }
}

/** ffmpeg 路径（打包后位于 asar.unpacked） */
function ffmpegBin(): string | null {
  if (!ffmpegPath) return null
  return app.isPackaged ? ffmpegPath.replace('app.asar', 'app.asar.unpacked') : ffmpegPath
}

/** 用 ffmpeg 提取视频首帧作为封面 */
async function extractVideoFrame(videoPath: string, outPath: string): Promise<boolean> {
  const bin = ffmpegBin()
  if (!bin) return false
  return new Promise((resolve) => {
    const p = spawn(bin, ['-y', '-i', videoPath, '-frames:v', '1', '-vf', 'scale=512:-2', outPath], {
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

async function importOne(filePath: string, opts: ImportOptions): Promise<'ok' | 'skip' | 'fail'> {
  try {
    const name = basename(filePath)
    const ext = extname(filePath).slice(1).toLowerCase()
    const st = statSync(filePath)
    if (isDuplicate(name, st.size)) return 'skip'

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
        }
        const thumbBuf = await base
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer()
        writeFileSync(join(absDir, 'thumbnail.jpg'), thumbBuf)
        colors = await extractColors(thumbBuf)
        hash = await computeDHash(thumbBuf)
      } catch {
        /* 缩略图失败不阻断导入（如 PSD 无合成图/AI/HEIC 部分格式） */
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
        } catch {
          /* ignore */
        } finally {
          rmSync(framePath, { force: true })
        }
      }
    } else if (FONT_EXTS.has(ext)) {
      // 字体：渲染样张作为缩略图（fontkit 字形轮廓 → SVG → sharp）
      try {
        const thumb = await renderFontThumb(targetPath)
        if (thumb) {
          width = thumb.width
          height = thumb.height
          writeFileSync(join(absDir, 'thumbnail.jpg'), thumb.data)
          colors = await extractColors(thumb.data)
          hash = await computeDHash(thumb.data)
        }
      } catch {
        /* 字体解析失败降级为格式图标 */
      }
    }

    const now = Date.now()
    getDb()
      .prepare(
        `INSERT INTO assets (id, name, ext, rel_dir, size, width, height, colors, hash, star, comment, url, created_at, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?)`
      )
      .run(id, name, ext, relDir, st.size, width, height, JSON.stringify(colors), hash, opts.sourceUrl ?? '', st.mtimeMs, now)

    // 附带 metadata.json（与 Eagle 格式兼容的基础元数据）
    const metaJson = {
      id, name, ext, size: st.size, width, height,
      colors, star: 0, annotation: '', url: opts.sourceUrl ?? '',
      palettes: colors, modificationTime: now, creationTime: st.mtimeMs
    }
    try {
      writeFileSync(join(absDir, 'metadata.json'), JSON.stringify(metaJson, null, 2), 'utf-8')
    } catch {
      /* ignore */
    }
    return 'ok'
  } catch {
    return 'fail'
  }
}

export async function importFiles(paths: string[], opts: ImportOptions = {}): Promise<ImportResult> {
  const files = collectFiles(paths)
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0 }
  for (const f of files) {
    const r = await importOne(f, opts)
    if (r === 'ok') result.imported++
    else if (r === 'skip') result.skipped++
    else result.failed++
  }
  return result
}
