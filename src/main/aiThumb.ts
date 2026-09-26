/**
 * AI 素材首页位图渲染。
 *
 * Illustrator 文件在保存时勾选「最大兼容性」后，本体就是一枚 PDF；而 sharp 所用的
 * libvips 构建关掉了 PDF 输入（sharp.format.pdf.input === false），Electron 自带的
 * PDF 渲染也不可用（loadURL 直接 ERR_FAILED），所以此前 .ai 只能退回格式图标。
 * 这里用 mupdf（wasm，无原生模块、不参与 electron-rebuild）解首页补上缩略图。
 *
 * wasm 约 10MB，只在真的遇到 .ai 时才惰性加载。
 */
import { readFile } from 'fs/promises'
import { basename } from 'path'
import sharp from 'sharp'
import { logger } from './logger'

type MuPdfModule = typeof import('mupdf')

let loading: Promise<MuPdfModule | null> | null = null

function loadMupdf(): Promise<MuPdfModule | null> {
  if (!loading) {
    loading = import('mupdf').catch((e) => {
      logger.warn('[aiThumb]', `mupdf 加载失败，AI 素材退回格式图标: ${(e as Error).message}`)
      return null
    })
  }
  return loading
}

/**
 * 把 AI/PDF 首页渲染成 512px 内的 JPEG 缩略图。
 * 未勾选最大兼容性的 .ai 是 PostScript 流，mupdf 打不开 → 返回 null 走原有降级路径。
 */
export async function renderAiThumb(
  filePath: string,
  maxSide = 512
): Promise<{ jpeg: Buffer; width: number; height: number } | null> {
  try {
    const mupdf = await loadMupdf()
    if (!mupdf) return null
    const bytes = new Uint8Array(await readFile(filePath))
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
    try {
      if (doc.countPages() < 1) return null
      const page = doc.loadPage(0)
      const [x0, y0, x1, y1] = page.getBounds()
      const w = Math.max(1, x1 - x0)
      const h = Math.max(1, y1 - y0)
      const scale = maxSide / Math.max(w, h)
      const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true)
      const png = pix.asPNG()
      pix.destroy()
      page.destroy()
      // PDF 页面本身无背景色，透明页压白底后再出 JPEG（JPEG 不支持 alpha）
      const jpeg = await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()
      const meta = await sharp(jpeg).metadata()
      return {
        jpeg,
        width: meta.width ?? Math.round(w * scale),
        height: meta.height ?? Math.round(h * scale)
      }
    } finally {
      doc.destroy()
    }
  } catch (e) {
    logger.debug('[aiThumb]', `AI 首页渲染失败 ${basename(filePath)}: ${(e as Error).message}`)
    return null
  }
}
