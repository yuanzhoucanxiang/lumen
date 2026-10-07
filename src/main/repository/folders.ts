import { getDb } from '../db'
import { stmt } from '../stmtCache'
import { queryAssets } from './assets'
import type { Folder, SmartConditions } from '../../shared/types'

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

/**
 * 移动文件夹改变层级（targetParentId = null 表示移到顶层）。
 * 主进程做唯一权威判定：环一旦形成，queryAssets 的子树递归 CTE 会把素材查丢；
 * 智能文件夹不在侧栏文件夹树里渲染，收为子级等于把整棵子树藏进看不见的位置。
 */
export function moveFolder(id: number, targetParentId: number | null): void {
  const db = getDb()
  if (targetParentId === id) return
  if (targetParentId != null) {
    const target = stmt(db, 'SELECT is_smart FROM folders WHERE id = ?').get(targetParentId) as
      | { is_smart: number }
      | undefined
    if (!target) throw new Error('目标文件夹不存在')
    if (target.is_smart) throw new Error('不能把文件夹移入智能文件夹')
    // 后代集合（含自身）里出现目标 => 移过去会成环。用 UNION 去重，脏数据里已有的环也不会死循环
    const cyclic = stmt(
      db,
      `WITH RECURSIVE down(id) AS (
         SELECT ?
         UNION
         SELECT f.id FROM folders f JOIN down d ON f.parent_id = d.id
       ) SELECT 1 FROM down WHERE id = ? LIMIT 1`
    ).get(id, targetParentId)
    if (cyclic) throw new Error('不能把文件夹移入自己的子文件夹')
  }
  stmt(db, 'UPDATE folders SET parent_id = ? WHERE id = ?').run(targetParentId, id)
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
  const ins = stmt(getDb(), 'INSERT OR IGNORE INTO asset_folders (asset_id, folder_id) VALUES (?, ?)')
  for (const id of assetIds) ins.run(id, folderId)
}

/** 这批素材里已经在该文件夹内的 id 集合。
 *  Agent 操作记录用（里程碑 182）：只把"本次真正新归档进去"的素材记进记录，
 *  回退时就不会把用户原本就归在这个文件夹里的素材移出去。 */
export function assetsInFolder(assetIds: string[], folderId: number): Set<string> {
  const inside = new Set<string>()
  if (assetIds.length === 0 || !Number.isInteger(folderId)) return inside
  const q = getDb().prepare('SELECT 1 FROM asset_folders WHERE folder_id = ? AND asset_id = ?')
  for (const id of assetIds) if (q.get(folderId, id)) inside.add(id)
  return inside
}

export function removeFromFolder(assetIds: string[], folderId: number): void {
  const del = stmt(getDb(), 'DELETE FROM asset_folders WHERE asset_id = ? AND folder_id = ?')
  for (const id of assetIds) del.run(id, folderId)
}
