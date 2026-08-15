import { useCallback, useRef, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import BoardCanvas, { type BoardCanvasApi, type BoardTool } from './BoardCanvas'

/** 画布外观预设（bg 键 → 颜色,与 BoardCanvas 同步） */
const BG_PRESETS: { key: string; label: string; color: string }[] = [
  { key: 'dark', label: '深色', color: '#141310' },
  { key: 'gray', label: '中灰', color: '#2b2924' },
  { key: 'light', label: '浅灰', color: '#e8e8e8' },
  { key: 'white', label: '白色', color: '#ffffff' },
  { key: 'black', label: '黑色', color: '#090908' }
]

interface BoardAppearance {
  bg: string
  grid: boolean
  gridSize: number
}

const TOOLS: { id: BoardTool; label: string; icon: Parameters<typeof Icon>[0]['name']; title: string }[] = [
  { id: 'select', label: '选择', icon: 'pointer', title: '选择/框选（V）' },
  { id: 'pen', label: '手绘', icon: 'penTool', title: '手绘笔（P）' },
  { id: 'arrow', label: '箭头', icon: 'arrow', title: '箭头（A）' },
  { id: 'line', label: '直线', icon: 'line', title: '直线（L）' },
  { id: 'rect', label: '矩形', icon: 'rect', title: '矩形（R）' },
  { id: 'ellipse', label: '椭圆', icon: 'circle', title: '椭圆（O）' },
  { id: 'note', label: '文字', icon: 'type', title: '文字便签（T）' }
]

/**
 * 白板面板(split 分屏右侧常驻):
 * 行 1 = 白板切换/新建 + 导入导出/浮动/缩放滑块/全屏/退出
 * 行 2 = 绘图工具组 + 撤销/重做 + 适配/画布外观/导出 SVG
 */
export default function BoardPanel() {
  const boards = useLibraryStore((s) => s.boards)
  const activeBoardId = useLibraryStore((s) => s.activeBoardId)
  const boardViewMode = useLibraryStore((s) => s.boardViewMode)
  const boardViewWidth = useLibraryStore((s) => s.boardViewWidth)
  const refreshBoards = useLibraryStore((s) => s.refreshBoards)
  const refreshBoardItems = useLibraryStore((s) => s.refreshBoardItems)
  const openBoard = useLibraryStore((s) => s.openBoard)
  const setBoardViewMode = useLibraryStore((s) => s.setBoardViewMode)

  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<BoardTool>('select')
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const canvasApiRef = useRef<BoardCanvasApi | null>(null)

  const board = boards.find((b) => b.id === activeBoardId)
  const hasBoard = board != null

  // 当前外观（从 boards 解析;默认深色+网格）
  let appearance: BoardAppearance = { bg: 'dark', grid: true, gridSize: 24 }
  try {
    const p = JSON.parse(board?.appearance ?? '')
    if (p && typeof p === 'object') appearance = { bg: p.bg ?? 'dark', grid: p.grid !== false, gridSize: Number(p.gridSize) || 24 }
  } catch {
    /* 忽略 */
  }

  /** 缩放滑块与画布滚轮/快捷键双向同步 */
  const onViewportChange = useCallback((s: number) => setZoom(s), [])
  const onZoomChange = (v: number) => {
    setZoom(v)
    canvasApiRef.current?.zoomTo(v)
  }

  const persistAppearance = async (next: BoardAppearance) => {
    if (activeBoardId == null) return
    await window.api.setBoardAppearance(activeBoardId, JSON.stringify(next))
    await refreshBoards()
  }

  const createBoard = async () => {
    const b = await window.api.createBoard(`白板 ${boards.length + 1}`)
    await refreshBoards()
    openBoard(b.id)
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

  const exportSvg = async () => {
    if (!hasBoard || !canvasApiRef.current) return
    const svg = await canvasApiRef.current.exportSvg()
    const r = await window.api.exportBoardSvg(activeBoardId!, svg)
    if (r) useLibraryStore.getState().showToast(`已导出 SVG：${r.target}`)
  }

  const toolBtnCls = (active: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded-sm transition-colors duration-100 ${
      active ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]'
    }`

  return (
    <div
      className="archive-light-table flex h-full min-h-0 flex-col border-l border-[var(--border)] bg-[var(--bg-base)]"
      style={{ width: boardViewMode === 'board' ? undefined : boardViewWidth, minWidth: boardViewMode === 'board' ? 0 : 280 }}
    >
      {/* 行 1：白板切换 + 文件/窗口操作 */}
      <div className="archive-board-head flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 text-[12px]">
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

        <div className="ml-auto flex items-center gap-2">
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

      {/* 行 2：绘图工具 + 撤销/重做 + 视图/外观 */}
      <div className="archive-board-tools flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--bg-panel)] px-2 text-[12px]">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            aria-label={`工具 ${t.label}`}
            title={t.title}
            className={toolBtnCls(tool === t.id)}
            onClick={() => setTool(t.id)}
          >
            <Icon name={t.icon} size={14} />
          </button>
        ))}
        <div className="mx-1 h-4 w-px shrink-0 bg-[var(--border)]" />
        <button
          aria-label="撤销"
          title="撤销（Ctrl+Z）"
          className={toolBtnCls(false)}
          onClick={() => void canvasApiRef.current?.undo()}
        >
          <Icon name="undo" size={13} />
        </button>
        <button
          aria-label="重做"
          title="重做（Ctrl+Shift+Z / Ctrl+Y）"
          className={toolBtnCls(false)}
          onClick={() => void canvasApiRef.current?.redo()}
        >
          <Icon name="redo" size={13} />
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            aria-label="适配全部内容"
            title="适配全部内容（F / 双击空白）"
            className={toolBtnCls(false)}
            onClick={() => canvasApiRef.current?.fitContent()}
          >
            <Icon name="fit" size={13} />
          </button>
          <div className="relative">
            <button
              aria-label="画布外观"
              title="画布外观（背景色/网格）"
              className={toolBtnCls(appearanceOpen)}
              onClick={() => setAppearanceOpen((v) => !v)}
            >
              <Icon name="palette" size={13} />
            </button>
            {appearanceOpen && (
              <>
                {/* 点击外部关闭 */}
                <div className="fixed inset-0 z-[290]" onClick={() => setAppearanceOpen(false)} />
                <div className="menu absolute right-0 top-8 z-[300] w-44 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="mb-1 text-[10px] text-[var(--text-faint)]">背景色</div>
                  <div className="flex items-center gap-1">
                    {BG_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        aria-label={`背景色 ${p.label}`}
                        title={p.label}
                        className={`h-4 w-4 rounded-full border transition-transform duration-100 hover:scale-110 ${
                          appearance.bg === p.key ? 'ring-2 ring-white/60' : 'border-white/20'
                        }`}
                        style={{ background: p.color }}
                        onClick={() => void persistAppearance({ ...appearance, bg: p.key })}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="自定义背景色"
                      className="h-4 w-4 cursor-pointer border-none bg-transparent p-0"
                      value={/^#[0-9a-f]{6}$/i.test(appearance.bg) ? appearance.bg : '#191c20'}
                      onChange={(e) => void persistAppearance({ ...appearance, bg: e.target.value })}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-faint)]">
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        aria-label="网格开关"
                        className="accent-[var(--accent)]"
                        checked={appearance.grid}
                        onChange={(e) => void persistAppearance({ ...appearance, grid: e.target.checked })}
                      />
                      点阵网格
                    </label>
                    <select
                      aria-label="网格密度"
                      className="field-input px-1 py-0.5 text-[10px]"
                      value={appearance.gridSize}
                      onChange={(e) => void persistAppearance({ ...appearance, gridSize: Number(e.target.value) })}
                    >
                      <option value={16}>密 16</option>
                      <option value={24}>中 24</option>
                      <option value={40}>疏 40</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            aria-label="导出画布 SVG"
            title="导出画布为 SVG 矢量图（图片内嵌）"
            className={toolBtnCls(false)}
            disabled={!hasBoard}
            onClick={() => void exportSvg()}
          >
            <Icon name="image" size={13} />
          </button>
        </div>
      </div>

      {/* 画布 */}
      <BoardCanvas
        tool={tool}
        onViewportChange={onViewportChange}
        onApiReady={(api) => (canvasApiRef.current = api)}
      />
    </div>
  )
}
