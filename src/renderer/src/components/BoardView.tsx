import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetThumbUrl, useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import type { Board, BoardItem } from '@shared/types'

const ASSET_MIME = 'application/x-eaglelike-assets'

interface Viewport {
  s: number // zoom
  x: number // translate x (px)
  y: number // translate y (px)
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4

/** 从图库拖拽的素材类型 */
interface DragAssetPayload {
  ids: string[]
  clientX: number
  clientY: number
}

/**
 * 白板视图：无限画布。
 * - 画布两层结构：frame（视口，固定大小）→ surface（transform: translate3d+scale）
 * - 滚轮缩放以光标为锚点（rAF 逐帧更新，不触发 React 重渲染）
 * - 拖拽平移（中键或空格+左键）
 * - 从图库拖素材进白板（application/x-eaglelike-assets MIME）
 * - 元素：图片/视频缩略图 + 文字 note；拖动/调整大小/删除/置顶
 */
export default function BoardView() {
  const view = useLibraryStore((s) => s.view)
  const boards = useLibraryStore((s) => s.boards)
  const boardItems = useLibraryStore((s) => s.boardItems)
  const refreshBoards = useLibraryStore((s) => s.refreshBoards)
  const refreshBoardItems = useLibraryStore((s) => s.refreshBoardItems)
  const setView = useLibraryStore((s) => s.setView)

  const board: Board | undefined = view.type === 'board' ? boards.find((b) => b.id === view.id) : undefined
  const boardId = board?.id

  /* ---------- 视口状态 ---------- */
  const [viewport, setViewport] = useState<Viewport>({ s: 1, x: 0, y: 0 })
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const surfaceRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const wheelRafRef = useRef(0)
  const [panning, setPanning] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const spaceDownRef = useRef(false)
  const panRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null)

  /* ---------- 选中/编辑 ---------- */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const setSel = (id: string | null) => {
    selectedIdRef.current = id
    setSelectedId(id)
  }
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  // 拖动/调整大小中的元素（实时改 DOM style,松手写 DB）
  const dragRef = useRef<{ id: string; mode: 'move' | 'resize'; startX: number; startY: number; orig: { x: number; y: number; w: number; h: number } } | null>(null)

  // 从图库拖入的待放置素材（drop 时用）
  const pendingDropRef = useRef<DragAssetPayload | null>(null)

  // 素材宽高比缓存（用于 height=0 时自动计算）
  const [aspectCache, setAspectCache] = useState<Record<string, number>>({})

