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

export function removeFromFolder(assetIds: string[], folderId: number): void {
  const del = stmt(getDb(), 'DELETE FROM asset_folders WHERE asset_id = ? AND folder_id = ?')
  for (const id of assetIds) del.run(id, folderId)
}
