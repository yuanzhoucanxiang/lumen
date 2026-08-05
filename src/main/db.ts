import Database from 'better-sqlite3'
import { join } from 'path'

let db: Database.Database | null = null

export function openDb(libraryPath: string): Database.Database {
  if (db) return db
  db = new Database(join(libraryPath, 'library.db'))
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ext TEXT NOT NULL,
      rel_dir TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      colors TEXT NOT NULL DEFAULT '[]',
      hash TEXT NOT NULL DEFAULT '',
      star INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      imported_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_assets_imported ON assets(imported_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
    CREATE INDEX IF NOT EXISTS idx_assets_ext ON assets(ext);
    CREATE INDEX IF NOT EXISTS idx_assets_star ON assets(star);
    CREATE INDEX IF NOT EXISTS idx_assets_width_height ON assets(width, height);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tag_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (asset_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      icon TEXT NOT NULL DEFAULT '',
      is_smart INTEGER NOT NULL DEFAULT 0,
      conditions TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS asset_folders (
      asset_id TEXT NOT NULL,
      folder_id INTEGER NOT NULL,
      PRIMARY KEY (asset_id, folder_id)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_folders_folder ON asset_folders(folder_id);
  `)
  // 增量迁移：为旧库补充新字段
  ensureColumns(d, 'assets', {
    hash: "TEXT NOT NULL DEFAULT ''",
    edited: 'INTEGER NOT NULL DEFAULT 0',
    edited_ext: "TEXT NOT NULL DEFAULT ''",
    exif: 'TEXT NOT NULL DEFAULT \'\''
  })
  ensureColumns(d, 'folders', {
    is_smart: 'INTEGER NOT NULL DEFAULT 0',
    conditions: "TEXT NOT NULL DEFAULT '{}'"
  })
  ensureColumns(d, 'tags', {
    group_id: 'INTEGER'
  })
}

function ensureColumns(d: Database.Database, table: string, defs: Record<string, string>): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  for (const [col, def] of Object.entries(defs)) {
    if (!names.has(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
  }
}
