import { getDb } from '../db'
import { stmt } from '../stmtCache'
import type { Tag, TagGroup } from '../../shared/types'

export function listTags(): Tag[] {
  return stmt(
    getDb(),
    `SELECT t.id, t.name, t.color, t.group_id AS groupId, t.priority, t.excluded,
              (SELECT COUNT(*) FROM asset_tags at WHERE at.tag_id = t.id AND at.asset_id IN
                (SELECT id FROM assets WHERE deleted_at IS NULL)) AS count
       FROM tags t ORDER BY t.name COLLATE NOCASE`
  ).all() as Tag[]
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
  stmt(db, 'DELETE FROM asset_tags WHERE asset_id = ?').run(assetId)
  const ins = stmt(db, 'INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
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
  const ins = stmt(getDb(), 'INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
  for (const id of assetIds) ins.run(id, tag.id)
}

/* ---------------- 文件夹 ---------------- */
