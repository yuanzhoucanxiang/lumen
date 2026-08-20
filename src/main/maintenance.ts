/**
 * 启动维护任务(异步、低优先、不阻塞启动):
 * ① 孤儿素材目录清理:导入是"先复制文件、后写库",中途崩溃会留下无 DB 记录的目录;
 * ② dHash 缺失回填:老库/异常导入的素材 hash='',findDuplicates/findSimilar 查询时
 *    反复现算,改为启动时一次性回填。
 * 两个函数均可注入 db/libPath(测试用临时库),生产默认取全局库。
 */
import { readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { cpus } from 'os'
import type Database from 'better-sqlite3'
import { getDb } from './db'
import { getLibraryPath } from './library'
import { assetKindOf, computeDHash } from './importer'
import { computeNamePinyin } from './pinyin'
import { logger } from './logger'

const ASSET_DIR_RE = /^[0-9a-f]{2}$/
const ASSET_ID_RE = /^[0-9a-f]{16}$/

/** 简易并发池(保持结果顺序,limit<=1 退化串行) */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 清理无 DB 记录的孤儿素材目录(仅匹配 assets/xx/{16hex} 严格结构,保守删除)。
 * 返回删除数量。
 */
export async function cleanupOrphanAssets(
  libPath: string = getLibraryPath(),
  db: Database.Database = getDb()
): Promise<number> {
  const assetsRoot = join(libPath, 'assets')
  if (!existsSync(assetsRoot)) return 0
  const known = new Set<string>()
  for (const r of db.prepare('SELECT rel_dir FROM assets').all() as { rel_dir: string }[]) {
    known.add(r.rel_dir.replace(/\\/g, '/'))
  }
  let removed = 0
  for (const a of await readdir(assetsRoot)) {
    if (!ASSET_DIR_RE.test(a)) continue
    const dirA = join(assetsRoot, a)
    for (const id of await readdir(dirA)) {
      if (!ASSET_ID_RE.test(id)) continue
      const rel = `assets/${a}/${id}`
      if (known.has(rel)) continue
      try {
        await rm(join(dirA, id), { recursive: true, force: true })
        removed++
        logger.warn('[maintenance]', `清理孤儿素材目录 ${rel}(无 DB 记录,疑似导入中断残留)`)
      } catch (e) {
        logger.warn('[maintenance]', `清理孤儿目录失败 ${rel}: ${(e as Error).message}`)
      }
    }
  }
  return removed
}

/** 为 hash='' 的图片素材回填 dHash(启动时一次性,findDuplicates 查询时不再反复现算) */
export async function backfillMissingHashes(
  libPath: string = getLibraryPath(),
  db: Database.Database = getDb()
): Promise<number> {
  const rows = db
    .prepare("SELECT id, ext, rel_dir FROM assets WHERE hash = '' AND deleted_at IS NULL")
    .all() as { id: string; ext: string; rel_dir: string }[]
  if (rows.length === 0) return 0
  const upd = db.prepare('UPDATE assets SET hash = ? WHERE id = ?')
  let done = 0
  await mapWithConcurrency(rows, Math.max(1, cpus().length), async (row) => {
    if (assetKindOf(row.ext) !== 'image' || row.ext === 'svg') return
    const filePath = join(libPath, row.rel_dir, `${row.id}.${row.ext}`)
    const h = await computeDHash(filePath)
    if (h) {
      upd.run(h, row.id)
      done++
    }
  })
  if (done > 0) logger.info('[maintenance]', `回填 dHash ${done}/${rows.length}`)
  return done
}

/**
 * 拼音检索串回填(里程碑 98,对标 Eagle):存量素材 name_pinyin='' 且名字含 CJK 时一次性计算。
 * 新导入/改名路径由 importer/updateAsset 维护,这里只兜底旧库;纯 ASCII 名恒为 '' 跳过。
 */
export async function backfillMissingPinyin(
  _libPath: string = getLibraryPath(),
  db: Database.Database = getDb()
): Promise<number> {
  const rows = db
    .prepare('SELECT id, name FROM assets WHERE name_pinyin = ?')
    .all('') as { id: string; name: string }[]
  if (rows.length === 0) return 0
  const upd = db.prepare('UPDATE assets SET name_pinyin = ?, name_pinyin_init = ? WHERE id = ?')
  let done = 0
  for (const row of rows) {
    const py = computeNamePinyin(row.name)
    // full 为空 = 名字不含 CJK(或计算失败),保持 '' 不动;否则落库
    if (py.full !== '') {
      upd.run(py.full, py.initial, row.id)
      done++
    }
  }
  if (done > 0) logger.info('[maintenance]', `回填拼音检索串 ${done}/${rows.length}`)
  return done
}

/** 启动维护入口(异步延迟执行,不阻塞启动) */
export async function runStartupMaintenance(): Promise<void> {
  const t0 = Date.now()
  try {
    const n = await cleanupOrphanAssets()
    if (n > 0) logger.info('[maintenance]', `孤儿素材清理完成: ${n} 个`)
  } catch (e) {
    logger.warn('[maintenance]', `孤儿清理异常: ${(e as Error).message}`)
  }
  try {
    await backfillMissingHashes()
  } catch (e) {
    logger.warn('[maintenance]', `哈希回填异常: ${(e as Error).message}`)
  }
  try {
    await backfillMissingPinyin()
  } catch (e) {
    logger.warn('[maintenance]', `拼音回填异常: ${(e as Error).message}`)
  }
  logger.info('[maintenance]', `启动维护完成 (${Date.now() - t0}ms)`)
}
