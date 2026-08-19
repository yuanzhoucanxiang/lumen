import { app } from 'electron'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { renameSync } from 'fs'
import { join, relative } from 'path'
import { getDb } from './db'
import { getLibraryPath } from './library'
import { logger } from './logger'
import { zipStoreStreamToFile, type ZipStreamEntry } from './zipLib'

/* ---------------- 备份 ---------------- */

/** 数据库备份保留代数:library.db.bak / .bak.1 / .bak.2(共 3 份) */
const DB_BACKUP_KEEP = 3
/** 全量 ZIP 备份保留份数 */
const ZIP_BACKUP_KEEP = 2

/** 自动备份根目录(放 userData 而非库目录,避免备份内容把自己包进去形成递归) */
function backupDir(): string {
  return join(app.getPath('userData'), 'backups')
}

/** 轮转数据库备份:旧 .bak 依次后移,留出空位给新备份 */
function rotateDbBackups(): void {
  const libPath = getLibraryPath()
  for (let i = DB_BACKUP_KEEP - 2; i >= 0; i--) {
    const from = i === 0 ? join(libPath, 'library.db.bak') : join(libPath, `library.db.bak.${i}`)
    const to = join(libPath, `library.db.bak.${i + 1}`)
    if (existsSync(from)) {
      try {
        renameSync(from, to)
      } catch (e) {
        logger.warn('[backup]', `轮转备份失败 ${from}: ${(e as Error).message}`)
      }
    }
  }
}

/**
 * 备份数据库到 library.db.bak(同目录,自动轮转保留多代)。
 * 使用 better-sqlite3 的 backup API 在线热备,不阻塞读写。
 */
export function backupDatabase(): string {
  const libPath = getLibraryPath()
  const target = join(libPath, 'library.db.bak')
  rotateDbBackups()
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

/* ---------------- 自动备份(启动 + 周期) ---------------- */

interface AutoMarker {
  lastDb?: string // 'YYYY-MM-DD'
  lastZip?: string // ISO 周 'YYYY-Www'
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function markerPath(): string {
  return join(backupDir(), '.last-auto.json')
}

async function readMarker(): Promise<AutoMarker> {
  try {
    return JSON.parse(await readFile(markerPath(), 'utf-8')) as AutoMarker
  } catch {
    return {}
  }
}

async function writeMarker(m: AutoMarker): Promise<void> {
  await writeFile(markerPath(), JSON.stringify(m), 'utf-8')
}

/** 清理备份目录里最旧的 ZIP,只保留最近 ZIP_BACKUP_KEEP 份 */
async function pruneZipBackups(): Promise<void> {
  try {
    const names = (await readdir(backupDir())).filter((n) => n.endsWith('.zip')).sort()
    for (const n of names.slice(0, Math.max(0, names.length - ZIP_BACKUP_KEEP))) {
      const p = join(backupDir(), n)
      try {
        await rm(p, { force: true })
        logger.info('[backup]', `清理过期备份 ${n}`)
      } catch (e) {
        logger.warn('[backup]', `清理备份失败 ${n}: ${(e as Error).message}`)
      }
    }
  } catch {
    /* 目录不存在等忽略 */
  }
}

/**
 * 启动时自动备份:数据库每日至多一次(轮转保留 3 代),全量 ZIP 每周至多一次(保留 2 份)。
 * 通过 marker 记录上次执行,重启不重复。仅打包版默认启用;开发模式可用
 * LUMEN_AUTO_BACKUP=1 强制(供测试),LUMEN_AUTO_BACKUP_DELAY 覆盖延迟。
 */
export async function autoBackupStartup(): Promise<{ db?: string; zip?: string } | null> {
  if (app.isPackaged || process.env.LUMEN_AUTO_BACKUP === '1') {
    // 正常执行
  } else {
    return null
  }
  try {
    await mkdir(backupDir(), { recursive: true })
  } catch {
    /* 目录创建失败,放弃本次自动备份 */
  }
  const marker = await readMarker()
  const today = new Date().toISOString().slice(0, 10)
  const week = isoWeek(new Date())
  const done: { db?: string; zip?: string } = {}

  if (marker.lastDb !== today) {
    try {
      backupDatabase()
      done.db = join(getLibraryPath(), 'library.db.bak')
      // 每步成功后增量写 marker:中途被杀(如全量 zip 耗时中被关进程)也不重复已完成的步骤
      await writeMarker({ lastDb: today, lastZip: marker.lastZip })
    } catch (e) {
      logger.warn('[backup]', `自动数据库备份失败: ${(e as Error).message}`)
    }
  }
  if (marker.lastZip !== week) {
    try {
      const zipPath = join(backupDir(), `lumen-full-${today}.zip`)
      await backupLibraryToZip(zipPath)
      await pruneZipBackups()
      done.zip = zipPath
      await writeMarker({ lastDb: marker.lastDb !== today && done.db ? today : marker.lastDb, lastZip: week })
    } catch (e) {
      logger.warn('[backup]', `自动全量备份失败: ${(e as Error).message}`)
    }
  }

  if (done.db || done.zip) {
    logger.info('[backup]', `自动备份完成 db=${!!done.db} zip=${!!done.zip}`)
  }
  return Object.keys(done).length > 0 ? done : null
}
