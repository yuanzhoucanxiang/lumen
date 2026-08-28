import { app } from 'electron'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { copyFileSync, existsSync, renameSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, join, relative } from 'path'
import Database from 'better-sqlite3'
import { getDb, closeDb, openDb } from './db'
import { getLibraryPath } from './library'
import { logger } from './logger'
import { zipStoreStreamToFile, type ZipStreamEntry } from './zipLib'
import type { DbBackupInfo, ZipBackupInfo } from '../shared/types'

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
 * 注意必须 await 完成:大库热备耗时数秒,fire-and-forget 会让"备份完成"成为假象,
 * 且后台热备持有源库句柄,期间恢复/清理 wal 会 EBUSY(里程碑 105 实证)。
 */
export async function backupDatabase(): Promise<string> {
  const libPath = getLibraryPath()
  const target = join(libPath, 'library.db.bak')
  rotateDbBackups()
  const db = getDb()
  await db.backup(target)
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
      await backupDatabase()
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

/* ---------------- 恢复 ---------------- */

/** 列出库目录内的数据库快照(library.db.bak 系列,最新在前)。libPath 可注入供测试 */
export function listDbBackups(libPath = getLibraryPath()): DbBackupInfo[] {
  const out: DbBackupInfo[] = []
  for (const suffix of ['', '.1', '.2']) {
    const p = join(libPath, `library.db.bak${suffix}`)
    try {
      const st = statSync(p)
      out.push({ path: p, mtimeMs: st.mtimeMs, sizeBytes: st.size })
    } catch {
      /* 该代不存在 */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** 列出自动全量 ZIP 备份(userData/backups,最新在前),供展示与打开位置 */
export async function listAutoZipBackups(): Promise<ZipBackupInfo[]> {
  const dir = backupDir()
  const out: ZipBackupInfo[] = []
  try {
    for (const name of await readdir(dir)) {
      if (!/^lumen-full-.+\.zip$/.test(name)) continue
      const p = join(dir, name)
      const st = await stat(p)
      out.push({ path: p, mtimeMs: st.mtimeMs, sizeBytes: st.size })
    }
  } catch {
    /* 目录不存在 */
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * 从指定快照恢复数据库:
 * ①校验路径必须位于当前库目录且为 library.db.bak 系列(防任意文件读取);
 * ②先把当前 library.db 复制为 .pre-restore-<时间戳> 现场(误恢复可反悔);
 * ③closeDb → 覆盖 → 清 -wal/-shm(旧 wal 重放会损坏数据) → openDb(内部 quick_check 兜底校验)。
 *
 * 关键约束:③必须同步一口气完成,不得让出事件循环——若 close 与 open 之间有并发 IPC
 * 触发 getDb(),会重建连接并把 wal 重新锁住,导致清理永久 EBUSY(里程碑 105 实证)。
 * 故重试用 Atomics.wait 同步短阻塞(恢复为低频重操作,亚秒级阻塞可接受);
 * 同时覆盖 Windows 下 Defender/索引服务对 wal/shm 的延迟解锁。
 * 不触碰 config.json,当前库不变。libPath 可注入供测试。
 */
export function restoreDatabase(bakPath: string, libPath = getLibraryPath()): { restoredFrom: string; emergencyPath: string } {
  const allowed = new Set(['library.db.bak', 'library.db.bak.1', 'library.db.bak.2'])
  if (!allowed.has(basename(bakPath)) || dirname(bakPath) !== libPath) {
    throw new Error(`非法的备份路径: ${bakPath}`)
  }
  if (!existsSync(bakPath)) throw new Error(`备份文件不存在: ${bakPath}`)

  // 预校验备份文件是合法 SQLite 库：坏 .bak 若直接覆盖在用库，openDb 失败后应用会话内砖化
  const probePath = `${bakPath}.restore-check`
  try {
    copyFileSync(bakPath, probePath)
    const probe = new Database(probePath, { readonly: true })
    try {
      const ok = probe.pragma('quick_check', { simple: true })
      if (ok !== 'ok') throw new Error(`quick_check=${String(ok)}`)
    } finally {
      probe.close()
    }
  } catch (e) {
    throw new Error(`备份文件无效,已取消恢复: ${(e as Error).message}`)
  } finally {
    try {
      if (existsSync(probePath)) unlinkSync(probePath)
    } catch {
      /* 探针清理失败不阻断恢复 */
    }
  }

  const dbPath = join(libPath, 'library.db')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const emergencyPath = join(libPath, `library.db.pre-restore-${stamp}`)
  if (existsSync(dbPath)) copyFileSync(dbPath, emergencyPath)

  const sleepSync = (ms: number): void => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  }

  closeDb()
  copyFileSync(bakPath, dbPath)
  let cleanFailed: (Error & { code?: string }) | null = null
  for (const side of ['-wal', '-shm']) {
    const sidePath = dbPath + side
    for (let attempt = 0; ; attempt++) {
      try {
        if (existsSync(sidePath)) unlinkSync(sidePath)
        break
      } catch (e) {
        if (attempt >= 12) {
          cleanFailed = e as Error
          break
        }
        sleepSync(120)
      }
    }
    if (cleanFailed) break
  }

  if (cleanFailed) {
    // 恢复无法完成(典型:另一 LUMEN 实例占用同库锁着 wal)。此时绝不能让应用停留在
    // "连接已关、未重开"的砖化状态:把现场复制回去并重开连接(WAL 支持多进程,另一实例
    // 会继续维护其 wal),然后再抛出可操作的错误。
    const occupied = cleanFailed.code === 'EBUSY' || cleanFailed.code === 'EPERM'
    try {
      copyFileSync(emergencyPath, dbPath)
      openDb(libPath)
    } catch (rbErr) {
      logger.error('[backup]', `恢复中断且回滚失败: ${(rbErr as Error).message};请重启应用`)
      throw new Error(`恢复中断且自动回滚失败,请重启应用后在设置中重试:${cleanFailed.message}`)
    }
    logger.warn('[backup]', `恢复被占用中断,已回滚保留原库(${basename(emergencyPath)} 为额外现场)`)
    throw new Error(
      occupied
        ? '素材库正被另一个 LUMEN 实例或程序占用,无法完成恢复。请关闭其他 LUMEN 窗口后重试。'
        : `清理 ${basename(dbPath)} 配套文件失败: ${cleanFailed.message}`
    )
  }
  try {
    openDb(libPath)
  } catch (e) {
    logger.error('[backup]', `恢复后校验失败(${basename(bakPath)}): ${(e as Error).message};原库现场保留于 ${emergencyPath}`)
    throw e
  }
  logger.info('[backup]', `数据库已从 ${basename(bakPath)} 恢复;原库另存为 ${basename(emergencyPath)}`)
  return { restoredFrom: bakPath, emergencyPath }
}
