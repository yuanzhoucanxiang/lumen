import Database from 'better-sqlite3'
import { copyFileSync, existsSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { dialog } from 'electron'
import { clearStmtCache } from './stmtCache'
import { logger } from './logger'

let db: Database.Database | null = null

/** 打开并校验库;损坏时自动自愈(改名保留现场 -> 从 .bak 恢复 -> 无备份则建空库并明确告知) */
export function openDb(libraryPath: string): Database.Database {
  if (db) return db
  const dbPath = join(libraryPath, 'library.db')
  try {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    const check = db.pragma('quick_check', { simple: true }) as string
    if (check !== 'ok') throw new Error(`quick_check 未通过: ${check}`)
  } catch (e) {
    recoverCorruptDb(dbPath, e)
  }
  try {
    migrate(db!)
  } catch (e) {
    // 迁移失败是代码/模式问题而非损坏:关闭并清空单例,避免后续拿到坏实例
    db?.close()
    db = null
    clearStmtCache()
    throw new Error(`数据库迁移失败: ${(e as Error).message}`)
  }
  return db!
}

/** 损坏恢复:保留现场改名 -> 备份恢复 -> 无备份建空库(数据丢失必须告知) */
function recoverCorruptDb(dbPath: string, cause: unknown): void {
  db?.close()
  db = null
  const corrupt = `${dbPath}.corrupt-${Date.now()}`
  try {
    // 文件可能压根没生成(如父目录在打开瞬间缺失/首次创建失败):没有可保留的现场,
    // 直接进入重建分支,不要对不存在的文件做 rename(否则 ENOENT 把"自愈"变成"崩")
    if (existsSync(dbPath)) {
      renameSync(dbPath, corrupt)
      // 旧的 -wal/-shm 与主库是配套的,恢复新库前必须清掉,否则会重放损坏日志
      rmSync(`${dbPath}-wal`, { force: true })
      rmSync(`${dbPath}-shm`, { force: true })
      logger.error('[db]', `库文件损坏(${(cause as Error).message}),已改名保留: ${corrupt}`)
    } else {
      logger.warn('[db]', `库文件打开失败(${(cause as Error).message}),文件不存在,直接重建`)
    }

    const bak = `${dbPath}.bak`
    if (existsSync(bak)) {
      copyFileSync(bak, dbPath)
      db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      const check = db.pragma('quick_check', { simple: true }) as string
      if (check !== 'ok') throw new Error(`备份库也损坏: ${check}`)
      logger.warn('[db]', `已从 ${bak} 恢复数据库(可能丢失最近改动)`)
      return
    }
    // 无备份:建空库是最后手段,必须让用户知道发生了什么
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    logger.error('[db]', `无备份可用,已重建空库(数据丢失);损坏文件保留在 ${corrupt}`)
    try {
      dialog.showErrorBox('素材库损坏', `library.db 损坏且无备份,已重建空库。\n损坏文件保留在:\n${corrupt}`)
    } catch {
      /* 无窗口环境忽略 */
    }
  } catch (e2) {
    db?.close()
    db = null
    throw new Error(`数据库打开失败且无法自愈: ${(e2 as Error).message}`)
  }
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function closeDb(): void {
  // statement 绑定在具体 Database 实例上:先清语句缓存再关连接,
  // 否则切换素材库后会拿到指向已关闭旧实例的 statement(调用即抛错)
  clearStmtCache()
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
    -- 查重/回收站热路径索引(后端优化阶段 2):
    -- hash+size:导入查重哈希路径(此前每次全表扫);name+size:查重快速路径(name 单列索引需回表比对 size);
    -- deleted_at:所有列表查询都过滤它,回收站视图专用。hash='' 的非图片记录也入索引,体积可控。
    CREATE INDEX IF NOT EXISTS idx_assets_hash_size ON assets(hash, size);
    CREATE INDEX IF NOT EXISTS idx_assets_name_size ON assets(name, size);
    CREATE INDEX IF NOT EXISTS idx_assets_deleted ON assets(deleted_at);

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

    -- 已删除文件记忆表(tombstone):阻止重启/监控时重新导入已删除的文件。
    -- hash 为图片 dHash(非图片为空);name+size 为回退查重键。
    CREATE TABLE IF NOT EXISTS deleted_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      deleted_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deleted_files_hash ON deleted_files(hash, size);
    CREATE INDEX IF NOT EXISTS idx_deleted_files_namesize ON deleted_files(name, size);

    -- 白板：无限画布，素材库的延伸（类 PureRef）
    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS board_items (
      id TEXT PRIMARY KEY,
      board_id INTEGER NOT NULL,
      asset_id TEXT,
      type TEXT NOT NULL DEFAULT 'asset',
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 240,
      height REAL NOT NULL DEFAULT 0,
      z INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_id);
  `)
  // 增量迁移：为旧库补充新字段
  ensureColumns(d, 'assets', {
    hash: "TEXT NOT NULL DEFAULT ''",
    edited: 'INTEGER NOT NULL DEFAULT 0',
    edited_ext: "TEXT NOT NULL DEFAULT ''",
    exif: 'TEXT NOT NULL DEFAULT \'\'',
    // colors 数量物化列(后端优化阶段 2b):筛选走列比较,避免逐行 json_array_length
    color_count: 'INTEGER NOT NULL DEFAULT 0'
  })
  ensureColumns(d, 'folders', {
    is_smart: 'INTEGER NOT NULL DEFAULT 0',
    conditions: "TEXT NOT NULL DEFAULT '{}'"
  })
  ensureColumns(d, 'tags', {
    group_id: 'INTEGER',
    priority: 'INTEGER NOT NULL DEFAULT 0',
    excluded: 'INTEGER NOT NULL DEFAULT 0'
  })
  ensureColumns(d, 'board_items', {
    note_font: "TEXT NOT NULL DEFAULT ''",
    note_color: "TEXT NOT NULL DEFAULT ''",
    note_font_size: 'INTEGER NOT NULL DEFAULT 16',
    opacity: 'INTEGER NOT NULL DEFAULT 100',
    shape: 'TEXT'
  })
  ensureColumns(d, 'boards', {
    guides: "TEXT NOT NULL DEFAULT '[]'",
    // 画布外观 JSON：{bg:'dark'|'gray'|'light'|'white'|'black'|'#rrggbb', grid:boolean, gridSize:number}
    appearance: "TEXT NOT NULL DEFAULT '{\"bg\":\"dark\",\"grid\":true,\"gridSize\":24}'"
  })

  // 回填迁移:把当前回收站里的软删记录一次性写入 tombstone,
  // 让现有已删除文件也能阻止重启/监控重导入。幂等(已存在则跳过)。
  d.exec(`
    INSERT INTO deleted_files (hash, size, name, deleted_at)
    SELECT DISTINCT hash, size, name, deleted_at
    FROM assets a
    WHERE a.deleted_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM deleted_files t
        WHERE t.hash = a.hash AND t.size = a.size AND t.name = a.name
      )
  `)

  // color_count 物化列回填:每次启动全量重算(自愈,幂等)。
  // 导入/编辑两条写入路径会维护该列,这里兜底任何遗漏;行数与库同量级,耗时毫秒级。
  d.exec('UPDATE assets SET color_count = json_array_length(colors)')
}

function ensureColumns(d: Database.Database, table: string, defs: Record<string, string>): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  for (const [col, def] of Object.entries(defs)) {
    if (!names.has(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
  }
}
