/**
 * Agent 操作记录与回退（里程碑 171/172）。
 *
 * 背景：外部 Agent 通过 HTTP 改库（导入/打标签/归档/星级/上板/改备注）对用户是不可见的，
 * 用户只能事后在图库里发现变化。本模块把每次写操作落一条审计记录，助手面板可查、可回退。
 *
 * 粒度（172 细化）：每条记录带 `items[]`（逐个受影响的素材/画布元素，含改动前原值），
 * 支持**逐项回退**——可只撤销批里的某几个，全部撤完该条自动标记为已回退。
 *
 * 设计要点：
 * - payload 存「实际影响项与原值」，而非原始请求——回退精确，不受条件检索结果随时间变化影响
 * - **只记「本次真正改动的项」**（里程碑 182）：素材原本就带该标签 / 已在该文件夹的，不进记录，
 *   回退时也就不会把用户原有的整理摘掉；star/note 另存 next，用户事后改过的值回退时不动
 * - undone_items 单独一列记录已逐项回退的 item id（payload 保持原始审计数据不被改写）
 * - 移动导入（源文件已删）标记不可回退
 * - 回退本身不写新记录（避免递归噪音）
 */
import { getDb } from './db'
import { logger } from './logger'
import type { AgentOpView } from '../shared/types'
import {
  addTagToAssets,
  deleteAssets,
  deleteBoardItem,
  getAssetById,
  removeFromFolder,
  removeTagFromAssets,
  updateAsset
} from './repository'

export type AgentOpAction = 'import' | 'tag' | 'untag' | 'folder' | 'star' | 'board' | 'note'

/** 记录中的一个受影响项 */
export interface AgentOpItem {
  /** 回退目标 id：素材 id（import/tag/untag/folder/star/note）或画布元素 id（board） */
  id: string
  /** 展示名（素材名） */
  name: string
  /** board 项额外记录对应素材 id（面板缩略图用） */
  assetId?: string
  /** star / note：改动前的原值 */
  prev?: unknown
  /** star / note：本次操作设成的值（回退时用来判断"用户事后有没有自己改过"）。里程碑 182 */
  next?: unknown
}

export type AgentOp = AgentOpView

