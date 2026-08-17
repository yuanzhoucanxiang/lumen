import { getDb } from '../db'
import { stmt } from '../stmtCache'
import { deleteAssets } from './assets'

export function libraryStats(): { total: number; deleted: number; tombstones: number } {
  const db = getDb()
  const total = (stmt(db, 'SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NULL').get() as { n: number }).n
  const deleted = (stmt(db, 'SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NOT NULL').get() as { n: number }).n
  let tombstones = 0
  try {
    tombstones = (stmt(db, 'SELECT COUNT(*) AS n FROM deleted_files').get() as { n: number }).n
  } catch {
    // deleted_files 表尚不存在(旧库未迁移)时返回 0
  }
  return { total, deleted, tombstones }
}

/* ---------------- 重复检测与相似检索 ---------------- */
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