  /* ---------- 坐标换算 ---------- */
  const canvasPointFromClient = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current
    if (!frame) return { x: 0, y: 0 }
    const rect = frame.getBoundingClientRect()
    const v = viewportRef.current
    return {
      x: (clientX - rect.left - v.x) / v.s,
      y: (clientY - rect.top - v.y) / v.s
    }
  }, [])

  /* ---------- 画布事件 ---------- */
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const v = viewportRef.current
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.s * Math.exp(-e.deltaY * 0.0015)))
    if (nextZoom === v.s) return
    const anchorX = e.clientX - rect.left
    const anchorY = e.clientY - rect.top
    const boardX = (anchorX - v.x) / v.s
    const boardY = (anchorY - v.y) / v.s
    const next: Viewport = { s: nextZoom, x: anchorX - boardX * nextZoom, y: anchorY - boardY * nextZoom }
    viewportRef.current = next
    if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current)
    wheelRafRef.current = requestAnimationFrame(() => {
      wheelRafRef.current = 0
      if (surfaceRef.current) {
        surfaceRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.s})`
      }
    })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    // 中键或空格+左键：平移画布（用 ref 读空格状态，避免 React 状态更新延迟）
    if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
      e.preventDefault()
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* 合成事件无真实 pointerId 时忽略,仍继续平移 */
      }
      panRef.current = { startX: e.clientX, startY: e.clientY, vx: viewportRef.current.x, vy: viewportRef.current.y }
      setPanning(true)
      return
    }
    if (e.button === 0) {
      // 点击空白取消选中
      setSel(null)
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current
    if (p) {
      const next = { ...viewportRef.current, x: p.vx + (e.clientX - p.startX), y: p.vy + (e.clientY - p.startY) }
      viewportRef.current = next
      if (surfaceRef.current) {
        surfaceRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.s})`
      }
    }
  }
  const onPointerUp = () => {
    panRef.current = null
    setPanning(false)
  }

  /* ---------- 键盘（空格平移 + Delete 删除） ---------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inInput = !!target && typeof target.closest === 'function' && !!target.closest('input, textarea')
      if (e.key === ' ' && !inInput) {
        spaceDownRef.current = true
        setSpaceDown(true)
        e.preventDefault()
      }
      if (e.key === 'Delete' && selectedIdRef.current) {
        void window.api.deleteBoardItem(selectedIdRef.current)
        setSel(null)
        if (boardId != null) void refreshBoardItems(boardId)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceDownRef.current = false
        setSpaceDown(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [selectedId, boardId, refreshBoardItems])

  /* ---------- 拖放接收（从图库拖素材） ---------- */
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(ASSET_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(ASSET_MIME)
    if (!raw) return
    e.preventDefault()
    let ids: string[] = []
    try {
      ids = JSON.parse(raw)
    } catch {
      return
    }
    if (ids.length === 0 || boardId == null) return
    const pt = canvasPointFromClient(e.clientX, e.clientY)
    void addAssetsToBoard(ids, pt.x, pt.y)
  }

  /** 把素材加入白板（错开摆放） */
  const addAssetsToBoard = async (ids: string[], x: number, y: number) => {
    if (boardId == null) return
    const existing = useLibraryStore.getState().boardItems.length
    for (let i = 0; i < ids.length; i++) {
      const offset = i * 24
      await window.api.addBoardItem(boardId, {
        assetId: ids[i],
        type: 'asset',
        x: x + offset,
        y: y + offset,
        width: 240,
        height: 0
      })
    }
    await refreshBoardItems(boardId)
    // 更新最新元素计数,让后续拖入继续错开
    void existing
  }

  /** 添加文字 note */
  const addNote = async () => {
    if (boardId == null) return
    const pt = canvasPointFromClient(frameRef.current ? frameRef.current.clientWidth / 2 : 200, frameRef.current ? frameRef.current.clientHeight / 2 : 200)
    const item = await window.api.addBoardItem(boardId, {
      type: 'note',
      x: pt.x,
      y: pt.y,
      width: 200,
      height: 60,
      text: ''
    })
    await refreshBoardItems(boardId)
    setSel(item.id)
  }

  /* ---------- 自动排列 ---------- */
  const arrange = async (mode: 'grid' | 'row' | 'column') => {
    if (boardId == null) return
    const items = useLibraryStore.getState().boardItems
    const assets = items.filter((it) => it.type === 'asset')
    if (assets.length === 0) return
    const startX = 72
    const startY = 72
    let cursor = 0
    let rowHeight = 0
    let gridX = startX
    let gridY = startY
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.type === 'note') continue
      const h = it.height > 0 ? it.height : 240 * (aspectCache[it.assetId ?? ''] ?? 0.75)
      if (mode === 'row') {
        await window.api.updateBoardItem(it.id, { x: startX + cursor, y: startY })
        cursor += it.width
      } else if (mode === 'column') {
        await window.api.updateBoardItem(it.id, { x: startX, y: startY + cursor })
        cursor += h
      } else {
        if (i > 0 && i % 3 === 0) {
          gridX = startX
          gridY += rowHeight
          rowHeight = 0
        }
        await window.api.updateBoardItem(it.id, { x: gridX, y: gridY, width: 240, height: h })
        gridX += 240
        rowHeight = Math.max(rowHeight, h)
      }
    }
    await refreshBoardItems(boardId)
  }

  /* ---------- 元素拖动/调整大小 ---------- */
  const onItemPointerDown = (e: React.PointerEvent, item: BoardItem, mode: 'move' | 'resize') => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSel(item.id)
    dragRef.current = { id: item.id, mode, startX: e.clientX, startY: e.clientY, orig: { x: item.x, y: item.y, w: item.width, h: item.height } }
  }
  const onItemPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const el = e.currentTarget as HTMLElement
    const dx = (e.clientX - d.startX) / viewportRef.current.s
    const dy = (e.clientY - d.startY) / viewportRef.current.s
    if (d.mode === 'move') {
      el.style.left = `${d.orig.x + dx}px`
      el.style.top = `${d.orig.y + dy}px`
    } else {
      const w = Math.max(60, d.orig.w + dx)
      const h = Math.max(40, d.orig.h + dy)
      el.style.width = `${w}px`
      el.style.height = `${h}px`
    }
  }
  const onItemPointerUp = async (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    const dx = (e.clientX - d.startX) / viewportRef.current.s
    const dy = (e.clientY - d.startY) / viewportRef.current.s
    if (d.mode === 'move') {
      await window.api.updateBoardItem(d.id, { x: d.orig.x + dx, y: d.orig.y + dy })
    } else {
      await window.api.updateBoardItem(d.id, { width: Math.max(60, d.orig.w + dx), height: Math.max(40, d.orig.h + dy) })
    }
  }

  /** 点击元素置顶 + 选中 */
  const onItemClick = async (item: BoardItem) => {
    setSel(item.id)
    if (boardId != null) {
      await window.api.bringBoardItemToFront(item.id, boardId)
      await refreshBoardItems(boardId)
    }
  }

  /* ---------- 素材宽高比（用于 height=0 自动计算） ---------- */
  const onImgLoad = (item: BoardItem, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > 0 && item.assetId) {
      setAspectCache((prev) => ({ ...prev, [item.assetId!]: img.naturalWidth / img.naturalHeight }))
    }
  }

  // 素材详情 map（用于显示名称等）
  const assets = useLibraryStore((s) => s.assets)
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])

  const showRename = async () => {
    if (!board) return
    setRenaming(true)
    setRenameVal(board.name)
  }
  const submitRename = async () => {
    const name = renameVal.trim()
    setRenaming(false)
    if (name && board) {
      await window.api.renameBoard(board.id, name)
      await refreshBoards()
    }
  }

  if (!board) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 白板工具栏 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 text-[12px]">
        {renaming ? (
          <input
            autoFocus
            aria-label="重命名白板"
            className="field-input w-40 px-1.5 py-0.5 text-[12px]"
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            onBlur={() => void submitRename()}
          />
        ) : (
          <button
            aria-label="重命名白板"
            className="flex items-center gap-1.5 font-medium hover:text-[var(--accent-text)]"
            onClick={() => void showRename()}
          >
            <Icon name="shapes" size={13} />
            {board.name}
          </button>
        )}
        <span className="mono text-[10px] text-[var(--text-faint)]">{boardItems.length} 项</span>
        <div className="mx-1 h-4 w-px bg-[var(--border)]" />
        <button className="btn-ghost flex items-center gap-1 px-2 py-0.5 text-[11px]" onClick={() => void addNote()}>
          <Icon name="type" size={11} />
          文字
        </button>
        <button className="btn-ghost flex items-center gap-1 px-2 py-0.5 text-[11px]" onClick={() => void arrange('grid')}>
          网格排列
        </button>
        <button className="btn-ghost flex items-center gap-1 px-2 py-0.5 text-[11px]" onClick={() => void arrange('row')}>
          横排
        </button>
        <button className="btn-ghost flex items-center gap-1 px-2 py-0.5 text-[11px]" onClick={() => void arrange('column')}>
          竖排
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="mono text-[10px] text-[var(--text-faint)]">{Math.round(viewport.s * 100)}%</span>
          <button
            className="btn-ghost px-2 py-0.5 text-[11px]"
            onClick={() => {
              const next = { s: 1, x: 0, y: 0 }
              viewportRef.current = next
              setViewport(next)
              if (surfaceRef.current) surfaceRef.current.style.transform = 'translate3d(0px, 0px, 0) scale(1)'
            }}
          >
            复位
          </button>
        </div>
      </div>

      {/* 画布 */}
      <div
        ref={frameRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ cursor: panning ? 'grabbing' : spaceDown ? 'grab' : 'default' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* 点阵背景 */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(128,128,128,0.18) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            transform: `translate(${viewport.x % 24}px, ${viewport.y % 24}px)`
          }}
        />
        <div
          ref={surfaceRef}
          className="absolute left-0 top-0"
          style={{
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.s})`,
            transformOrigin: '0 0'
          }}
        >
          {boardItems.map((item) => {
            const asset = item.assetId ? assetById.get(item.assetId) : undefined
            const autoH = item.height > 0 ? item.height : item.width * (aspectCache[item.assetId ?? ''] ?? 0.75)
            const isSelected = selectedId === item.id
            return (
              <div
                key={item.id}
                data-board-item={item.id}
                className="absolute select-none"
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.type === 'asset' ? autoH : item.height,
                  zIndex: item.z,
                  outline: isSelected ? '2px solid var(--accent)' : '1px solid rgba(128,128,128,0.35)',
                  outlineOffset: isSelected ? 1 : 0,
                  cursor: 'move',
                  background: item.type === 'note' ? 'rgba(30,32,36,0.9)' : 'transparent'
                }}
                onPointerDown={(e) => onItemPointerDown(e, item, 'move')}
                onPointerMove={onItemPointerMove}
                onPointerUp={(e) => void onItemPointerUp(e)}
                onClick={(e) => {
                  e.stopPropagation()
                  void onItemClick(item)
                }}
              >
                {item.type === 'asset' && asset ? (
                  asset.ext === 'mp4' || asset.ext === 'webm' || asset.ext === 'mov' ? (
                    <video
                      src={`${window.api.storyboardUrl(item.assetId!)}&e=${asset.edited ?? 0}`}
                      className="pointer-events-none h-full w-full object-cover"
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={assetThumbUrl(asset)}
                      className="pointer-events-none h-full w-full object-cover"
                      alt={asset.name}
                      draggable={false}
                      onLoad={(e) => onImgLoad(item, e)}
                    />
                  )
                ) : (
                  <textarea
                    aria-label="白板文字"
                    className="h-full w-full resize-none bg-transparent p-1.5 text-[13px] text-[var(--text-main)] outline-none"
                    placeholder="输入文字…"
                    defaultValue={item.text}
                    onBlur={(e) => {
                      if (e.target.value !== item.text) {
                        void window.api.updateBoardItem(item.id, { text: e.target.value })
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                )}
                {/* 调整大小手柄 */}
                <div
                  className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
                  style={{ background: 'linear-gradient(135deg, transparent 45%, var(--accent) 45%, var(--accent) 55%, transparent 55%)' }}
                  onPointerDown={(e) => onItemPointerDown(e, item, 'resize')}
                  onPointerMove={onItemPointerMove}
                  onPointerUp={(e) => void onItemPointerUp(e)}
                />
              </div>
            )
          })}
          {boardItems.length === 0 && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
              <p className="text-[13px] text-[var(--text-faint)]">从图库拖素材到这里,或点工具栏「文字」添加备注</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
