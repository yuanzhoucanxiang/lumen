import type Database from 'better-sqlite3'

/**
 * SQL 语句缓存(后端优化阶段 2 / 任务 2.2)
 *
 * better-sqlite3 的 statement 对象绑定在具体的 Database 实例上,且可重复 run/get/all
 * (每次调用自动重置绑定)。这里按 SQL 文本缓存 statement,消除热路径(导入查重、
 * 列表查询、白板拖拽等)每次调用重新 prepare 的编译开销。
 *
 * 生命周期约束(唯一真正的雷):
 *   closeDb()(db.ts)必须先 clearStmtCache() 再关连接,否则切换素材库后
 *   cache 里残留指向旧实例的 statement,调用会抛 "The database connection is closed"。
 *   stmt() 内部额外校验 statement.database 与传入 db 一致,双保险防御任何
 *   未走 closeDb 的换库路径。
 */
const cache = new Map<string, Database.Statement>()

export function stmt(db: Database.Database, sql: string): Database.Statement {
  let s = cache.get(sql)
  if (!s || s.database !== db) {
    // 缓存未命中,或缓存项绑定在别的 Database 实例上(切库后未清缓存的兜底):重新编译
    s = db.prepare(sql)
    cache.set(sql, s)
  }
  return s
}

export function clearStmtCache(): void {
  cache.clear()
}
