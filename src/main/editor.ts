import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import { getDb } from './db'
import { getLibraryPath } from './library'

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
  } catch {
    return []
  }
}

/**
 * 应用编辑器结果：覆盖原图文件，重新生成缩略图/主色/尺寸。
 * dataUrl 的 MIME 决定新格式（jpg/png/webp），若与原格式不同会更新扩展名。
 */
export async function applyEdit(id: string, dataUrl: string): Promise<void> {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) throw new Error('invalid dataUrl')
  const mime = m[1]
  const buffer = Buffer.from(m[2], 'base64')
  const newExt = MIME_EXT[mime] ?? 'png'

  const row = getDb().prepare('SELECT rel_dir, ext FROM assets WHERE id = ?').get(id) as
    | { rel_dir: string; ext: string }
    | undefined
  if (!row) throw new Error('asset not found')

  const dir = join(getLibraryPath(), row.rel_dir)
  rmSync(join(dir, `${id}.${row.ext}`), { force: true })
  writeFileSync(join(dir, `${id}.${newExt}`), buffer)

  // 重新生成缩略图与元数据
  const meta = await sharp(buffer).metadata()
  await sharp(buffer)
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(join(dir, 'thumbnail.jpg'))
  const colors = await extractColors(buffer)

  getDb()
    .prepare('UPDATE assets SET ext = ?, size = ?, width = ?, height = ?, colors = ? WHERE id = ?')
    .run(newExt, buffer.length, meta.width ?? 0, meta.height ?? 0, JSON.stringify(colors), id)
}
