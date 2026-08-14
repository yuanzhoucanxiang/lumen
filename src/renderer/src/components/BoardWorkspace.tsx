import { useEffect, useMemo, useRef, useState } from 'react'
import { assetThumbUrl, useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import ConfirmDialog from './ConfirmDialog'
import BoardCanvas from './BoardCanvas'
import type { Asset } from '@shared/types'

const ASSET_MIME = 'application/x-eaglelike-assets'

/**
 * 白板工作区（创作参考专属页面）：
 * 顶栏（当前白板工具栏）+ 左面板（白板列表 + 素材托盘）+ 右侧大画布。
 * 白板与素材库平级：主界面主导航「白板」入口进入。
 */
export default function BoardWorkspace() {
  const boards = useLibraryStore((s) => s.boards)
  const activeBoardId = useLibraryStore((s) => s.activeBoardId)
  const refreshBoards = useLibraryStore((s) => s.refreshBoards)
  const openBoard = useLibraryStore((s) => s.openBoard)
  const setActiveBoardId = useLibraryStore((s) => s.setActiveBoardId)
  const refreshBoardItems = useLibraryStore((s) => s.refreshBoardItems)
  const boardItems = useLibraryStore((s) => s.boardItems)

  const board = boards.find((b) => b.id === activeBoardId)

  /* ---------- 白板列表 ---------- */
  const [adding, setAdding] = useState(false)
  const [addVal, setAddVal] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDel, setConfirmDel] = useState<number | null>(null)

  const submitAdd = async () => {
    const name = addVal.trim()
    setAdding(false)
    if (!name) return
    const b = await window.api.createBoard(name)
    await refreshBoards()
    openBoard(b.id)
  }
  const submitRename = async () => {
    const name = renameVal.trim()
    setRenamingId(null)
    if (name && renamingId != null) {
      await window.api.renameBoard(renamingId, name)
      await refreshBoards()
    }
  }
  const doDelete = async () => {
    if (confirmDel == null) return
    await window.api.deleteBoard(confirmDel)
    setConfirmDel(null)
    await refreshBoards()
    // 删除的是当前白板:切到第一个白板或清空
    if (activeBoardId === confirmDel) {
      const rest = boards.filter((b) => b.id !== confirmDel)
      if (rest.length > 0) openBoard(rest[0].id)
      else {
        setActiveBoardId(null)
        useLibraryStore.getState().setView({ type: 'boards' })
      }
    }
  }

  /* ---------- 素材托盘 ---------- */
  const [trayKeyword, setTrayKeyword] = useState('')
  const [trayAssets, setTrayAssets] = useState<Asset[]>([])
  const trayDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (trayDebounceRef.current) clearTimeout(trayDebounceRef.current)
    trayDebounceRef.current = setTimeout(() => {
      void window.api
        .queryAssets({ keyword: trayKeyword.trim() || undefined, limit: 200, sortBy: 'imported', sortDesc: true })
        .then(setTrayAssets)
    }, 300)
    return () => {
      if (trayDebounceRef.current) clearTimeout(trayDebounceRef.current)
    }
  }, [trayKeyword])

  // 托盘拖拽
  const onTrayDragStart = (e: React.DragEvent, a: Asset) => {
    e.dataTransfer.setData(ASSET_MIME, JSON.stringify([a.id]))
    e.dataTransfer.effectAllowed = 'copy'
  }
  /** 双击托盘素材 → 加到画布中央（onClick 双击检测,兼容性优于 onDoubleClick） */
  const lastTrayClickRef = useRef(0)
  const onTrayClick = (a: Asset) => {
    const now = Date.now()
    if (now - lastTrayClickRef.current < 300) {
      lastTrayClickRef.current = 0
      void addToBoardCenter(a)
    } else {
      lastTrayClickRef.current = now
    }
  }
  /** 双击托盘素材 → 加到画布中央 */
  const addToBoardCenter = async (a: Asset) => {
    if (activeBoardId == null) return
    await window.api.addBoardItem(activeBoardId, { assetId: a.id, type: 'asset', x: 100, y: 100, width: 240, height: 0 })
    await refreshBoardItems(activeBoardId)
  }

  /* ---------- 顶栏：排列 ---------- */
  const arrange = async (mode: 'grid' | 'row' | 'column') => {
    if (activeBoardId == null) return
    const items = boardItems
    const startX = 72
    const startY = 72
    let cursor = 0
    let rowHeight = 0
    let gridX = startX
    let gridY = startY
    let assetIdx = 0
    for (const it of items) {
      if (it.type === 'note') continue
      const h = it.height > 0 ? it.height : it.width * 0.75
      if (mode === 'row') {
        await window.api.updateBoardItem(it.id, { x: startX + cursor, y: startY })
        cursor += it.width
      } else if (mode === 'column') {
        await window.api.updateBoardItem(it.id, { x: startX, y: startY + cursor })
        cursor += h
      } else {
        if (assetIdx > 0 && assetIdx % 3 === 0) {
          gridX = startX
          gridY += rowHeight
          rowHeight = 0
        }
        await window.api.updateBoardItem(it.id, { x: gridX, y: gridY, width: 240, height: h })
        gridX += 240
        rowHeight = Math.max(rowHeight, h)
      }
      assetIdx++
    }
    await refreshBoardItems(activeBoardId)
  }

  const addNote = async () => {
    if (activeBoardId == null) return
    const item = await window.api.addBoardItem(activeBoardId, { type: 'note', x: 200, y: 200, width: 200, height: 60, text: '' })
    await refreshBoardItems(activeBoardId)
  }

  /* ---------- 缩放控制:画布内部管理,顶栏不显示百分比(简化) ---------- */

  const trayGrid = useMemo(
    () =>
      trayAssets.map((a) => (
        <div
          key={a.id}
          draggable
          title={a.name}
          className="group relative aspect-[4/3] cursor-grab overflow-hidden rounded-sm border border-[var(--border)] transition-colors duration-100 hover:border-[var(--accent)]"
          onDragStart={(e) => onTrayDragStart(e, a)}
          onClick={() => onTrayClick(a)}
        >
          <img src={assetThumbUrl(a)} alt={a.name} className="h-full w-full object-cover" draggable={false} />
          <span className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 py-px text-[9px] text-white/70 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
            {a.name}
          </span>
        </div>
      )),
    [trayAssets]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶栏 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 text-[12px]">
        {renamingId != null ? (
          <input
            autoFocus
            aria-label="重命名白板"
            className="field-input w-40 px-1.5 py-0.5 text-[12px]"
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename()
              if (e.key === 'Escape') setRenamingId(null)
            }}
            onBlur={() => void submitRename()}
          />
        ) : (
          <button
            aria-label="重命名白板"
            className="flex items-center gap-1.5 font-medium hover:text-[var(--accent-text)]"
            onClick={() => {
              if (board) {
                setRenamingId(board.id)
                setRenameVal(board.name)
              }
            }}
          >
            <Icon name="shapes" size={13} />
            {board ? board.name : '白板工作区'}
          </button>
        )}
        <span className="mono text-[10px] text-[var(--text-faint)]">{boardItems.length} 项</span>
        <div className="mx-1 h-4 w-px bg-[var(--border)]" />
        <button className="btn-ghost flex items-center gap-1 px-2 py-0.5 text-[11px]" onClick={() => void addNote()} disabled={!board}>
          <Icon name="type" size={11} />
          文字
        </button>
        <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => void arrange('grid')} disabled={!board}>
          网格排列
        </button>
        <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => void arrange('row')} disabled={!board}>
          横排
        </button>
        <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => void arrange('column')} disabled={!board}>
          竖排
        </button>
        <div className="ml-auto text-[10px] text-[var(--text-faint)]">空格/中键平移 · 滚轮缩放 · 双击托盘素材添加到画布</div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左面板 */}
        <div className="flex w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]">
          {/* 白板列表 */}
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="section-title">白板</span>
              <button
                aria-label="新建白板"
                className="flex h-5 w-5 items-center justify-center text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
                onClick={() => {
                  setAdding(true)
                  setAddVal('')
                }}
              >
                <Icon name="plus" size={13} strokeWidth={2} />
              </button>
            </div>
            <div className="modal-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {adding && (
                <input
                  autoFocus
                  aria-label="新白板名称"
                  className="field-input w-full px-1.5 py-1 text-[11px]"
                  placeholder="白板名称…"
                  value={addVal}
                  onChange={(e) => setAddVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitAdd()
                    if (e.key === 'Escape') setAdding(false)
                  }}
                  onBlur={() => void submitAdd()}
                />
              )}
              {boards.map((b) => (
                <div
                  key={b.id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-[12px] transition-colors duration-100 ${
                    b.id === activeBoardId ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]' : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                  }`}
                  onClick={() => openBoard(b.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setRenamingId(b.id)
                    setRenameVal(b.name)
                  }}
                >
                  <Icon name="shapes" size={12} className="shrink-0 text-[var(--text-faint)]" />
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  <span className="mono text-[9px] text-[var(--text-faint)]">{b.id === activeBoardId ? boardItems.length : ''}</span>
                </div>
              ))}
              {boards.length === 0 && !adding && (
                <p className="px-1 py-2 text-[11px] text-[var(--text-faint)]">还没有白板,点 + 新建</p>
              )}
            </div>
            {renamingId != null && (
              <div className="mt-1.5">
                <input
                  autoFocus
                  aria-label="重命名白板"
                  className="field-input w-full px-1.5 py-1 text-[11px]"
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => void submitRename()}
                />
              </div>
            )}
            <div className="mt-1.5 flex gap-1">
              <button
                className="btn-ghost flex-1 px-1 py-0.5 text-[10px]"
                disabled={activeBoardId == null}
                onClick={() => {
                  const b = boards.find((x) => x.id === activeBoardId)
                  if (b) {
                    setRenamingId(b.id)
                    setRenameVal(b.name)
                  }
                }}
              >
                重命名
              </button>
              <button
                className="btn-ghost flex-1 px-1 py-0.5 text-[10px] text-[var(--danger)]"
                disabled={activeBoardId == null}
                onClick={() => setConfirmDel(activeBoardId)}
              >
                删除
              </button>
            </div>
          </div>

          {/* 素材托盘 */}
          <div className="flex min-h-0 flex-[2] flex-col border-t border-[var(--border)] p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Icon name="image" size={11} className="text-[var(--text-faint)]" />
              <span className="section-title">素材托盘</span>
            </div>
            <input
              aria-label="搜索托盘素材"
              className="field-input mb-1.5 w-full px-1.5 py-1 text-[11px]"
              placeholder="搜索素材…"
              value={trayKeyword}
              onChange={(e) => setTrayKeyword(e.target.value)}
            />
            <div className="modal-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-1">{trayGrid}</div>
              {trayAssets.length === 0 && (
                <p className="px-1 py-2 text-[11px] text-[var(--text-faint)]">拖到右侧画布,或双击添加</p>
              )}
            </div>
          </div>
        </div>

        {/* 画布 */}
        <div className="flex min-h-0 flex-1 flex-col">
          <BoardCanvas />
        </div>
      </div>

      {confirmDel != null && (
        <ConfirmDialog
          title="删除白板？"
          message="白板及其所有元素将被永久删除，素材本身不受影响。"
          confirmLabel="删除白板"
          onConfirm={() => void doDelete()}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}
