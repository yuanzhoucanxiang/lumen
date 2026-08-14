import { useRef, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import BoardCanvas from './BoardCanvas'

/**
 * 白板面板(split 分屏右侧常驻,照抄 MOTZ board-toolbar):
 * 工具栏 = 当前白板下拉切换 + 新建 + 文字 + 排列 + 缩放滑块 + 全屏切换
 */
export default function BoardPanel() {
  const boards = useLibraryStore((s) => s.boards)
  const activeBoardId = useLibraryStore((s) => s.activeBoardId)
  const boardViewMode = useLibraryStore((s) => s.boardViewMode)
  const boardViewWidth = useLibraryStore((s) => s.boardViewWidth)
  const boardItems = useLibraryStore((s) => s.boardItems)
  const refreshBoards = useLibraryStore((s) => s.refreshBoards)
  const refreshBoardItems = useLibraryStore((s) => s.refreshBoardItems)
  const openBoard = useLibraryStore((s) => s.openBoard)
  const setBoardViewMode = useLibraryStore((s) => s.setBoardViewMode)

  const [zoom, setZoom] = useState(1)
  const canvasApiRef = useRef<{ zoomTo: (s: number) => void; resetView: () => void } | null>(null)

  const board = boards.find((b) => b.id === activeBoardId)
  const hasBoard = board != null

  const createBoard = async () => {
    const b = await window.api.createBoard(`白板 ${boards.length + 1}`)
    await refreshBoards()
    openBoard(b.id)
  }

  const addNote = async () => {
    if (!hasBoard) return
    await window.api.addBoardItem(activeBoardId!, { type: 'note', x: 96, y: 96, width: 200, height: 60, text: '' })
    await refreshBoardItems(activeBoardId!)
  }

  const arrange = async (mode: 'grid' | 'row' | 'column') => {
    if (!hasBoard) return
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
    await refreshBoardItems(activeBoardId!)
  }

  const onZoomChange = (v: number) => {
    setZoom(v)
    canvasApiRef.current?.zoomTo(v)
  }

  const exportBoard = async () => {
    if (!hasBoard) return
    const r = await window.api.exportBoardFile(activeBoardId!)
    if (r) useLibraryStore.getState().showToast(`白板已导出：${r.target}`)
  }

  const importBoard = async () => {
    const r = await window.api.importBoardFile()
    if (r) {
      await refreshBoards()
      openBoard(r.boardId)
      useLibraryStore.getState().showToast(`已导入白板「${r.name}」（${r.imported} 个元素）`)
    }
  }

  return (
    <div className="flex min-h-0 flex-col border-l border-[var(--border)] bg-[var(--bg-base)]" style={{ width: boardViewMode === 'board' ? undefined : boardViewWidth, minWidth: boardViewMode === 'board' ? 0 : 280 }}>
      {/* 工具栏(照抄 MOTZ board-toolbar) */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 text-[12px]">
        {/* 白板切换下拉 */}
        <select
          aria-label="切换白板"
          className="field-input max-w-40 px-1.5 py-1 text-[12px]"
          value={activeBoardId ?? ''}
          disabled={boards.length === 0}
          onChange={(e) => {
            const id = Number(e.target.value)
            if (id) openBoard(id)
          }}
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          {boards.length === 0 && <option value="">无白板</option>}
        </select>
        <button
          aria-label="新建白板"
          title="新建白板"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
          onClick={() => void createBoard()}
        >
          <Icon name="plus" size={13} strokeWidth={2} />
        </button>

        <div className="mx-1 h-4 w-px bg-[var(--border)]" />
        <button className="btn-ghost flex items-center gap-1 px-2.5 py-1 text-[12px]" onClick={() => void addNote()} disabled={!hasBoard}>
          <Icon name="type" size={11} />
          文字
        </button>
        <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => void arrange('grid')} disabled={!hasBoard}>
          网格
        </button>
        <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => void arrange('row')} disabled={!hasBoard}>
          横排
        </button>
        <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => void arrange('column')} disabled={!hasBoard}>
          竖排
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            aria-label="导出白板文件"
            title="导出 .lumenboard（跨设备交换参考白板）"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
            disabled={!hasBoard}
            onClick={() => void exportBoard()}
          >
            <Icon name="save" size={13} />
          </button>
          <button
            aria-label="导入白板文件"
            title="导入 .lumenboard"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
            onClick={() => void importBoard()}
          >
            <Icon name="import" size={13} />
          </button>
          <button
            aria-label="白板浮动置顶"
            title="白板浮动置顶(参考作画时贴在旁边)"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
            disabled={!hasBoard}
            onClick={() => void window.api.openFloatingBoard(activeBoardId!)}
          >
            <Icon name="pin" size={13} />
          </button>
          <span className="mono w-10 text-right text-[11px] text-[var(--text-faint)]">{Math.round(zoom * 100)}%</span>
          <input
            aria-label="白板缩放"
            type="range"
            min={0.1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            className="w-24 accent-[var(--accent)]"
          />
          <button
            aria-label={boardViewMode === 'board' ? '取消白板全屏' : '白板全屏'}
            title={boardViewMode === 'board' ? '取消白板全屏（分屏）' : '白板全屏'}
            className={`flex h-6 w-6 items-center justify-center rounded-sm transition-colors duration-100 ${
              boardViewMode === 'board' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]'
            }`}
            onClick={() => setBoardViewMode(boardViewMode === 'board' ? 'split' : 'board')}
          >
            <Icon name="shapes" size={13} />
          </button>
          <button
            aria-label="退出白板"
            title="退出白板（回到素材库）"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
            onClick={() => setBoardViewMode('off')}
          >
            <Icon name="arrowLeft" size={13} />
          </button>
        </div>
      </div>

      {/* 画布 */}
      <BoardCanvas onApiReady={(api) => (canvasApiRef.current = api)} />
    </div>
  )
}
