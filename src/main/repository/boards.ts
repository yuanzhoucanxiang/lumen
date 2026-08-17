import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { stmt } from '../stmtCache'
import type { Board, BoardItem } from '../../shared/types'

export function listBoards(): Board[] {
  return stmt(
    getDb(),
    `SELECT id, name, created_at AS createdAt, updated_at AS updatedAt, guides, appearance
       FROM boards ORDER BY updated_at DESC`
  ).all() as Board[]
}

export function createBoard(name: string): Board {
  const db = getDb()
  const now = Date.now()
  const info = db.prepare('INSERT INTO boards (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, now, now)
  return { id: Number(info.lastInsertRowid), name, createdAt: now, updatedAt: now, guides: '[]', appearance: '{"bg":"dark","grid":true,"gridSize":24}' }
}

export function renameBoard(id: number, name: string): void {
  getDb().prepare('UPDATE boards SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
}

/** 删除白板（级联删除其元素） */
export function deleteBoard(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM board_items WHERE board_id = ?').run(id)
  db.prepare('DELETE FROM boards WHERE id = ?').run(id)
}

interface BoardItemRow {
  id: string
  board_id: number
  asset_id: string | null
  type: string
  x: number
  y: number
  width: number
  height: number
  z: number
  text: string
  note_font: string
  note_color: string
  note_font_size: number
  opacity: number
  shape: string | null
  created_at: number
}

function rowToBoardItem(r: BoardItemRow): BoardItem {
  return {
    id: r.id,
    boardId: r.board_id,
    assetId: r.asset_id,
    type: r.type === 'note' ? 'note' : r.type === 'shape' ? 'shape' : 'asset',
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    z: r.z,
    text: r.text,
    noteFont: r.note_font ?? '',
    noteColor: r.note_color ?? '',
    noteFontSize: r.note_font_size ?? 16,
    opacity: r.opacity ?? 100,
    shape: r.shape ?? null,
    createdAt: r.created_at
  }
}

export function listBoardItems(boardId: number): BoardItem[] {
  const rows = stmt(
    getDb(),
    `SELECT id, board_id, asset_id, type, x, y, width, height, z, text, note_font, note_color, note_font_size, opacity, shape, created_at
       FROM board_items WHERE board_id = ? ORDER BY z ASC`
  ).all(boardId) as BoardItemRow[]
  return rows.map(rowToBoardItem)
}

/** 添加白板元素（asset / note / shape），返回完整元素 */
export function addBoardItem(
  boardId: number,
  item: {
    assetId?: string | null
    type: 'asset' | 'note' | 'shape'
    x: number
    y: number
    width: number
    height: number
    text?: string
    shape?: string
    opacity?: number
    noteFont?: string
    noteColor?: string
    noteFontSize?: number
  }
): BoardItem {
  const db = getDb()
  const id = randomUUID().replace(/-/g, '').slice(0, 16)
  const z = (stmt(db, 'SELECT COALESCE(MAX(z), -1) + 1 AS z FROM board_items WHERE board_id = ?').get(boardId) as { z: number }).z
  const createdAt = Date.now()
  stmt(
    db,
    `INSERT INTO board_items (id, board_id, asset_id, type, x, y, width, height, z, text, note_font, note_color, note_font_size, opacity, shape, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    boardId,
    item.assetId ?? null,
    item.type,
    item.x,
    item.y,
    item.width,
    item.height,
    z,
    item.text ?? '',
    item.noteFont ?? '',
    item.noteColor ?? '',
    item.noteFontSize ?? 16,
    item.opacity ?? 100,
    item.shape ?? null,
    createdAt
  )
  stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), boardId)
  return {
    id,
    boardId,
    assetId: item.assetId ?? null,
    type: item.type,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    z,
    text: item.text ?? '',
    noteFont: item.noteFont ?? '',
    noteColor: item.noteColor ?? '',
    noteFontSize: item.noteFontSize ?? 16,
    opacity: item.opacity ?? 100,
    shape: item.shape ?? null,
    createdAt
  }
}

/** 更新白板元素（动态 SET，x/y/width/height/z/text/noteFont/noteColor/opacity/shape 可部分更新） */
export function updateBoardItem(
  id: string,
  patch: Partial<Pick<BoardItem, 'x' | 'y' | 'width' | 'height' | 'z' | 'text' | 'noteFont' | 'noteColor' | 'noteFontSize' | 'opacity' | 'shape'>>
): void {
  const db = getDb()
  const sets: string[] = []
  const params: unknown[] = []
  const colMap: Record<string, string> = {
    x: 'x',
    y: 'y',
    width: 'width',
    height: 'height',
    z: 'z',
    text: 'text',
    noteFont: 'note_font',
    noteColor: 'note_color',
    noteFontSize: 'note_font_size',
    opacity: 'opacity',
    shape: 'shape'
  }
  for (const key of Object.keys(colMap) as (keyof typeof colMap)[]) {
    const v = patch[key as keyof typeof patch]
    if (v !== undefined) {
      sets.push(`${colMap[key]} = ?`)
      params.push(v)
    }
  }
  if (sets.length === 0) return
  const row = stmt(db, 'SELECT board_id FROM board_items WHERE id = ?').get(id) as { board_id: number } | undefined
  if (!row) return
  stmt(db, `UPDATE board_items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
  stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), row.board_id)
}

/** 批量更新白板元素（组移动/组缩放等一次性落库，事务原子） */
export function updateBoardItems(
  items: { id: string; patch: Partial<Pick<BoardItem, 'x' | 'y' | 'width' | 'height' | 'z' | 'text' | 'noteFont' | 'noteColor' | 'noteFontSize' | 'opacity' | 'shape'>> }[]
): void {
  if (items.length === 0) return
  const db = getDb()
  const colMap: Record<string, string> = {
    x: 'x',
    y: 'y',
    width: 'width',
    height: 'height',
    z: 'z',
    text: 'text',
    noteFont: 'note_font',
    noteColor: 'note_color',
    noteFontSize: 'note_font_size',
    opacity: 'opacity',
    shape: 'shape'
  }
  const run = db.transaction(() => {
    const touched = new Set<number>()
    // 语句缓存:组拖拽每帧批量落库,SELECT/UPDATE 走缓存不再逐条重编译
    const selBoard = stmt(db, 'SELECT board_id FROM board_items WHERE id = ?')
    const touchBoard = stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?')
    for (const { id, patch } of items) {
      const sets: string[] = []
      const params: unknown[] = []
      for (const key of Object.keys(colMap) as (keyof typeof colMap)[]) {
        const v = patch[key as keyof typeof patch]
        if (v !== undefined) {
          sets.push(`${colMap[key]} = ?`)
          params.push(v)
        }
      }
      if (sets.length === 0) continue
      const row = selBoard.get(id) as { board_id: number } | undefined
      if (!row) continue
      stmt(db, `UPDATE board_items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
      touched.add(row.board_id)
    }
    // updated_at 刷新并入事务：与元素更新原子提交
    for (const boardId of touched) {
      touchBoard.run(Date.now(), boardId)
    }
  })
  run()
}

export function deleteBoardItem(id: string): void {
  const db = getDb()
  const row = stmt(db, 'SELECT board_id FROM board_items WHERE id = ?').get(id) as { board_id: number } | undefined
  stmt(db, 'DELETE FROM board_items WHERE id = ?').run(id)
  if (row) stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), row.board_id)
}

/** 置顶：z = 当前最大值 + 1（起点 -1 与 addBoardItem 一致,空画板首元素 z=0） */
export function bringBoardItemToFront(id: string, boardId: number): void {
  const db = getDb()
  const z = (stmt(db, 'SELECT COALESCE(MAX(z), -1) + 1 AS z FROM board_items WHERE board_id = ?').get(boardId) as { z: number }).z
  stmt(db, 'UPDATE board_items SET z = ? WHERE id = ?').run(z, id)
  stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), boardId)
}

/** 保存白板参考线（JSON 数组，整体覆盖） */
export function updateBoardGuides(boardId: number, guidesJson: string): void {
  const db = getDb()
  db.prepare('UPDATE boards SET guides = ?, updated_at = ? WHERE id = ?').run(guidesJson, Date.now(), boardId)
}

/** 保存白板画布外观（JSON：{bg,grid,gridSize}，整体覆盖） */
export function updateBoardAppearance(boardId: number, appearanceJson: string): void {
  const db = getDb()
  db.prepare('UPDATE boards SET appearance = ?, updated_at = ? WHERE id = ?').run(appearanceJson, Date.now(), boardId)
}
