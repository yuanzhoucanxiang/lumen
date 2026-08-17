import { readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import { getDb } from './db'
import { getLibraryPath } from './library'
import { logger } from './logger'
import { zipStoreStreamToFile, type ZipStreamEntry } from './zipLib'

/* ---------------- 备份 ---------------- */

/**
 * 备份数据库到 library.db.bak（同目录，覆盖旧备份）。
 * 使用 better-sqlite3 的 backup API 在线热备，不阻塞读写。
 */
export function backupDatabase(): string {
  const libPath = getLibraryPath()
  const target = join(libPath, 'library.db.bak')
  const db = getDb()
  db.backup(target)
  logger.info('[backup]', `数据库已备份到 ${target}`)
  return target
}

/** 异步递归收集目录下所有文件，返回相对库根目录的路径(fs/promises,不阻塞主进程) */
async function collectFiles(dir: string, base: string, acc: { rel: string; abs: string }[]): Promise<void> {
  for (const name of await readdir(dir)) {
    const abs = join(dir, name)
    const st = await stat(abs)
    if (st.isDirectory()) {
      await collectFiles(abs, base, acc)
    } else {
      acc.push({ rel: relative(base, abs).replace(/\\/g, '/'), abs })
    }
  }
}

/**
 * 把整个当前库目录打包成 ZIP（含 assets 原图 + 缩略图 + library.db）。
 * 用于完整灾难恢复。返回写入的文件数。
 * 流式写入(阶段 3):逐文件过流,内存只有中央目录,不再整库 readFileSync 进内存。
 */
export async function backupLibraryToZip(zipPath: string): Promise<number> {
  const libPath = getLibraryPath()
  // WAL checkpoint:把 -wal 里未落盘的写入并入主 db,保证打进去的 library.db 完整。
  // busy 时 wal 保留原样,连同 wal 一起打包 SQLite 也能恢复,故忽略结果。
  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)')
  } catch (e) {
    logger.warn('[backup]', `wal_checkpoint 失败(忽略,将连同 -wal 一起打包): ${(e as Error).message}`)
  }
  const files: { rel: string; abs: string }[] = []
  await collectFiles(libPath, libPath, files)

  const entries: ZipStreamEntry[] = files.map((f) => ({ name: f.rel, filePath: f.abs }))
  const count = await zipStoreStreamToFile(entries, zipPath)
  logger.info('[backup]', `完整库已备份到 ${zipPath}（${count} 个文件）`)
  return count
}
