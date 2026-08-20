import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { getDb } from '../db'
import { getLibraryPath } from '../library'
import { stmt } from '../stmtCache'
import { assetKindOf, computeDHash } from '../importer'
import { computeNamePinyin } from '../pinyin'
import type { Asset, AssetQuery, DupeGroup } from '../../shared/types'

interface AssetRow {
  id: string
  name: string
  ext: string
  rel_dir: string
  size: number
  width: number
  height: number
  colors: string
  star: number
  comment: string
  url: string
  created_at: number
  imported_at: number
  deleted_at: number | null
  edited: number
  exif: string
}

function rowToAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    name: row.name,
    ext: row.ext,
    relDir: row.rel_dir,
    size: row.size,
    width: row.width,
    height: row.height,
    colors: row.colors,
    star: row.star,
    comment: row.comment,
    url: row.url,
    createdAt: row.created_at,
    importedAt: row.imported_at,
    deletedAt: row.deleted_at,
    edited: row.edited ?? 0,
    exif: row.exif ?? '',
    tagIds: [],
    tagNames: []
  }
}

function attachTags(assets: Asset[]): void {
  if (assets.length === 0) return
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT at.asset_id AS assetId, at.tag_id AS tagId, t.name AS tagName
       FROM asset_tags at JOIN tags t ON t.id = at.tag_id
       WHERE at.asset_id IN (${assets.map(() => '?').join(',')})`
    )
    .all(...assets.map((a) => a.id)) as { assetId: string; tagId: number; tagName: string }[]
  const map = new Map<string, Asset>()
  assets.forEach((a) => map.set(a.id, a))
  for (const r of rows) {
    const a = map.get(r.assetId)
    if (a) {
      a.tagIds.push(r.tagId)
      a.tagNames.push(r.tagName)
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function matchColor(colorsJson: string, target: [number, number, number], tolerance: number): boolean {
  try {
    const colors = JSON.parse(colorsJson) as number[][]
    // tolerance 0-100 映射为 RGB 欧氏距离阈值
    const threshold = (tolerance / 100) * 255 * 1.2
    return colors.some(([r, g, b]) => {
      const d = Math.sqrt((r - target[0]) ** 2 + (g - target[1]) ** 2 + (b - target[2]) ** 2)
      return d <= threshold
    })
  } catch {
    return false
  }
}
export function queryAssets(q: AssetQuery): Asset[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []

  if (q.deleted) where.push('deleted_at IS NOT NULL')
  else where.push('deleted_at IS NULL')

  if (q.keyword) {
    // 拼音/模糊搜索(对标 Eagle):关键词含字母时,额外匹配全拼与首字母串
    // (去空格/连字符再 LIKE,如「人物造型」首字母 rwzx 可命中;中文关键词不加拼音分支避免无效 LIKE)
    if (/[a-z]/i.test(q.keyword)) {
      where.push(`(name LIKE ? OR comment LIKE ? OR (name_pinyin != '' AND (name_pinyin LIKE ? OR name_pinyin_init LIKE ?)))`)
      const kw = `%${q.keyword}%`
      const py = `%${q.keyword.replace(/[^a-z0-9]+/gi, '')}%`
      params.push(kw, kw, py, py)
    } else {
      where.push('(name LIKE ? OR comment LIKE ?)')
      const kw = `%${q.keyword}%`
      params.push(kw, kw)
    }
  }
  if (q.exts && q.exts.length > 0) {
    where.push(`ext IN (${q.exts.map(() => '?').join(',')})`)
    params.push(...q.exts)
  }
  if (q.starMin && q.starMin > 0) {
    where.push('star >= ?')
    params.push(q.starMin)
  }
  if (q.minW && q.minW > 0) {
    where.push('width >= ?')
    params.push(q.minW)
  }
  if (q.maxW && q.maxW > 0) {
    where.push('width <= ?')
    params.push(q.maxW)
  }
  if (q.minSizeKB && q.minSizeKB > 0) {
    where.push('size >= ?')
    params.push(q.minSizeKB * 1024)
  }
  if (q.maxSizeKB && q.maxSizeKB > 0) {
    where.push('size <= ?')
    params.push(q.maxSizeKB * 1024)
  }
  if (q.withinDays && q.withinDays > 0) {
    where.push('imported_at >= ?')
    params.push(Date.now() - q.withinDays * 86400000)
  }
  if (q.untagged) {
    where.push('id NOT IN (SELECT DISTINCT asset_id FROM asset_tags)')
  }
  if (q.folderId != null) {
    // 递归 CTE：查询该文件夹及所有后代文件夹的素材（联动子文件夹）
    where.push(
      `id IN (
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM folders WHERE id = ?
          UNION ALL
          SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
        )
        SELECT asset_id FROM asset_folders WHERE folder_id IN (SELECT id FROM subtree)
      )`
    )
    params.push(q.folderId)
  }
  if (q.tagIds && q.tagIds.length > 0) {
    where.push(
      `id IN (SELECT asset_id FROM asset_tags WHERE tag_id IN (${q.tagIds
        .map(() => '?')
        .join(',')}) GROUP BY asset_id HAVING COUNT(DISTINCT tag_id) = ?)`
    )
    params.push(...q.tagIds, q.tagIds.length)
  }

  // 构图下推 SQL（用 width/height 比较，可命中索引，避免内存过滤全表扫描）
  if (q.shape) {
    if (q.shape === 'landscape') where.push('width > height')
    else if (q.shape === 'portrait') where.push('width < height')
    else where.push('width > 0 AND height > 0 AND ABS(width - height) <= MAX(width, height) * 0.05')
  }

  // 颜色数量下推 SQL(color_count 物化列,导入/编辑时维护,启动迁移全量回填自愈;
  // 此前逐行 json_array_length 函数计算,现走列比较)
  if (q.colorCountMax && q.colorCountMax > 0) {
    where.push('color_count <= ?')
    params.push(q.colorCountMax)
  }

  const sortMap = {
    imported: 'imported_at',
    name: 'name',
    size: 'size',
    star: 'star'
  } as const
  const sortCol = sortMap[q.sortBy ?? 'imported']
  const dir = q.sortDesc === false ? 'ASC' : 'DESC'

  const limit = q.color ? 20000 : q.limit ?? 1000
  const rows = stmt(
    db,
    `SELECT * FROM assets WHERE ${where.join(' AND ')} ORDER BY ${sortCol} ${dir} LIMIT ?`
  ).all(...params, limit) as AssetRow[]

  let assets = rows.map(rowToAsset)

  if (q.color) {
    const target = hexToRgb(q.color)
    assets = assets.filter((a) => matchColor(a.colors, target, q.colorTolerance ?? 40))
    if (q.limit) assets = assets.slice(q.offset ?? 0, (q.offset ?? 0) + q.limit)
  }

  attachTags(assets)
  return assets
}

/**
 * 宽松搜索（OR 语义）：任一标签命中，或 name/comment 包含任一关键词。
 * 供 AI 智能搜索阶段 2 使用（queryAssets 的 tagIds 是 AND 语义，不适用）。
 * 只返回活跃素材（deleted_at IS NULL）。
 */
export function searchAssets(anyTagIds: number[], keywords: string[], limit = 500): Asset[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []

  if (anyTagIds.length > 0) {
    where.push(`id IN (SELECT asset_id FROM asset_tags WHERE tag_id IN (${anyTagIds.map(() => '?').join(',')}))`)
    params.push(...anyTagIds)
  }
  for (const kw of keywords) {
    if (!kw.trim()) continue
    // 拼音检索与 queryAssets 同口径:含字母的关键词额外匹配全拼/首字母
    if (/[a-z]/i.test(kw)) {
      where.push(`(name LIKE ? OR comment LIKE ? OR (name_pinyin != '' AND (name_pinyin LIKE ? OR name_pinyin_init LIKE ?)))`)
      const like = `%${kw.trim()}%`
      const py = `%${kw.trim().replace(/[^a-z0-9]+/gi, '')}%`
      params.push(like, like, py, py)
    } else {
      where.push('(name LIKE ? OR comment LIKE ?)')
      const like = `%${kw.trim()}%`
      params.push(like, like)
    }
  }
  if (where.length === 0) return []

  const rows = db
    .prepare(`SELECT * FROM assets WHERE deleted_at IS NULL AND (${where.join(' OR ')}) LIMIT ?`)
    .all(...params, limit) as unknown as AssetRow[]
  const assets = rows.map(rowToAsset)
  attachTags(assets)
  return assets
}

/** 判断文件名是否为「未命名」：相机默认名 / 日期串 / 纯数字 / 短名 */
export function isUnnamedName(name: string): boolean {
  const base = name.replace(/\.[^.]+$/, '') // 去扩展名
  if (base.length < 6) return true // 短名视为未命名
  if (/^IMG[_\-]?\d+$/i.test(base)) return true // IMG_123
  if (/^DSC[_\-]?\d+$/i.test(base)) return true // DSC_123
  if (/^[0-9_\-]+$/.test(base)) return true // 纯数字/日期串 20260731-123
  if (/^(screenshot|微信图片|图片|image|photo)[_-]?\d*$/i.test(base)) return true
  return false
}

/** 查单个素材（含标签），供 AI 处理等需要完整元数据的场景使用 */
export function getAssetById(id: string): Asset | null {
  const db = getDb()
  const row = stmt(db, 'SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined
  if (!row) return null
  const asset = rowToAsset(row)
  attachTags([asset])
  return asset
}

export function assetPaths(id: string): { dir: string; original: string; thumbnail: string } | null {
  // asset: 协议每张缩略图/原图请求都会走到这里(最热语句),必须走缓存
  const db = getDb()
  const row = stmt(
    db,
    'SELECT rel_dir, ext, edited, edited_ext FROM assets WHERE id = ?'
  ).get(id) as { rel_dir: string; ext: string; edited: number; edited_ext: string } | undefined
  if (!row) return null
  const dir = join(getLibraryPath(), row.rel_dir)
  const ext = row.ext || 'file'
  // ext 恒指向原图格式；编辑版格式单独存 edited_ext（兼容旧数据回退 ext）
  const editedExt = row.edited_ext || row.ext || 'file'
  const editedPath = join(dir, `${id}.edited.${editedExt}`)
  const original =
    row.edited === 1 && existsSync(editedPath) ? editedPath : join(dir, `${id}.${ext}`)
  return { dir, original, thumbnail: join(dir, 'thumbnail.jpg') }
}

export function updateAsset(
  id: string,
  fields: Partial<Pick<Asset, 'name' | 'star' | 'comment' | 'url'>>
): void {
  const db = getDb()
  const sets: string[] = []
  const params: unknown[] = []
  if (fields.name !== undefined) {
    // 改名同步重算拼音检索串(导入路径在 importer commitBatch 维护)
    const py = computeNamePinyin(fields.name)
    sets.push('name = ?', 'name_pinyin = ?', 'name_pinyin_init = ?')
    params.push(fields.name, py.full, py.initial)
  }
  if (fields.star !== undefined) {
    sets.push('star = ?')
    params.push(fields.star)
  }
  if (fields.comment !== undefined) {
    sets.push('comment = ?')
    params.push(fields.comment)
  }
  if (fields.url !== undefined) {
    sets.push('url = ?')
    params.push(fields.url)
  }
  if (sets.length === 0) return
  stmt(db, `UPDATE assets SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
}

