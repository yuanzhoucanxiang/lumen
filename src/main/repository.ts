import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { getDb } from './db'
import { getLibraryPath } from './library'
import { assetKindOf, computeDHash } from './importer'
import type { Asset, AssetQuery, Board, BoardItem, DupeGroup, Folder, SmartConditions, Tag, TagGroup } from '../shared/types'

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
    where.push('(name LIKE ? OR comment LIKE ?)')
    const kw = `%${q.keyword}%`
    params.push(kw, kw)
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

  // 颜色数量下推 SQL（SQLite json_array_length，避免内存解析 JSON）
  if (q.colorCountMax && q.colorCountMax > 0) {
    where.push('json_array_length(colors) <= ?')
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
  const rows = db
    .prepare(`SELECT * FROM assets WHERE ${where.join(' AND ')} ORDER BY ${sortCol} ${dir} LIMIT ?`)
    .all(...params, limit) as AssetRow[]

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
    where.push('(name LIKE ? OR comment LIKE ?)')
    const like = `%${kw.trim()}%`
    params.push(like, like)
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
  const row = getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined
  if (!row) return null
  const asset = rowToAsset(row)
  attachTags([asset])
  return asset
}

export function assetPaths(id: string): { dir: string; original: string; thumbnail: string } | null {
  const row = getDb()
    .prepare('SELECT rel_dir, ext, edited, edited_ext FROM assets WHERE id = ?')
    .get(id) as { rel_dir: string; ext: string; edited: number; edited_ext: string } | undefined
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
    sets.push('name = ?')
    params.push(fields.name)
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
  db.prepare(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
}

export function deleteAssets(ids: string[], permanent: boolean): void {
  const db = getDb()
  // 先写入 tombstone(已删除文件记忆),阻止重启/监控时重新导入。
  // 软删与永久删都记录;用户主动导入(checkTombstone=false)不受限,仍可重新导入。
  const insTomb = db.prepare(
    'INSERT OR IGNORE INTO deleted_files (hash, size, name, deleted_at) VALUES (?, ?, ?, ?)'
  )
  const sel = db.prepare('SELECT hash, size, name FROM assets WHERE id = ?')
  const now = Date.now()
  for (const id of ids) {
    const row = sel.get(id) as { hash: string; size: number; name: string } | undefined
    if (row) insTomb.run(row.hash ?? '', row.size ?? 0, row.name ?? '', now)
  }

  if (permanent) {
    for (const id of ids) {
      const paths = assetPaths(id)
      if (paths) rmSync(paths.dir, { recursive: true, force: true })
      db.prepare('DELETE FROM assets WHERE id = ?').run(id)
      db.prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(id)
      db.prepare('DELETE FROM asset_folders WHERE asset_id = ?').run(id)
    }
  } else {
    const stmt = db.prepare('UPDATE assets SET deleted_at = ? WHERE id = ?')
    for (const id of ids) stmt.run(now, id)
  }
}

export function restoreAssets(ids: string[]): void {
  const db = getDb()
  // 从回收站恢复:清除对应 tombstone,让该文件可被正常重导入
  const sel = db.prepare('SELECT hash, size, name FROM assets WHERE id = ?')
  const delTomb = db.prepare(
    'DELETE FROM deleted_files WHERE hash = ? AND size = ? AND name = ?'
  )
  for (const id of ids) {
    const row = sel.get(id) as { hash: string; size: number; name: string } | undefined
    if (row) delTomb.run(row.hash ?? '', row.size ?? 0, row.name ?? '')
  }
  const stmt = db.prepare('UPDATE assets SET deleted_at = NULL WHERE id = ?')
  for (const id of ids) stmt.run(id)
}

export function emptyTrash(): void {
  const rows = getDb().prepare('SELECT id FROM assets WHERE deleted_at IS NOT NULL').all() as {
    id: string
  }[]
  deleteAssets(
    rows.map((r) => r.id),
    true
  )
}

/* ---------------- 标签 ---------------- */

export function listTags(): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.name, t.color, t.group_id AS groupId, t.priority, t.excluded,
              (SELECT COUNT(*) FROM asset_tags at WHERE at.tag_id = t.id AND at.asset_id IN
                (SELECT id FROM assets WHERE deleted_at IS NULL)) AS count
       FROM tags t ORDER BY t.name COLLATE NOCASE`
    )
    .all() as Tag[]
}

export function createTag(name: string, color = ''): Tag {
  const db = getDb()
  const existing = db
    .prepare('SELECT id, name, color, group_id AS groupId, priority, excluded FROM tags WHERE name = ?')
    .get(name) as Tag | undefined
  if (existing) return { ...existing, count: 0 }
  const info = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color)
  return { id: Number(info.lastInsertRowid), name, color, count: 0, groupId: null, priority: 0, excluded: 0 }
}

export function renameTag(id: number, name: string): void {
  getDb().prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id)
}

export function setTagColor(id: number, color: string): void {
  getDb().prepare('UPDATE tags SET color = ? WHERE id = ?').run(color, id)
}

/** 设置标签优先级：1 = 优先（AI 打标签时优先选用），0 = 普通 */
export function setTagPriority(id: number, priority: number): void {
  getDb().prepare('UPDATE tags SET priority = ? WHERE id = ?').run(priority, id)
}

/** 设置标签排除：1 = 排除（AI 打标签时绝不使用），0 = 正常 */
export function setTagExcluded(id: number, excluded: number): void {
  getDb().prepare('UPDATE tags SET excluded = ? WHERE id = ?').run(excluded, id)
}

/* ---------------- 标签组 ---------------- */

export function listTagGroups(): TagGroup[] {
  return getDb().prepare('SELECT id, name FROM tag_groups ORDER BY name COLLATE NOCASE').all() as TagGroup[]
}

export function createTagGroup(name: string): TagGroup {
  const db = getDb()
  const existing = db.prepare('SELECT id, name FROM tag_groups WHERE name = ?').get(name) as
    | TagGroup
    | undefined
  if (existing) return existing
  const info = db.prepare('INSERT INTO tag_groups (name) VALUES (?)').run(name)
  return { id: Number(info.lastInsertRowid), name }
}

export function renameTagGroup(id: number, name: string): void {
  getDb().prepare('UPDATE tag_groups SET name = ? WHERE id = ?').run(name, id)
}

/** 删除标签组：组内标签变为未分组 */
export function deleteTagGroup(id: number): void {
  const db = getDb()
  db.prepare('UPDATE tags SET group_id = NULL WHERE group_id = ?').run(id)
  db.prepare('DELETE FROM tag_groups WHERE id = ?').run(id)
}

/** 把标签移入某分组（null = 移出分组） */
export function assignTagToGroup(tagId: number, groupId: number | null): void {
  getDb().prepare('UPDATE tags SET group_id = ? WHERE id = ?').run(groupId, tagId)
}

export function deleteTag(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM asset_tags WHERE tag_id = ?').run(id)
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)
}

/**
 * 合并标签：把 sourceId 的素材全部打上 targetId 标签，再删除 sourceId。
 * 用于清理历史同义标签（如「夜景」+「夜晚场景」并存）。事务原子完成。
 */
export function mergeTags(sourceId: number, targetId: number): void {
  if (sourceId === targetId) return
  const db = getDb()
  const run = db.transaction(() => {
    const rows = db.prepare('SELECT asset_id FROM asset_tags WHERE tag_id = ?').all(sourceId) as {
      asset_id: string
    }[]
    const ins = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
    for (const r of rows) ins.run(r.asset_id, targetId)
    db.prepare('DELETE FROM asset_tags WHERE tag_id = ?').run(sourceId)
    db.prepare('DELETE FROM tags WHERE id = ?').run(sourceId)
  })
  run()
}

/** 设置素材的标签（按名称，不存在则创建） */
export function setAssetTags(assetId: string, tagNames: string[]): void {
  const db = getDb()
  db.prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(assetId)
  const ins = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
  for (const name of tagNames) {
    if (!name.trim()) continue
    const tag = createTag(name.trim())
    ins.run(assetId, tag.id)
  }
}

/** 给一批素材追加同一个标签（不覆盖已有标签） */
export function addTagToAssets(assetIds: string[], name: string): void {
  const trimmed = name.trim()
  if (!trimmed || assetIds.length === 0) return
  const tag = createTag(trimmed)
  const ins = getDb().prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
  for (const id of assetIds) ins.run(id, tag.id)
}

/* ---------------- 文件夹 ---------------- */

export function listFolders(): Folder[] {
  const rows = getDb()
    .prepare(
      `SELECT f.id, f.name, f.parent_id AS parentId, f.icon, f.is_smart AS isSmart, f.conditions,
              (SELECT COUNT(*) FROM asset_folders af WHERE af.folder_id = f.id AND af.asset_id IN
                (SELECT id FROM assets WHERE deleted_at IS NULL)) AS count
       FROM folders f ORDER BY f.id`
    )
    .all() as Folder[]
  return rows.map((f) => (f.isSmart ? { ...f, count: countByConditions(parseConditions(f.conditions)) } : f))
}

export function parseConditions(json: string): SmartConditions {
  try {
    return JSON.parse(json) as SmartConditions
  } catch {
    return {}
  }
}

export function countByConditions(conds: SmartConditions): number {
  return queryAssets({ ...conds, deleted: false, limit: 20000 }).length
}

export function createFolder(
  name: string,
  parentId: number | null,
  isSmart = 0,
  conditions = '{}'
): Folder {
  const info = getDb()
    .prepare('INSERT INTO folders (name, parent_id, is_smart, conditions) VALUES (?, ?, ?, ?)')
    .run(name, parentId, isSmart, conditions)
  return { id: Number(info.lastInsertRowid), name, parentId, icon: '', count: 0, isSmart, conditions }
}

export function updateSmartFolder(id: number, name: string, conditions: string): void {
  getDb().prepare('UPDATE folders SET name = ?, conditions = ? WHERE id = ?').run(name, conditions, id)
}

export function renameFolder(id: number, name: string): void {
  getDb().prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, id)
}

export function deleteFolder(id: number): void {
  const db = getDb()
  // 子文件夹上移到被删文件夹的父级，避免成为孤儿
  db.prepare(
    'UPDATE folders SET parent_id = (SELECT parent_id FROM folders WHERE id = ?) WHERE parent_id = ?'
  ).run(id, id)
  db.prepare('DELETE FROM asset_folders WHERE folder_id = ?').run(id)
  db.prepare('DELETE FROM folders WHERE id = ?').run(id)
}

export function addToFolder(assetIds: string[], folderId: number): void {
  const stmt = getDb().prepare('INSERT OR IGNORE INTO asset_folders (asset_id, folder_id) VALUES (?, ?)')
  for (const id of assetIds) stmt.run(id, folderId)
}

export function removeFromFolder(assetIds: string[], folderId: number): void {
  const stmt = getDb().prepare('DELETE FROM asset_folders WHERE asset_id = ? AND folder_id = ?')
  for (const id of assetIds) stmt.run(id, folderId)
}

export function libraryStats(): { total: number; deleted: number; tombstones: number } {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NULL').get() as { n: number }).n
  const deleted = (db.prepare('SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NOT NULL').get() as { n: number }).n
  let tombstones = 0
  try {
    tombstones = (db.prepare('SELECT COUNT(*) AS n FROM deleted_files').get() as { n: number }).n
  } catch {
    // deleted_files 表尚不存在(旧库未迁移)时返回 0
  }
  return { total, deleted, tombstones }
}

/* ---------------- 重复检测与相似检索 ---------------- */

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
export function cleanTrashOlderThan(days: number): number {
  const cutoff = Date.now() - days * 86400000
  const rows = getDb()
    .prepare('SELECT id FROM assets WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .all(cutoff) as { id: string }[]
  if (rows.length > 0) {
    deleteAssets(
      rows.map((r) => r.id),
      true
    )
  }
  return rows.length
}

/* ---------------- 白板 ---------------- */

export function listBoards(): Board[] {
  return getDb()
    .prepare(
      `SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
       FROM boards ORDER BY updated_at DESC`
    )
    .all() as Board[]
}

export function createBoard(name: string): Board {
  const db = getDb()
  const now = Date.now()
  const info = db.prepare('INSERT INTO boards (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, now, now)
  return { id: Number(info.lastInsertRowid), name, createdAt: now, updatedAt: now }
}

export function renameBoard(id: number, name: string): void {
  getDb().prepare('UPDATE boards SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
}

/** 删除白板（级联删除其元素） */
export function deleteBoard(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM board_items WHERE board_id = ?').run(id)
  db.prepare('DELETE FROM boards WHERE id = ?').run(id)
}

interface BoardItemRow {
  id: string
  board_id: number
  asset_id: string | null
  type: string
  x: number
  y: number
  width: number
  height: number
  z: number
  text: string
  created_at: number
}

function rowToBoardItem(r: BoardItemRow): BoardItem {
  return {
    id: r.id,
    boardId: r.board_id,
    assetId: r.asset_id,
    type: r.type === 'note' ? 'note' : 'asset',
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    z: r.z,
    text: r.text,
    createdAt: r.created_at
  }
}

export function listBoardItems(boardId: number): BoardItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, board_id, asset_id, type, x, y, width, height, z, text, created_at
       FROM board_items WHERE board_id = ? ORDER BY z ASC`
    )
    .all(boardId) as BoardItemRow[]
  return rows.map(rowToBoardItem)
}

