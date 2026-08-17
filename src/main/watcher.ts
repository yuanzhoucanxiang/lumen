import { existsSync, statSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { loadConfig } from './library'
import { collectFiles, importFiles } from './importer'
import { logger } from './logger'

const watchers = new Map<string, FSWatcher>()
/** 防抖窗口内累积的待导入文件(Set 天然去重同一文件的多事件) */
const pendingPaths = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

let notify: (count: number) => void = () => {}

/** 500ms 防抖窗口攒批,窗口结束时一次导入全部(此前每文件一个定时器+一次导入) */
function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => void flush(), 500)
}

async function flush(): Promise<void> {
  flushTimer = null
  if (pendingPaths.size === 0) return
  const paths = [...pendingPaths]
  pendingPaths.clear()
  try {
    const cfg = loadConfig()
    // 过滤:已消失的/非文件的/落在素材库自身目录内的(防循环)
    const valid = paths.filter(
      (p) => existsSync(p) && statSync(p).isFile() && !p.startsWith(cfg.current)
    )
    if (valid.length === 0) return
    const result = await importFiles(valid, { move: cfg.importMode === 'move', checkTombstone: true })
    if (result.imported > 0) notify(result.imported)
    if (result.failed > 0) logger.warn('[watcher]', `批量导入失败 ${result.failed}/${valid.length} 个文件`)
  } catch (e) {
    logger.warn('[watcher]', `监控导入失败(${paths.length} 文件): ${(e as Error).message}`)
  }
}

function handleFile(filePath: string): void {
  pendingPaths.add(filePath)
  scheduleFlush()
}

function watchDir(dir: string): void {
  if (watchers.has(dir) || !existsSync(dir)) return
  try {
    // recursive：子目录内的新文件也自动导入（Windows 支持递归 fs.watch）
    const w = watch(dir, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      if (eventType === 'rename' || eventType === 'change') {
        handleFile(join(dir, filename))
      }
    })
    watchers.set(dir, w)
  } catch (e) {
    logger.warn('[watcher]', `监控目录失败 ${dir}: ${(e as Error).message}`)
  }
}

function unwatchDir(dir: string): void {
  const w = watchers.get(dir)
  if (w) {
    w.close()
    watchers.delete(dir)
  }
}

/** 根据当前配置同步监控目录列表 */
export function syncWatchers(onImported: (count: number) => void): void {
  notify = onImported
  const dirs = loadConfig().watchDirs
  for (const dir of [...watchers.keys()]) {
    if (!dirs.includes(dir)) unwatchDir(dir)
  }
  for (const dir of dirs) watchDir(dir)
}

export function stopWatchers(): void {
  for (const dir of [...watchers.keys()]) unwatchDir(dir)
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  pendingPaths.clear()
}

/**
 * 启动增量同步：扫描所有监控文件夹，导入软件关闭期间新增的文件。
 * 复用 importFiles 的查重逻辑（name+size 已入库的会 skip），实现「启动即补导入」。
 * 类 Eagle 行为：关机时往监控目录放的新图，下次启动自动入库。
 */
export async function syncOnStartup(onImported: (count: number) => void): Promise<void> {
  const dirs = loadConfig().watchDirs
  if (dirs.length === 0) return
  const files = await collectFiles(dirs)
  if (files.length === 0) return
  logger.info('[watcher]', `启动增量同步：扫描 ${dirs.length} 个监控目录，${files.length} 个文件`)
  // importMode 由 loadConfig 决定，syncOnStartup 用 copy（不删源文件，监控目录的文件要保留）
  // checkTombstone: 已删除文件不再自动重导入(尊重删除记忆)
  const result = await importFiles(files, { checkTombstone: true })
  if (result.imported > 0) {
    logger.info('[watcher]', `启动增量同步完成：新增 ${result.imported}，跳过 ${result.skipped}，失败 ${result.failed}`)
    onImported(result.imported)
  } else {
    logger.info('[watcher]', `启动增量同步完成：无新增（跳过 ${result.skipped}）`)
  }
}
