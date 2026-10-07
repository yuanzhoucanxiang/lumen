/**
 * Agent 操作记录与回退（里程碑 171）。
 *
 * 背景：外部 Agent 通过 HTTP 改库（导入/打标签/归档/星级/上板/改备注）对用户是不可见的，
 * 用户只能事后在图库里发现变化。本模块把每次写操作落一条审计记录（含撤销所需的完整数据），
 * 助手面板可查、可一键回退。
 *
 * 设计要点：
 * - payload 存「实际影响到的 ids / 原值映射」，而非原始请求——这样回退是精确的，
 *   即使条件检索结果随时间变化也不影响撤销正确性
 * - 一次性回退（undone 置位）；移动导入（源文件已删）标记不可回退
 * - 回退本身不写新记录（避免递归噪音）
 */
import { getDb } from './db'
import { logger } from './logger'
import type { AgentOpView } from '../shared/types'
import {
  addTagToAssets,
  addToFolder,
  deleteAssets,
  deleteBoardItem,
  getAssetById,
  removeFromFolder,
  removeTagFromAssets,
  updateAsset
} from './repository'

export type AgentOpAction = 'import' | 'tag' | 'untag' | 'folder' | 'star' | 'board' | 'note'

export type AgentOp = AgentOpView

interface OpRow {
  id: number
  ts: number
  action: string
  summary: string
  payload: string
  affected: number
  undone: number
}

/** 记录一条 Agent 写操作（caller 提供撤销所需的 payload 与受影响数量） */
export function logAgentOp(
  action: AgentOpAction,
  summary: string,
  payload: Record<string, unknown>,
  affected: number
): void {
  try {
    getDb()
      .prepare('INSERT INTO agent_ops (ts, action, summary, payload, affected) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), action, summary.slice(0, 200), JSON.stringify(payload), affected)
    logger.info('[agentOps]', `${action}: ${summary} (影响 ${affected})`)
  } catch (e) {
    // 记录失败绝不影响业务操作本身
    logger.warn('[agentOps]', `写记录失败: ${(e as Error).message}`)
  }
}

/** 最近的操作记录（倒序，面板展示用） */
export function listAgentOps(limit = 30): AgentOp[] {
  const rows = getDb()
    .prepare('SELECT id, ts, action, summary, payload, affected, undone FROM agent_ops ORDER BY ts DESC, id DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 200)) as OpRow[]
  return rows.map((r) => {
    let undoable = true
    try {
      undoable = (JSON.parse(r.payload) as { undoable?: boolean }).undoable !== false
    } catch {
      /* payload 损坏时保守允许撤销 */
    }
    return {
      id: r.id,
      ts: r.ts,
      action: r.action as AgentOpAction,
      summary: r.summary,
      affected: r.affected,
      undone: r.undone === 1,
      undoable
    }
  })
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 按记录撤销一次操作（每种动作的逆操作）；返回人类可读结果 */
export function undoAgentOp(id: number): { ok: boolean; message: string } {
  const db = getDb()
  const row = db
    .prepare('SELECT id, ts, action, summary, payload, affected, undone FROM agent_ops WHERE id = ?')
    .get(id) as OpRow | undefined
  if (!row) return { ok: false, message: '记录不存在' }
  if (row.undone === 1) return { ok: false, message: '该操作已回退过' }
  const p = parsePayload(row.payload)
  if (p.undoable === false) return { ok: false, message: '该操作不可回退（移动导入的源文件已删除）' }

  const ids = Array.isArray(p.assetIds) ? (p.assetIds as string[]) : []
  let message = ''
  try {
    switch (row.action as AgentOpAction) {
      case 'import': {
        const n = ids.length
        if (n > 0) deleteAssets(ids, false)
        message = `已把 ${n} 个素材移入回收站`
        break
      }
      case 'tag': {
        const tag = String(p.tag ?? '')
        const n = removeTagFromAssets(ids, tag)
        message = `已摘除 ${n} 个素材的「${tag}」标签`
        break
      }
      case 'untag': {
        const tag = String(p.tag ?? '')
        addTagToAssets(ids, tag)
        message = `已为 ${ids.length} 个素材恢复「${tag}」标签`
        break
      }
      case 'folder': {
        const folderId = Number(p.folderId)
        if (Number.isInteger(folderId) && ids.length > 0) removeFromFolder(ids, folderId)
        message = `已把 ${ids.length} 个素材移出「${String(p.folderName ?? '文件夹')}」`
        break
      }
      case 'star': {
        const prev = (p.prev ?? {}) as Record<string, number>
        let n = 0
        for (const [assetId, star] of Object.entries(prev)) {
          if (getAssetById(assetId)) {
            updateAsset(assetId, { star })
            n++
          }
        }
        message = `已恢复 ${n} 个素材的原星级`
        break
      }
      case 'board': {
        const itemIds = Array.isArray(p.itemIds) ? (p.itemIds as string[]) : []
        for (const itemId of itemIds) deleteBoardItem(itemId)
        message = `已从白板移除 ${itemIds.length} 个元素`
        break
      }
      case 'note': {
        const prev = (p.prev ?? {}) as Record<string, string>
        let n = 0
        for (const [assetId, comment] of Object.entries(prev)) {
          if (getAssetById(assetId)) {
            updateAsset(assetId, { comment })
            n++
          }
        }
        message = `已恢复 ${n} 个素材的原备注`
        break
      }
      default:
        return { ok: false, message: `未知操作类型: ${row.action}` }
    }
    db.prepare('UPDATE agent_ops SET undone = 1, undone_at = ? WHERE id = ?').run(Date.now(), id)
    logger.info('[agentOps]', `回退 #${id} (${row.action}): ${message}`)
    return { ok: true, message }
  } catch (e) {
    logger.warn('[agentOps]', `回退 #${id} 失败: ${(e as Error).message}`)
    return { ok: false, message: `回退失败: ${(e as Error).message}` }
  }
}

/** 便捷封装：把一批素材追加进文件夹（/folder 端点与记录一体） */
export function addAssetsToFolderLogged(
  assetIds: string[],
  folderId: number,
  folderName: string
): void {
  addToFolder(assetIds, folderId)
  logAgentOp('folder', `把 ${assetIds.length} 个素材归入文件夹「${folderName}」`, { assetIds, folderId, folderName }, assetIds.length)
}