export function deleteAssets(ids: string[], permanent: boolean): void {
  const db = getDb()
  // 先写入 tombstone(已删除文件记忆),阻止重启/监控时重新导入。
  // 软删与永久删都记录;用户主动导入(checkTombstone=false)不受限,仍可重新导入。
  // 全部语句走缓存:批量删除不再逐 id 重编译(prepare 移出循环)。
  const insTomb = stmt(
    db,
    'INSERT OR IGNORE INTO deleted_files (hash, size, name, deleted_at) VALUES (?, ?, ?, ?)'
  )
  const sel = stmt(db, 'SELECT hash, size, name FROM assets WHERE id = ?')
  const now = Date.now()
  for (const id of ids) {
    const row = sel.get(id) as { hash: string; size: number; name: string } | undefined
    if (row) insTomb.run(row.hash ?? '', row.size ?? 0, row.name ?? '', now)
  }

  if (permanent) {
    const delAsset = stmt(db, 'DELETE FROM assets WHERE id = ?')
    const delTags = stmt(db, 'DELETE FROM asset_tags WHERE asset_id = ?')
    const delFolders = stmt(db, 'DELETE FROM asset_folders WHERE asset_id = ?')
    // 级联清理白板引用：否则画布渲染空白幽灵框、.lumenboard/SVG 导出静默丢元素
    const delBoardItems = stmt(db, 'DELETE FROM board_items WHERE asset_id = ?')
    for (const id of ids) {
      const paths = assetPaths(id)
      if (paths) rmSync(paths.dir, { recursive: true, force: true })
      delAsset.run(id)
      delTags.run(id)
      delFolders.run(id)
      delBoardItems.run(id)
    }
  } else {
    const softDel = stmt(db, 'UPDATE assets SET deleted_at = ? WHERE id = ?')
    for (const id of ids) softDel.run(now, id)
  }
}

