import { useCallback, useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import BoardCanvas from './BoardCanvas'

/**
 * 白板浮动置顶窗口（对标 PureRef）：无边框小窗常驻桌面顶层,
 * 参考作画时贴在绘图软件旁边。复用 BoardCanvas 全量交互
 * （缩放/平移/框选/拖动/参考线/透明度）,顶栏负责拖拽移动窗口。
 */
export default function FloatingBoard({ boardId }: { boardId: number }) {
  const boards = useLibraryStore((s) => s.boards)
  const refreshBoards = useLibraryStore((s) => s.refreshBoards)
  const refreshBoardItems = useLibraryStore((s) => s.refreshBoardItems)
  const [currentBoardId, setCurrentBoardId] = useState(boardId)
  const [zoom, setZoom] = useState(1)
  /** 折叠（最小化）态：主进程把窗口收成标题条高,画布卸载。
   *  初始值读 URL query(主进程创建窗口时按上次状态写入),重开保持折叠/展开态 */
  const [minimized, setMinimized] = useState(() => new URLSearchParams(window.location.search).get('minimized') === '1')
  const canvasApiRef = useRef<{ zoomTo: (s: number) => void } | null>(null)
  // 稳定回调：内联箭头会让 BoardCanvas 的滚轮监听每帧重挂
  const onViewportChange = useCallback((s: number) => setZoom(s), [])

  // 主进程复用已开的浮动窗时会发 board:switch 通知切换白板
  useEffect(() => window.api.onBoardSwitch((id) => setCurrentBoardId(id)), [])

  // 主进程折叠/展开后同步 UI 状态（窗口高度变化由主进程负责）
  useEffect(() => window.api.onBoardMinimized((m) => setMinimized(m)), [])

  // 初始化 store：激活该白板并加载元素/白板列表。
  // boardViewMode 置 'board'：浮动窗无素材库,画布快捷键应始终生效
  useEffect(() => {
    useLibraryStore.setState({ activeBoardId: currentBoardId, boardViewMode: 'board', view: { type: 'all' }, selection: [], previewId: null, editorId: null })
    void refreshBoards()
    void refreshBoardItems(currentBoardId)
  }, [currentBoardId, refreshBoards, refreshBoardItems])

  const board = boards.find((b) => b.id === currentBoardId)

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[var(--bg-base)] text-[var(--text-main)]">
      {/* 标题条：整条可拖拽移动窗口（-webkit-app-region: drag） */}
      <div
        className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-2 text-[12px]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <Icon name="shapes" size={12} />
        <span className="truncate font-medium">{board?.name ?? '白板'}</span>
        <div className="ml-auto flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {!minimized && (
            <>
              <span className="mono text-[11px] text-[var(--text-faint)]">{Math.round(zoom * 100)}%</span>
              <input
                aria-label="浮动白板缩放"
                type="range"
                min={0.1}
                max={4}
                step={0.01}
                value={zoom}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setZoom(v)
                  canvasApiRef.current?.zoomTo(v)
                }}
                className="w-20 accent-[var(--accent)]"
              />
            </>
          )}
          <button
            aria-label={minimized ? '展开浮动白板' : '最小化浮动白板'}
            title={minimized ? '展开浮动白板' : '最小化浮动白板（折叠为标题条）'}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={() => {
              // 先乐观更新,主进程 setBounds + 事件兜底同步
              setMinimized((m) => !m)
              void window.api.toggleFloatingWindowMinimize()
            }}
          >
            <Icon name={minimized ? 'restoreDown' : 'minimize'} size={13} />
          </button>
          <button
            aria-label="浮动白板归位"
            title="归位（贴回屏幕右上角）"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={() => void window.api.resetFloatingWindowPosition()}
          >
            <Icon name="corner" size={13} />
          </button>
          <button
            aria-label="关闭浮动白板"
            title="关闭浮动白板"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
            onClick={() => void window.api.closeFloatingWindow()}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      </div>
      {!minimized && (
        <BoardCanvas
          onViewportChange={onViewportChange}
          onApiReady={(api) => (canvasApiRef.current = api)}
        />
      )}
    </div>
  )
}
