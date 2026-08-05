import { existsSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import { getDb } from './db'
import { getLibraryPath } from './library'
import { logger } from './logger'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

/** 提取主色调（与导入管线一致的量化算法） */
async function extractColors(input: Buffer): Promise<number[][]> {
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
    logger.debug('[editor]', `extractColors 失败: ${(e as Error).message}`)
    return []
  }
}

/**
 * 应用编辑器结果：保留原图，编辑结果写入 {id}.edited.{ext}。
 * ext 恒指向原图格式；编辑版格式单独存 edited_ext（渲染层 dataUrl 的 MIME 决定）。
 */
export async function applyEdit(id: string, dataUrl: string): Promise<void> {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) throw new Error('invalid dataUrl')
  const mime = m[1]
  const buffer = Buffer.from(m[2], 'base64')
  const newExt = MIME_EXT[mime] ?? 'png'

  const row = getDb().prepare('SELECT rel_dir, ext, edited_ext FROM assets WHERE id = ?').get(id) as
    | { rel_dir: string; ext: string; edited_ext: string }
    | undefined
  if (!row) throw new Error('asset not found')

  const dir = join(getLibraryPath(), row.rel_dir)
  const editedPath = join(dir, `${id}.edited.${newExt}`)

  // 若旧编辑版扩展名与本次不同，清理旧文件（如之前 edited.jpg，这次导出 png）
  const oldEditedExt = row.edited_ext || row.ext
  if (oldEditedExt !== newExt) {
    const oldEdited = join(dir, `${id}.edited.${oldEditedExt}`)
    if (existsSync(oldEdited)) rmSync(oldEdited, { force: true })
  }
  // 写入编辑结果（首次创建，后续覆盖此文件；原图 {id}.{ext} 保留不动）
  writeFileSync(editedPath, buffer)

  // 重新生成缩略图与元数据（与导入管线一致：缩略图 buffer 传给 extractColors）
  const meta = await sharp(buffer).metadata()
  const thumbBuf = await sharp(buffer)
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  writeFileSync(join(dir, 'thumbnail.jpg'), thumbBuf)
  const colors = await extractColors(thumbBuf)

  // ext 保持原图格式不变，编辑版格式记入 edited_ext
  getDb()
    .prepare(
      'UPDATE assets SET edited = 1, edited_ext = ?, size = ?, width = ?, height = ?, colors = ? WHERE id = ?'
    )
    .run(newExt, buffer.length, meta.width ?? 0, meta.height ?? 0, JSON.stringify(colors), id)
}

/**
 * 恢复原图：删除编辑版文件，从原图（{id}.{ext}）重新生成缩略图/主色/尺寸。
 */
export async function revertEdit(id: string): Promise<void> {
  const row = getDb()
    .prepare('SELECT rel_dir, ext, edited_ext FROM assets WHERE id = ?')
    .get(id) as { rel_dir: string; ext: string; edited_ext: string } | undefined
  if (!row) throw new Error('asset not found')

  const dir = join(getLibraryPath(), row.rel_dir)
  const ext = row.ext || 'file'
  const editedExt = row.edited_ext || row.ext || 'file'
  const editedPath = join(dir, `${id}.edited.${editedExt}`)
  const originalPath = join(dir, `${id}.${ext}`)

  if (!existsSync(originalPath)) {
    throw new Error('原图文件不存在，无法恢复')
  }

  // 删除编辑版本
  if (existsSync(editedPath)) rmSync(editedPath, { force: true })

  // 从原图重新生成缩略图/主色/尺寸
  const meta = await sharp(originalPath).metadata()
  const thumbBuf = await sharp(originalPath)
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  writeFileSync(join(dir, 'thumbnail.jpg'), thumbBuf)
  const colors = await extractColors(thumbBuf)

  const size = statSync(originalPath).size
  getDb()
    .prepare(
      'UPDATE assets SET edited = 0, edited_ext = \'\', size = ?, width = ?, height = ?, colors = ? WHERE id = ?'
    )
    .run(size, meta.width ?? 0, meta.height ?? 0, JSON.stringify(colors), id)

  logger.info('[editor]', `已恢复原图 ${id}`)
}
