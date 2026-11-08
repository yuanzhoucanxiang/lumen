/**
 * 多档预览缓存（里程碑 222，借鉴 MOTZ 白板的 LOD 方案）：
 * 白板放大时按"显示尺寸 × 缩放 × DPR"选择 640/1280/2048/3072 中的一档，
 * 由主进程从原图按需生成并缓存，避免每次都解码整张原图（大图显存/解码压力）。
 * 缓存落在 userData/preview-cache，不污染素材库目录、也不会被监控扫描到。
 */
import { app } from 'electron'
import { existsSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import { logger } from './logger'

export const PREVIEW_LEVELS = [640, 1280, 2048, 3072] as const
export type PreviewLevel = (typeof PREVIEW_LEVELS)[number]

/** 能被 sharp 稳定解码的静态图；GIF 排除（要保留动图）、视频/音频走缩略图与故事板 */
const LOD_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'avif', 'tif', 'tiff'])

const inflight = new Map<string, Promise<string | null>>()

export function normalizePreviewLevel(raw: string | null): PreviewLevel | null {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return (PREVIEW_LEVELS as readonly number[]).includes(n) ? (n as PreviewLevel) : null
}

/**
 * 确保某素材某档预览存在，返回缓存文件路径；不可生成（格式不支持/解码失败）返回 null。
 * edited 参与缓存键：素材被编辑后自动生成新档，不会读到旧画面。
 */
export async function ensurePreview(
  id: string,
  level: PreviewLevel,
  originalPath: string,
  edited: number
): Promise<string | null> {
  const ext = originalPath.split('.').pop()?.toLowerCase() ?? ''
  if (!LOD_EXTS.has(ext)) return null
  const dir = join(app.getPath('userData'), 'preview-cache')
  const file = join(dir, `${id}-${level}-${edited}.jpg`)
  if (existsSync(file)) return file
  const running = inflight.get(file)
  if (running) return running

  const task = (async () => {
    try {
      mkdirSync(dir, { recursive: true })
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await sharp(originalPath)
        .rotate()
        .resize({ width: level, height: level, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(tmp)
      renameSync(tmp, file)
      return file
    } catch (e) {
      logger.warn('[preview]', `生成失败 ${id}@${level}: ${(e as Error).message}`)
      return null
    } finally {
      inflight.delete(file)
    }
  })()
  inflight.set(file, task)
  return task
}