export function restoreAssets(ids: string[]): void {
  const db = getDb()
  // 从回收站恢复:清除对应 tombstone,让该文件可被正常重导入
  const sel = stmt(db, 'SELECT hash, size, name FROM assets WHERE id = ?')
  const delTomb = stmt(
    db,
    'DELETE FROM deleted_files WHERE hash = ? AND size = ? AND name = ?'
  )
  for (const id of ids) {
    const row = sel.get(id) as { hash: string; size: number; name: string } | undefined
    if (row) delTomb.run(row.hash ?? '', row.size ?? 0, row.name ?? '')
  }
  const restore = stmt(db, 'UPDATE assets SET deleted_at = NULL WHERE id = ?')
  for (const id of ids) restore.run(id)
}

export function emptyTrash(): void {
  const db = getDb()
  const rows = stmt(db, 'SELECT id FROM assets WHERE deleted_at IS NOT NULL').all() as {
    id: string
  }[]
  deleteAssets(
    rows.map((r) => r.id),
    true
  )
}

/* ---------------- 标签 ---------------- */
function hexToBytes(h: string): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16))
  return out
}

/** 两个 dHash 字节数组的汉明距离（超过 max 即提前返回） */
function hammingBytes(a: number[], b: number[], max: number): number {
  let d = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    let x = a[i] ^ b[i]
    while (x) {
      d += x & 1
      x >>= 1
    }
    if (d > max) return d
  }
  return d + Math.abs(a.length - b.length) * 8
}

