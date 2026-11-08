/**
 * 预览缓存保留策略（里程碑 223）：
 * LOD 预览按需生成，长期使用会在 userData/preview-cache 里累积；
 * 启动维护时按「30 天未访问 + 总量 512MB 上限」清理，最旧的先删。
 * 纯 fs 实现（不依赖 electron），便于脚本级测试。
 */
import { readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

export interface PrunePreviewOptions {
  /** 超过多少天未访问就删（按 mtime） */
  maxAgeDays?: number
  /** 总量上限（字节），超出后按最旧优先删 */
  maxBytes?: number
  /** 当前时间（测试注入） */
  now?: number
}

export interface PrunePreviewResult {
  removed: number
  freedBytes: number
  kept: number
  keptBytes: number
}

export function prunePreviewCache(dir: string, opts: PrunePreviewOptions = {}): PrunePreviewResult {
  const maxAgeDays = opts.maxAgeDays ?? 30
  const maxBytes = opts.maxBytes ?? 512 * 1024 * 1024
  const now = opts.now ?? Date.now()
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000

  const entries: { file: string; size: number; mtime: number }[] = []
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jpg')) continue
      const file = join(dir, name)
      try {
        const st = statSync(file)
        if (st.isFile()) entries.push({ file, size: st.size, mtime: st.mtimeMs })
      } catch {
        /* 文件在读目录与 stat 之间消失：跳过 */
      }
    }
  } catch {
    return { removed: 0, freedBytes: 0, kept: 0, keptBytes: 0 }
  }

  let removed = 0
  let freedBytes = 0
  let kept = entries.filter((e) => {
    if (e.mtime >= cutoff) return true
    try {
      unlinkSync(e.file)
      removed++
      freedBytes += e.size
      return false
    } catch {
      return true
    }
  })

  let keptBytes = kept.reduce((s, e) => s + e.size, 0)
  if (keptBytes > maxBytes) {
    kept.sort((a, b) => a.mtime - b.mtime) // 最旧的先删
    const survivors: typeof kept = []
    for (const e of kept) {
      if (keptBytes > maxBytes) {
        try {
          unlinkSync(e.file)
          removed++
          freedBytes += e.size
          keptBytes -= e.size
        } catch {
          survivors.push(e)
        }
      } else {
        survivors.push(e)
      }
    }
    kept = survivors
  }

  return { removed, freedBytes, kept: kept.length, keptBytes }
}