/** 生成批次键：同一次请求里的多条记录共享，面板归纳成组（里程碑 174） */
export function newGroupKey(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

interface OpRow {
  id: number
  ts: number
  action: string
  summary: string
  payload: string
  affected: number
  undone: number
  undone_items: string
  group_key: string
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 记录一条 Agent 写操作（payload 含逐项明细，支撑逐项回退） */
export function logAgentOp(
  action: AgentOpAction,
  summary: string,
  payload: {
    items: AgentOpItem[]
    tag?: string
    folderId?: number
    folderName?: string
    boardId?: number
    undoable?: boolean
  },
  affected: number,
  groupKey = ''
): void {
  if (payload.items.length === 0) return
  try {
    getDb()
      .prepare('INSERT INTO agent_ops (ts, action, summary, payload, affected, group_key) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Date.now(), action, summary.slice(0, 200), JSON.stringify(payload), affected, groupKey)
    logger.info('[agentOps]', `${action}: ${summary} (影响 ${affected})`)
  } catch (e) {
    // 记录失败绝不影响业务操作本身
    logger.warn('[agentOps]', `写记录失败: ${(e as Error).message}`)
  }
}

/** 由素材 id 列表构造 items（带名字，供面板展示） */
export function itemsFromAssetIds(ids: string[]): AgentOpItem[] {
  return ids.map((id) => {
    const a = getAssetById(id)
    return { id, name: a?.name ?? id }
  })
}

/** 操作记录保留策略（里程碑 185）：表只写不删会一直涨，按"最多 5000 条 / 最多 90 天"裁剪。
 *  在启动维护里跑（应用重启频繁，够用），超龄与超量的老记录会失去可回退能力。 */
export const AGENT_OPS_MAX_ROWS = 5000
export const AGENT_OPS_MAX_AGE_DAYS = 90

export function pruneAgentOps(opts?: { maxRows?: number; maxAgeDays?: number }): number {
  const maxRows = Math.max(1, opts?.maxRows ?? AGENT_OPS_MAX_ROWS)
  const maxAgeDays = Math.max(1, opts?.maxAgeDays ?? AGENT_OPS_MAX_AGE_DAYS)
  try {
    const db = getDb()
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const byAge = db.prepare('DELETE FROM agent_ops WHERE ts < ?').run(cutoff).changes
    // 按 ts 保留最近 N 条（ts 相同再按 id 兜底，避免同毫秒批次被误裁）
    const byCount = db
      .prepare(
        `DELETE FROM agent_ops WHERE id NOT IN (
           SELECT id FROM agent_ops ORDER BY ts DESC, id DESC LIMIT ?
         )`
      )
      .run(maxRows).changes
    const n = byAge + byCount
    if (n > 0) logger.info('[agentOps]', `操作记录已裁剪 ${n} 条（保留最近 ${maxRows} 条 / ${maxAgeDays} 天）`)
    return n
  } catch (e) {
    logger.warn('[agentOps]', `操作记录裁剪失败: ${(e as Error).message}`)
    return 0
  }
}

/** 清空全部操作记录（设置页手动触发；清空后无法再回退这些操作） */
export function clearAgentOps(): number {
  try {
    const n = getDb().prepare('DELETE FROM agent_ops').run().changes
    logger.info('[agentOps]', `操作记录已清空 ${n} 条`)
    return n
  } catch (e) {
    logger.warn('[agentOps]', `清空操作记录失败: ${(e as Error).message}`)
    return 0
  }
}

/** 最近的操作记录（倒序，面板展示用；含逐项明细与逐项回退状态） */
export function listAgentOps(limit = 30): AgentOp[] {
  const rows = getDb()
    .prepare(
      'SELECT id, ts, action, summary, payload, affected, undone, undone_items, group_key FROM agent_ops ORDER BY ts DESC, id DESC LIMIT ?'
    )
    .all(Math.min(Math.max(limit, 1), 200)) as OpRow[]
  return rows.map((r) => {
    const p = parseJson<{ items?: AgentOpItem[]; undoable?: boolean }>(r.payload, {})
    const undoneIds = new Set(parseJson<string[]>(r.undone_items, []))
    const items = (p.items ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      assetId: it.assetId,
      undone: undoneIds.has(it.id)
    }))
    return {
      id: r.id,
      ts: r.ts,
      action: r.action as AgentOpAction,
      summary: r.summary,
      affected: r.affected,
      undone: r.undone === 1,
      undoable: p.undoable !== false,
      items,
      undoneCount: items.filter((i) => i.undone).length,
      groupKey: r.group_key ?? ''
    }
  })
}

/**
 * 回退一条记录：itemIds 缺省 = 全部未回退项；给了则只回退其中指定项（逐项回退）。
 * 全部项回退完成后该记录自动标记为已回退。
 */
export function undoAgentOp(
  id: number,
  itemIds?: string[]
): { ok: boolean; message: string; undoneCount?: number; remaining?: number } {
  const db = getDb()
  const row = db
    .prepare('SELECT id, ts, action, summary, payload, affected, undone, undone_items, group_key FROM agent_ops WHERE id = ?')
    .get(id) as OpRow | undefined
  if (!row) return { ok: false, message: '记录不存在' }
  if (row.undone === 1) return { ok: false, message: '该操作已回退过' }
  const p = parseJson<{ items?: AgentOpItem[]; tag?: string; folderId?: number; folderName?: string; undoable?: boolean }>(
    row.payload,
    {}
  )
  if (p.undoable === false) return { ok: false, message: '该操作不可回退（移动导入的源文件已删除）' }

  const allItems = p.items ?? []
  if (allItems.length === 0) return { ok: false, message: '该记录没有可回退的项' }
  const doneIds = new Set(parseJson<string[]>(row.undone_items, []))
  const want = itemIds && itemIds.length > 0 ? new Set(itemIds) : null
  const targets = allItems.filter((it) => !doneIds.has(it.id) && (!want || want.has(it.id)))
  if (targets.length === 0) return { ok: false, message: '选中的项都已回退' }

  let message = ''
  try {
    switch (row.action as AgentOpAction) {
      case 'import': {
        const ids = targets.map((t) => t.id)
        deleteAssets(ids, false)
        message = `已把 ${ids.length} 个素材移入回收站`
        break
      }
      case 'tag': {
        const tag = String(p.tag ?? '')
        const n = removeTagFromAssets(targets.map((t) => t.id), tag)
        message = `已摘除 ${n} 个素材的「${tag}」标签`
        break
      }
      case 'untag': {
        const tag = String(p.tag ?? '')
        addTagToAssets(targets.map((t) => t.id), tag)
        message = `已为 ${targets.length} 个素材恢复「${tag}」标签`
        break
      }
      case 'folder': {
        const folderId = Number(p.folderId)
        if (Number.isInteger(folderId)) removeFromFolder(targets.map((t) => t.id), folderId)
        message = `已把 ${targets.length} 个素材移出「${String(p.folderName ?? '文件夹')}」`
        break
      }
      case 'star': {
        // 只覆盖"还是本次操作设的那个值"的素材：用户事后自己改过星级就不动它（里程碑 182）
        let n = 0
        let kept = 0
        for (const t of targets) {
          const a = getAssetById(t.id)
          if (!a) continue
          const setTo = typeof t.next === 'number' ? t.next : null
          if (setTo !== null && a.star !== setTo) {
            kept++
            continue
          }
          updateAsset(t.id, { star: typeof t.prev === 'number' ? t.prev : 0 })
          n++
        }
        message = `已恢复 ${n} 个素材的原星级`
        if (kept > 0) message += `（${kept} 个已被后续修改，保持不动）`
        break
      }
      case 'note': {
        // 同理：用户事后重写过备注就不再覆盖（里程碑 182）
        let n = 0
        let kept = 0
        for (const t of targets) {
          const a = getAssetById(t.id)
          if (!a) continue
          const setTo = typeof t.next === 'string' ? t.next : null
          if (setTo !== null && a.comment !== setTo) {
            kept++
            continue
          }
          updateAsset(t.id, { comment: typeof t.prev === 'string' ? t.prev : '' })
          n++
        }
        message = `已恢复 ${n} 个素材的原备注`
        if (kept > 0) message += `（${kept} 个已被后续修改，保持不动）`
        break
      }
      case 'board': {
        for (const t of targets) deleteBoardItem(t.id)
        message = `已从白板移除 ${targets.length} 个元素`
        break
      }
      default:
        return { ok: false, message: `未知操作类型: ${row.action}` }
    }

    const newDone = [...doneIds, ...targets.map((t) => t.id)]
    const remaining = allItems.length - newDone.length
    if (remaining <= 0) {
      db.prepare('UPDATE agent_ops SET undone = 1, undone_at = ?, undone_items = ? WHERE id = ?').run(
        Date.now(),
        JSON.stringify(newDone),
        id
      )
    } else {
      db.prepare('UPDATE agent_ops SET undone_items = ? WHERE id = ?').run(JSON.stringify(newDone), id)
      message += `（还剩 ${remaining} 项未回退）`
    }
    logger.info('[agentOps]', `回退 #${id} (${row.action}) ${targets.length} 项: ${message}`)
    return { ok: true, message, undoneCount: newDone.length, remaining }
  } catch (e) {
    logger.warn('[agentOps]', `回退 #${id} 失败: ${(e as Error).message}`)
    return { ok: false, message: `回退失败: ${(e as Error).message}` }
  }
}
