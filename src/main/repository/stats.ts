import { getDb } from '../db'
import { stmt } from '../stmtCache'
import { deleteAssets } from './assets'

export interface QuickCounts {
  images: number
  videos: number
  uncategorized: number
  untagged: number
  recent: number
}

export function libraryStats(): {
  total: number
  deleted: number
  tombstones: number
  agent: number
  quick: QuickCounts
} {
  const db = getDb()
  const total = (stmt(db, 'SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NULL').get() as { n: number }).n
  const deleted = (stmt(db, 'SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NOT NULL').get() as { n: number }).n
  let tombstones = 0
  try {
    tombstones = (stmt(db, 'SELECT COUNT(*) AS n FROM deleted_files').get() as { n: number }).n
  } catch {
    // deleted_files 表尚不存在(旧库未迁移)时返回 0
  }
  // agent 来源计数(里程碑 159):旧库无 source 列时按 0 处理
  let agent = 0
  try {
    agent = (stmt(db, "SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NULL AND source = 'agent'").get() as { n: number }).n
  } catch {
    // source 列尚未迁移时返回 0
  }
  // 侧栏大分类计数（里程碑 225）：一次取齐，全部走既有索引
  const IMAGE_EXTS = ['jpg','jpeg','png','gif','webp','bmp','avif','tiff','tif','psd','heic','heif','ai','svg']
  const VIDEO_EXTS = ['mp4','webm','mov','mkv','avi','wmv','m4v']
  const placeholders = (list: string[]) => list.map(() => '?').join(',')
  const quick = stmt(
    db,
    `SELECT
       (SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL AND ext IN (${placeholders(IMAGE_EXTS)})) AS images,
       (SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL AND ext IN (${placeholders(VIDEO_EXTS)})) AS videos,
       (SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL AND id NOT IN (SELECT asset_id FROM asset_folders)) AS uncategorized,
       (SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL AND id NOT IN (SELECT asset_id FROM asset_tags)) AS untagged,
       (SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL AND imported_at >= ?) AS recent`
  ).get(...IMAGE_EXTS, ...VIDEO_EXTS, Date.now() - 7 * 86400000) as QuickCounts
  return { total, deleted, tombstones, agent, quick }
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