/**
 * 扫描素材库，按 dHash 汉明距离 ≤ maxDistance 归组（并查集），返回相似组。
 * @param maxDistance 汉明距离阈值（默认 6，越大越宽松）
 */
export async function findDuplicates(maxDistance = 6): Promise<DupeGroup[]> {
  const db = getDb()
  // 为旧导入的图片补算哈希
  const missing = db
    .prepare("SELECT id, ext, rel_dir FROM assets WHERE hash = '' AND deleted_at IS NULL")
    .all() as { id: string; ext: string; rel_dir: string }[]
  const upd = db.prepare('UPDATE assets SET hash = ? WHERE id = ?')
  for (const row of missing) {
    if (assetKindOf(row.ext) !== 'image' || row.ext === 'svg') continue
    const filePath = join(getLibraryPath(), row.rel_dir, `${row.id}.${row.ext}`)
    const h = await computeDHash(filePath)
    if (h) upd.run(h, row.id)
  }
  const rows = db
    .prepare(
      "SELECT id, name, ext, size, hash FROM assets WHERE hash != '' AND deleted_at IS NULL ORDER BY ext, imported_at"
    )
    .all() as { id: string; name: string; ext: string; size: number; hash: string }[]

  const n = rows.length
  const hashes = rows.map((r) => hexToBytes(r.hash))
  const parent = rows.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  // 按 ext 分组预过滤：只在相同扩展名内比较，大幅减少比较次数
  //（同一张图不同格式导出也会被 dHash 匹配，但跨格式查重价值低且增加 O(n²) 开销）
  let i = 0
  while (i < n) {
    let j = i + 1
    // 找到 ext 相同的连续区间 [i, end)
    while (j < n && rows[j].ext === rows[i].ext) j++
    for (let a = i; a < j; a++) {
      for (let b = a + 1; b < j; b++) {
        if (find(a) === find(b)) continue
        if (hammingBytes(hashes[a], hashes[b], maxDistance) <= maxDistance) parent[find(b)] = find(a)
      }
    }
    i = j
  }
  const groups = new Map<number, DupeGroup['assets']>()
  rows.forEach((r, i) => {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push({ id: r.id, name: r.name, ext: r.ext, size: r.size })
    groups.set(root, list)
  })
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([root, assets]) => ({ hash: rows[root].hash, assets }))
}

/** 以图搜图：返回与目标素材 dHash 汉明距离 ≤ maxDistance 的素材，按相似度排序 */
export async function findSimilar(id: string, maxDistance = 10, limit = 60): Promise<Asset[]> {
  const db = getDb()
  const target = db.prepare('SELECT id, ext, rel_dir, hash FROM assets WHERE id = ?').get(id) as
    | { id: string; ext: string; rel_dir: string; hash: string }
    | undefined
  if (!target) return []
  let targetHash = target.hash
  if (!targetHash && assetKindOf(target.ext) === 'image' && target.ext !== 'svg') {
    targetHash = await computeDHash(join(getLibraryPath(), target.rel_dir, `${target.id}.${target.ext}`))
    if (targetHash) db.prepare('UPDATE assets SET hash = ? WHERE id = ?').run(targetHash, id)
  }
  if (!targetHash) return []

  const tb = hexToBytes(targetHash)
  const rows = db
    .prepare("SELECT id, hash FROM assets WHERE hash != '' AND deleted_at IS NULL AND id != ?")
    .all(id) as { id: string; hash: string }[]
  const scored: { id: string; d: number }[] = []
  for (const r of rows) {
    const d = hammingBytes(tb, hexToBytes(r.hash), maxDistance)
    if (d <= maxDistance) scored.push({ id: r.id, d })
  }
  scored.sort((a, b) => a.d - b.d)
  const top = scored.slice(0, limit)
  if (top.length === 0) return []

  const assets = (
    db
      .prepare(`SELECT * FROM assets WHERE id IN (${top.map(() => '?').join(',')})`)
      .all(...top.map((t) => t.id)) as AssetRow[]
  ).map(rowToAsset)
  const order = new Map(top.map((t, i) => [t.id, i]))
  assets.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  attachTags(assets)
  return assets
}

/* ---------------- 回收站自动清理 ---------------- */

/** 永久删除超过 N 天的回收站素材，返回清理数量 */
