import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { stmt } from '../stmtCache'
import type { Board, BoardItem, BoardItemPatch, NewBoardItem } from '../../shared/types'

export function listBoards(): Board[] {
  return stmt(
    getDb(),
    `SELECT id, name, created_at AS createdAt, updated_at AS updatedAt, guides, appearance, viewport
       FROM boards ORDER BY updated_at DESC`
  ).all() as Board[]
}

export function createBoard(name: string): Board {
  const db = getDb()
  const now = Date.now()
  const info = db.prepare('INSERT INTO boards (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, now, now)
  return { id: Number(info.lastInsertRowid), name, createdAt: now, updatedAt: now, guides: '[]', appearance: '{"bg":"dark","grid":true,"gridSize":24}', viewport: '' }
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
  flip_x: number
  flip_y: number
  locked: number
  group_id: string
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
    flipX: !!r.flip_x,
    flipY: !!r.flip_y,
    locked: !!r.locked,
    groupId: r.group_id ?? '',
    createdAt: r.created_at
  }
}

export function listBoardItems(boardId: number): BoardItem[] {
  const rows = stmt(
    getDb(),
    `SELECT id, board_id, asset_id, type, x, y, width, height, z, text, note_font, note_color, note_font_size, opacity, shape, flip_x, flip_y, locked, group_id, created_at
       FROM board_items WHERE board_id = ? ORDER BY z ASC`
  ).all(boardId) as BoardItemRow[]
  return rows.map(rowToBoardItem)
}

const INSERT_BOARD_ITEM = `INSERT INTO board_items (id, board_id, asset_id, type, x, y, width, height, z, text, note_font, note_color, note_font_size, opacity, shape, flip_x, flip_y, locked, group_id, created_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/**
 * 批量添加元素（撤销恢复/粘贴/导入用）：一次 MAX(z) 查询 + 一个事务，
 * 取代此前「循环里逐条 await addBoardItem」的 N 次 IPC 往返。
 */
export function addBoardItems(boardId: number, items: NewBoardItem[]): BoardItem[] {
  if (items.length === 0) return []
  const db = getDb()
  const now = Date.now()
  let nextZ = (
    stmt(db, 'SELECT COALESCE(MAX(z), -1) + 1 AS z FROM board_items WHERE board_id = ?').get(boardId) as {
      z: number
    }
  ).z
  const ins = stmt(db, INSERT_BOARD_ITEM)
  const out: BoardItem[] = []
  const run = db.transaction(() => {
    for (const item of items) {
      const id = randomUUID().replace(/-/g, '').slice(0, 16)
      const z = item.z ?? nextZ++
      ins.run(
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
        item.flipX ? 1 : 0,
        item.flipY ? 1 : 0,
        item.locked ? 1 : 0,
        item.groupId ?? '',
        now
      )
      out.push(boardItemOf(id, boardId, item, z, now))
    }
    stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?').run(now, boardId)
  })
  run()
  return out
}

function boardItemOf(id: string, boardId: number, item: NewBoardItem, z: number, createdAt: number): BoardItem {
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
    flipX: !!item.flipX,
    flipY: !!item.flipY,
    locked: !!item.locked,
    groupId: item.groupId ?? '',
    createdAt
  }
}

/** 添加白板元素（asset / note / shape），返回完整元素 */
export function addBoardItem(boardId: number, item: NewBoardItem): BoardItem {
  return addBoardItems(boardId, [item])[0]
}

/** 白板元素可部分更新的字段 → 列名 */
const BOARD_ITEM_COLS = {
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
  shape: 'shape',
  flipX: 'flip_x',
  flipY: 'flip_y',
  locked: 'locked',
  groupId: 'group_id'
} as const

const PATCH_KEYS = Object.keys(BOARD_ITEM_COLS) as (keyof typeof BOARD_ITEM_COLS)[]

/** 把 patch 编成 (SET 子句, 参数)；空 patch 返回 null */
function buildPatch(patch: BoardItemPatch): { sets: string; params: unknown[] } | null {
  const sets: string[] = []
  const params: unknown[] = []
  for (const key of PATCH_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${BOARD_ITEM_COLS[key]} = ?`)
      // better-sqlite3 不接受 boolean 绑定,统一转 0/1
      params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v)
    }
  }
  return sets.length > 0 ? { sets: sets.join(', '), params } : null
}

/** 更新白板元素（x/y/width/height/z/text/noteFont/noteColor/opacity/shape/flipX/flipY 可部分更新） */
export function updateBoardItem(id: string, patch: BoardItemPatch): void {
  const db = getDb()
  const p = buildPatch(patch)
  if (!p) return
  const row = stmt(db, 'SELECT board_id FROM board_items WHERE id = ?').get(id) as { board_id: number } | undefined
  if (!row) return
  stmt(db, `UPDATE board_items SET ${p.sets} WHERE id = ?`).run(...p.params, id)
  stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), row.board_id)
}

/** 批量更新白板元素（组移动/组缩放等一次性落库，事务原子） */
export function updateBoardItems(items: { id: string; patch: BoardItemPatch }[]): void {
  if (items.length === 0) return
  const db = getDb()
  const run = db.transaction(() => {
    // 整批只查一次归属板（此前逐行 SELECT board_id = N 条额外语句）；
    // 一批元素总来自同一块白板，DISTINCT 只是防御性写法
    const ids = items.map((i) => i.id)
    const boards = stmt(
      db,
      `SELECT DISTINCT board_id FROM board_items WHERE id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids) as { board_id: number }[]
    let touched = 0
    for (const { id, patch } of items) {
      const p = buildPatch(patch)
      if (!p) continue
      // 同一批的 SET 形状通常一致，stmt 缓存按 SQL 文本命中
      touched += stmt(db, `UPDATE board_items SET ${p.sets} WHERE id = ?`).run(...p.params, id).changes
    }
    if (touched === 0) return
    const now = Date.now()
    const touchBoard = stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?')
    for (const b of boards) touchBoard.run(now, b.board_id)
  })
  run()
}

export function deleteBoardItem(id: string): void {
  const db = getDb()
  const row = stmt(db, 'SELECT board_id FROM board_items WHERE id = ?').get(id) as { board_id: number } | undefined
  stmt(db, 'DELETE FROM board_items WHERE id = ?').run(id)
  if (row) stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), row.board_id)
}

/** 批量删除（撤销恢复/右键删除多选用）：一个事务 + 一次归属板查询，取代循环里逐条 await */
export function deleteBoardItems(ids: string[]): void {
  if (ids.length === 0) return
  const db = getDb()
  const run = db.transaction(() => {
    const boards = stmt(
      db,
      `SELECT DISTINCT board_id FROM board_items WHERE id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids) as { board_id: number }[]
    const del = stmt(db, 'DELETE FROM board_items WHERE id = ?')
    for (const id of ids) del.run(id)
    const now = Date.now()
    const touchBoard = stmt(db, 'UPDATE boards SET updated_at = ? WHERE id = ?')
    for (const b of boards) touchBoard.run(now, b.board_id)
  })
  run()
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

/** 保存白板视口（JSON：{s,x,y}）。纯视图状态,不 bump updated_at——否则每次平移/缩放都重排白板列表 */
export function updateBoardViewport(boardId: number, viewportJson: string): void {
  getDb().prepare('UPDATE boards SET viewport = ? WHERE id = ?').run(viewportJson, boardId)
}
