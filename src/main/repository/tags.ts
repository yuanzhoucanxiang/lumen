import { getDb } from '../db'
import { stmt } from '../stmtCache'
import { normalizeTagName, planAgentTags, type AgentTagPlan } from '../../shared/tagName'
import type { Tag, TagGroup } from '../../shared/types'

export function listTags(): Tag[] {
  // 计数用一次聚合 JOIN 预先算好（里程碑 217）：原写法是逐标签的相关子查询，
  // 上千标签时每次 listTags 要跑 1000+ 次子查询（实测 1121 个标签 440ms）；
  // 改成子查询只扫一遍 asset_tags，再 LEFT JOIN 回标签，实测降到 ~20ms。
  return stmt(
    getDb(),
    `SELECT t.id, t.name, t.color, t.group_id AS groupId, t.priority, t.excluded,
            COALESCE(c.n, 0) AS count
       FROM tags t
       LEFT JOIN (
         SELECT at.tag_id AS tagId, COUNT(*) AS n
           FROM asset_tags at
           JOIN assets a ON a.id = at.asset_id
          WHERE a.deleted_at IS NULL
          GROUP BY at.tag_id
       ) c ON c.tagId = t.id
      ORDER BY t.name COLLATE NOCASE`
  ).all() as Tag[]
}

/** 按名查标签 id（不存在返回 null）。Agent 操作记录用：判断这次是不是"新建了标签"（里程碑 197）
 *  匹配顺序（里程碑 219）：先精确匹配，再按归一键匹配——`AI 生成` 能命中已存在的 `AI生成` */
export function findTagId(name: string): number | null {
  const db = getDb()
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return null
  const exact = db.prepare('SELECT id FROM tags WHERE name = ?').get(trimmed) as { id: number } | undefined
  if (exact) return exact.id
  const norm = normalizeTagName(trimmed)
  if (!norm) return null
  const byNorm = db
    .prepare('SELECT id FROM tags WHERE norm_name = ? ORDER BY id LIMIT 1')
    .get(norm) as { id: number } | undefined
  return byNorm ? byNorm.id : null
}

/** 标签下未删除素材的数量（Agent 回退清理空标签用） */
export function tagAssetCount(tagId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM asset_tags at JOIN assets a ON a.id = at.asset_id
       WHERE at.tag_id = ? AND a.deleted_at IS NULL`
    )
    .get(tagId) as { n: number }
  return row?.n ?? 0
}

export function createTag(name: string, color = ''): Tag {
  const db = getDb()
  const trimmed = String(name ?? '').trim()
  if (!trimmed) throw new Error('标签名不能为空')
  // 复用优先（里程碑 219）：精确或归一命中都返回已有标签，不再新建近重复项
  const existingId = findTagId(trimmed)
  if (existingId !== null) {
    const existing = db
      .prepare('SELECT id, name, color, group_id AS groupId, priority, excluded FROM tags WHERE id = ?')
      .get(existingId) as Tag | undefined
    if (existing) return { ...existing, count: 0 }
  }
  const info = db
    .prepare('INSERT INTO tags (name, color, norm_name) VALUES (?, ?, ?)')
    .run(trimmed, color, normalizeTagName(trimmed))
  return { id: Number(info.lastInsertRowid), name: trimmed, color, count: 0, groupId: null, priority: 0, excluded: 0 }
}

export function renameTag(id: number, name: string): void {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return
  getDb()
    .prepare('UPDATE tags SET name = ?, norm_name = ? WHERE id = ?')
    .run(trimmed, normalizeTagName(trimmed), id)
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

/** 这批素材里已经带该标签的 id 集合。
 *  Agent 操作记录用（里程碑 182）：只把"本次真正新加上标签"的素材记进记录，
 *  回退时就不会摘掉用户原本就有的标签。 */
export function assetsHavingTag(assetIds: string[], name: string): Set<string> {
  const having = new Set<string>()
  const trimmed = name.trim()
  if (!trimmed || assetIds.length === 0) return having
  const db = getDb()
  const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(trimmed) as { id: number } | undefined
  if (!tag) return having
  const q = db.prepare('SELECT 1 FROM asset_tags WHERE tag_id = ? AND asset_id = ?')
  for (const id of assetIds) if (q.get(tag.id, id)) having.add(id)
  return having
}

/** 从一批素材上移除某个标签（标签不存在返回 0；可逆——重新 add 即可）。
 *  供 Agent HTTP /untag 使用（里程碑 169）。 */
export function removeTagFromAssets(assetIds: string[], name: string): number {
  const trimmed = name.trim()
  if (!trimmed || assetIds.length === 0) return 0
  const tag = getDb()
    .prepare('SELECT id FROM tags WHERE name = ?')
    .get(trimmed) as { id: number } | undefined
  if (!tag) return 0
  const del = stmt(getDb(), 'DELETE FROM asset_tags WHERE tag_id = ? AND asset_id = ?')
  let removed = 0
  for (const id of assetIds) {
    if (del.run(tag.id, id).changes > 0) removed++
  }
  return removed
}

/* ---------------- Agent 标签策略（里程碑 219） ---------------- */

/**
 * 解析 Agent 本次请求的标签：复用优先 + 限额新建。
 * - 已存在（精确或归一命中）→ 用库里的规范写法；
 * - 未知标签 → 额度内新建，额度用尽转 unknown（带近似候选），Agent 可据此改复用或询问用户；
 * - quota：0 = 只复用，-1 = 不限制，正数 = 本次最多新建几个。
 */
export function resolveAgentTags(names: readonly string[], quota: number): AgentTagPlan {
  const plan = planAgentTags(names, listTags(), quota)
  for (const name of plan.create) createTag(name)
  return plan
}

/* ---------------- 文件夹 ---------------- */