/** 添加白板元素（asset 或 note），返回完整元素 */
export function addBoardItem(
  boardId: number,
  item: { assetId?: string | null; type: 'asset' | 'note'; x: number; y: number; width: number; height: number; text?: string }
): BoardItem {
  const db = getDb()
  const id = randomUUID().replace(/-/g, '').slice(0, 16)
  const z = (db.prepare('SELECT COALESCE(MAX(z), -1) + 1 AS z FROM board_items WHERE board_id = ?').get(boardId) as { z: number }).z
  const createdAt = Date.now()
  db.prepare(
    `INSERT INTO board_items (id, board_id, asset_id, type, x, y, width, height, z, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, boardId, item.assetId ?? null, item.type, item.x, item.y, item.width, item.height, z, item.text ?? '', createdAt)
  db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), boardId)
  return {
    id,
    boardId,
    assetId: item.assetId ?? null,
    type: item.type,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    z,
    text: item.text ?? '',
    createdAt
  }
}

/** 更新白板元素（动态 SET，x/y/width/height/z/text 可部分更新） */
export function updateBoardItem(
  id: string,
  patch: Partial<Pick<BoardItem, 'x' | 'y' | 'width' | 'height' | 'z' | 'text'>>
): void {
  const db = getDb()
  const sets: string[] = []
  const params: unknown[] = []
  for (const key of ['x', 'y', 'width', 'height', 'z', 'text'] as const) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`)
      params.push(patch[key])
    }
  }
  if (sets.length === 0) return
  const row = db.prepare('SELECT board_id FROM board_items WHERE id = ?').get(id) as { board_id: number } | undefined
  if (!row) return
  db.prepare(`UPDATE board_items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
  db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), row.board_id)
}

export function deleteBoardItem(id: string): void {
  const db = getDb()
  const row = db.prepare('SELECT board_id FROM board_items WHERE id = ?').get(id) as { board_id: number } | undefined
  db.prepare('DELETE FROM board_items WHERE id = ?').run(id)
  if (row) db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), row.board_id)
}

/** 置顶：z = 当前最大值 + 1 */
export function bringBoardItemToFront(id: string, boardId: number): void {
  const db = getDb()
  const z = (db.prepare('SELECT COALESCE(MAX(z), 0) + 1 AS z FROM board_items WHERE board_id = ?').get(boardId) as { z: number }).z
  db.prepare('UPDATE board_items SET z = ? WHERE id = ?').run(z, id)
  db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), boardId)
}
