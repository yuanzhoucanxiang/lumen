import { existsSync, statSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { loadConfig } from './library'
import { importFiles } from './importer'

const watchers = new Map<string, FSWatcher>()
const pending = new Map<string, ReturnType<typeof setTimeout>>()

let notify: (count: number) => void = () => {}

function handleFile(filePath: string): void {
  // 防抖：文件写入过程中会触发多次事件
  const timer = pending.get(filePath)
  if (timer) clearTimeout(timer)
  pending.set(
    filePath,
    setTimeout(async () => {
      pending.delete(filePath)
      try {
        if (!existsSync(filePath) || !statSync(filePath).isFile()) return
        const cfg = loadConfig()
        // 避免监控库自身目录造成循环
        if (filePath.startsWith(cfg.current)) return
        const result = await importFiles([filePath], { move: cfg.importMode === 'move' })
        if (result.imported > 0) notify(result.imported)
      } catch {
        /* 单文件失败忽略 */
      }
    }, 500)
  )
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
  } catch {
    /* 目录不可读则跳过 */
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
}
