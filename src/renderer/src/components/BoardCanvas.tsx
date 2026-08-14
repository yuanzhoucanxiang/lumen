import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetThumbUrl, useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import type { BoardItem } from '@shared/types'

const ASSET_MIME = 'application/x-eaglelike-assets'

interface Viewport {
  s: number // zoom
  x: number // translate x (px)
  y: number // translate y (px)
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const MIN_SIZE = 40

/** 8 向缩放手柄（照抄 MOTZ selection-handles） */
const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type ResizeDir = (typeof RESIZE_HANDLES)[number]

/** note 可选字体（照抄 MOTZ note-font-select 的简化版） */
const NOTE_FONTS = [
  { label: '系统默认', value: '' },
  { label: '思源黑体', value: "'PingFang SC','Microsoft YaHei',sans-serif" },
  { label: '宋体', value: "'SimSun',serif" },
  { label: '等宽', value: "'Cascadia Mono','JetBrains Mono',monospace" },
  { label: '楷体', value: "'KaiTi','STKaiti',serif" }
]
/** note 可选颜色（照抄 MOTZ note-color-row） */
const NOTE_COLORS = ['#e8eef7', '#ffd9a0', '#a8d8a0', '#a0c8ff', '#f0a3a5']

export interface BoardCanvasApi {
  zoomTo: (s: number) => void
  resetView: () => void
}

/**
 * 白板画布核心：无限画布（frame+surface 两层结构）。
 * - 滚轮缩放以光标为锚点
 * - 空格+拖拽 / 中键平移
 * - 从图库拖素材进来（application/x-eaglelike-assets MIME）
 * - 元素：图片/视频/文字；拖动/8 向手柄缩放/Delete 删除/点击置顶
 * - 右键菜单：元素（移除/排列）/ 空白（添加文本/排列）/ note（字体/颜色）
 * - onApiReady 暴露缩放控制给工具栏
 */
export default function BoardCanvas({ onApiReady }: { onApiReady?: (api: BoardCanvasApi) => void }) {
  const boardItems = useLibraryStore((s) => s.boardItems)
  const assets = useLibraryStore((s) => s.assets)
  const refreshBoardItems = useLibraryStore((s) => s.refreshBoardItems)
  const activeBoardId = useLibraryStore((s) => s.activeBoardId)

  /* ---------- 视口状态 ---------- */
  const [viewport, setViewport] = useState<Viewport>({ s: 1, x: 0, y: 0 })
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const surfaceRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
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
  // 拖动/调整大小中的元素（实时改 DOM style,松手写 DB）
  const dragRef = useRef<{
    id: string
    mode: 'move' | 'resize'
    dir?: ResizeDir
    startX: number
    startY: number
    orig: { x: number; y: number; w: number; h: number }
  } | null>(null)

  // 素材宽高比缓存（用于 height=0 时自动计算）
  const [aspectCache, setAspectCache] = useState<Record<string, number>>({})

  /* ---------- 右键菜单 ---------- */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; itemId: string | null } | null>(null)

  // 切换白板时重置视口与选中
  useEffect(() => {
    const reset = { s: 1, x: 0, y: 0 }
    viewportRef.current = reset
    setViewport(reset)
    setSel(null)
    if (surfaceRef.current) surfaceRef.current.style.transform = 'translate3d(0px, 0px, 0px) scale(1)'
  }, [activeBoardId])

  const boardId = activeBoardId

  // 暴露缩放 API 给工具栏
  useEffect(() => {
    onApiReady?.({
      zoomTo: (s) => {
        const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s))
        const next = { s: ns, x: viewportRef.current.x, y: viewportRef.current.y }
        viewportRef.current = next
        setViewport(next)
        if (surfaceRef.current) surfaceRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.s})`
      },
      resetView: () => {
        const next = { s: 1, x: 0, y: 0 }
        viewportRef.current = next
        setViewport(next)
        if (surfaceRef.current) surfaceRef.current.style.transform = 'translate3d(0px, 0px, 0px) scale(1)'
      }
    })
  }, [onApiReady])

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

  /** 素材加入白板（照抄 MOTZ 错开摆放）——供拖入/发送复用 */
  const addAssetsToBoard = useCallback(
    async (ids: string[], x?: number, y?: number) => {
      if (boardId == null) return
      const existing = useLibraryStore.getState().boardItems.length
      const originX = x ?? 96 + ((existing * 42) % 260)
      const originY = y ?? 90 + ((existing * 34) % 180)
      let cursorX = originX
      let cursorY = originY
      let rowHeight = 0
      let firstId: string | null = null
      for (let i = 0; i < ids.length; i++) {
        if (i > 0 && i % 3 === 0) {
          cursorX = originX
          cursorY += rowHeight
          rowHeight = 0
        }
        const asset = assets.find((a) => a.id === ids[i])
        // 照抄 MOTZ fitImageNodeSize：最大 280 宽,保持比例
        let w = 240
        if (asset && asset.width > 0 && asset.height > 0) {
          const maxW = 280
          const ratio = asset.height / Math.max(1, asset.width)
          w = Math.min(maxW, asset.width > maxW ? maxW : asset.width)
          const h = w * ratio
          await window.api.addBoardItem(boardId, {
            assetId: ids[i],
            type: 'asset',
            x: Math.round(cursorX),
            y: Math.round(cursorY),
            width: Math.round(w),
            height: Math.round(h)
          })
          cursorX += w
          rowHeight = Math.max(rowHeight, h)
        } else {
          await window.api.addBoardItem(boardId, {
            assetId: ids[i],
            type: 'asset',
            x: Math.round(cursorX),
            y: Math.round(cursorY),
            width: w,
            height: 0
          })
          cursorX += w
          rowHeight = Math.max(rowHeight, w * 0.75)
        }
        firstId ??= ''
      }
      await refreshBoardItems(boardId)
      void firstId
    },
    [boardId, refreshBoardItems, assets]
  )

  /* ---------- 画布事件 ---------- */
  // 滚轮缩放用原生监听(passive:false 保证 preventDefault 生效)
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
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
      setViewport(next)
      if (surfaceRef.current) {
        surfaceRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.s})`
      }
    }
    frame.addEventListener('wheel', onWheelNative, { passive: false })
    return () => frame.removeEventListener('wheel', onWheelNative)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    // 中键或空格+左键：平移画布
    if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
      e.preventDefault()
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* 合成事件忽略 */
      }
      panRef.current = { startX: e.clientX, startY: e.clientY, vx: viewportRef.current.x, vy: viewportRef.current.y }
      setPanning(true)
      return
    }
    if (e.button === 0) {
      setSel(null)
      setCtxMenu(null)
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
      if (e.key === 'Escape') {
        setCtxMenu(null)
        setSel(null)
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
  }, [boardId, refreshBoardItems])

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

  /* ---------- 元素拖动/8 向缩放 ---------- */
  const onItemPointerDown = (e: React.PointerEvent, item: BoardItem, mode: 'move' | 'resize', dir?: ResizeDir) => {
    if (e.button !== 0) return
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件忽略 */
    }
    setSel(item.id)
    setCtxMenu(null)
    dragRef.current = { id: item.id, mode, dir, startX: e.clientX, startY: e.clientY, orig: { x: item.x, y: item.y, w: item.width, h: item.height } }
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
      return
    }
    // 8 向缩放（照抄 MOTZ selection-handles 的方向逻辑）
    const dir = d.dir ?? 'se'
    let { x, y, w, h } = { x: d.orig.x, y: d.orig.y, w: d.orig.w, h: d.orig.h }
    if (dir.includes('e')) w = Math.max(MIN_SIZE, d.orig.w + dx)
    if (dir.includes('s')) h = Math.max(MIN_SIZE, d.orig.h + dy)
    if (dir.includes('w')) {
      const nw = Math.max(MIN_SIZE, d.orig.w - dx)
      x = d.orig.x + (d.orig.w - nw)
      w = nw
    }
    if (dir.includes('n')) {
      const nh = Math.max(MIN_SIZE, d.orig.h - dy)
      y = d.orig.y + (d.orig.h - nh)
      h = nh
    }
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.width = `${w}px`
    el.style.height = `${h}px`
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
      const dir = d.dir ?? 'se'
      let { x, y, w, h } = { x: d.orig.x, y: d.orig.y, w: d.orig.w, h: d.orig.h }
      if (dir.includes('e')) w = Math.max(MIN_SIZE, d.orig.w + dx)
      if (dir.includes('s')) h = Math.max(MIN_SIZE, d.orig.h + dy)
      if (dir.includes('w')) {
        const nw = Math.max(MIN_SIZE, d.orig.w - dx)
        x = d.orig.x + (d.orig.w - nw)
        w = nw
      }
      if (dir.includes('n')) {
        const nh = Math.max(MIN_SIZE, d.orig.h - dy)
        y = d.orig.y + (d.orig.h - nh)
        h = nh
      }
      await window.api.updateBoardItem(d.id, { x, y, width: w, height: h })
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

  /* ---------- 右键菜单 ---------- */
  const openCtxMenu = (e: React.MouseEvent, item: BoardItem | null) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, itemId: item?.id ?? null })
  }
  const removeCtxItem = async () => {
    if (ctxMenu?.itemId) {
      await window.api.deleteBoardItem(ctxMenu.itemId)
      setSel(null)
      if (boardId != null) await refreshBoardItems(boardId)
    }
    setCtxMenu(null)
  }
  const addNoteFromMenu = async () => {
    if (boardId == null) return
    const pt = canvasPointFromClient(ctxMenu?.x ?? 0, ctxMenu?.y ?? 0)
    await window.api.addBoardItem(boardId, { type: 'note', x: Math.round(pt.x), y: Math.round(pt.y), width: 200, height: 60, text: '' })
    await refreshBoardItems(boardId)
    setCtxMenu(null)
  }
  const arrangeCtx = async (mode: 'grid' | 'row' | 'column') => {
    if (boardId == null) return
    const target = ctxMenu?.itemId ? boardItems.filter((i) => i.id === ctxMenu.itemId) : boardItems.filter((i) => i.type === 'asset')
    const startX = 72
    const startY = 72
    let cursor = 0
    let rowHeight = 0
    let gridX = startX
    let gridY = startY
    let assetIdx = 0
    for (const it of target) {
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
    await refreshBoardItems(boardId)
    setCtxMenu(null)
  }
  const setNoteStyle = async (patch: { noteFont?: string; noteColor?: string }) => {
    if (!ctxMenu?.itemId) return
    await window.api.updateBoardItem(ctxMenu.itemId, patch)
    if (boardId != null) await refreshBoardItems(boardId)
    setCtxMenu(null)
  }

  /* ---------- 素材宽高比（用于 height=0 自动计算） ---------- */
  const onImgLoad = (item: BoardItem, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > 0 && item.assetId) {
      setAspectCache((prev) => ({ ...prev, [item.assetId!]: img.naturalWidth / img.naturalHeight }))
    }
  }

  // 素材详情 map
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])

  // 右键菜单里的 note 元素
  const ctxItem = ctxMenu?.itemId ? boardItems.find((i) => i.id === ctxMenu.itemId) : null
  const ctxIsNote = ctxItem?.type === 'note'

  return (
    <div
      ref={frameRef}
      className="relative min-h-0 flex-1 overflow-hidden"
      style={{ cursor: panning ? 'grabbing' : spaceDown ? 'grab' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={(e) => openCtxMenu(e, null)}
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
              onContextMenu={(e) => openCtxMenu(e, item)}
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
                  className="h-full w-full resize-none bg-transparent p-1.5 text-[13px] outline-none"
                  style={{ fontFamily: item.noteFont || undefined, color: item.noteColor || 'var(--text-main)' }}
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
              {/* 8 向缩放手柄（照抄 MOTZ selection-handles） */}
              {isSelected && (
                <div className="pointer-events-none absolute -inset-1">
                  {RESIZE_HANDLES.map((handle) => (
                    <span
                      key={handle}
                      data-resize-handle={handle}
                      className="pointer-events-auto absolute h-2.5 w-2.5 border border-[var(--accent)] bg-[var(--bg-base)]"
                      style={{
                        ...(handle.includes('n') ? { top: -4 } : handle.includes('s') ? { bottom: -4 } : { top: '50%', marginTop: -5 }),
                        ...(handle.includes('w') ? { left: -4 } : handle.includes('e') ? { right: -4 } : { left: '50%', marginLeft: -5 }),
                        cursor: `${handle === 'nw' || handle === 'se' ? 'nwse' : handle === 'ne' || handle === 'sw' ? 'nesw' : handle === 'n' || handle === 's' ? 'ns' : 'ew'}-resize`
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onItemPointerDown(e, item, 'resize', handle)
                      }}
                      onPointerMove={onItemPointerMove}
                      onPointerUp={(e) => void onItemPointerUp(e)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {boardItems.length === 0 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
            <p className="text-[13px] text-[var(--text-faint)]">从左侧素材卡片发送/拖拽素材到这里,或右键添加文本</p>
          </div>
        )}
      </div>

      {/* 右键菜单（照抄 MOTZ board-context-menu） */}
      {ctxMenu && (
        <div
          className="menu fixed z-[300] w-44 py-1"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 190), top: Math.min(ctxMenu.y, window.innerHeight - 220) }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxItem ? (
            <>
              <button
                className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] text-[var(--danger)] hover:bg-[var(--bg-hover)]"
                onClick={() => void removeCtxItem()}
              >
                从白板移除
              </button>
              {ctxIsNote && (
                <div className="border-t border-[var(--border)] px-3 py-2">
                  <div className="mb-1 text-[10px] text-[var(--text-faint)]">字体</div>
                  <select
                    aria-label="note 字体"
                    className="field-input w-full px-1.5 py-1 text-[11px]"
                    value={ctxItem.noteFont}
                    onChange={(e) => void setNoteStyle({ noteFont: e.target.value })}
                  >
                    {NOTE_FONTS.map((f) => (
                      <option key={f.label} value={f.value} style={{ fontFamily: f.value || undefined }}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <div className="mb-1 mt-2 text-[10px] text-[var(--text-faint)]">文本颜色</div>
                  <div className="flex items-center gap-1">
                    {NOTE_COLORS.map((c) => (
                      <button
                        key={c}
                        aria-label={`文本颜色 ${c}`}
                        className={`h-4 w-4 rounded-full border transition-transform duration-100 hover:scale-110 ${
                          ctxItem.noteColor === c ? 'ring-2 ring-white/60' : 'border-white/20'
                        }`}
                        style={{ background: c }}
                        onClick={() => void setNoteStyle({ noteColor: c })}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="自定义文字颜色"
                      className="h-4 w-4 cursor-pointer border-none bg-transparent p-0"
                      value={ctxItem.noteColor || '#e8eef7'}
                      onChange={(e) => void setNoteStyle({ noteColor: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <div className="my-1 border-t border-[var(--border)]" />
            </>
          ) : (
            <button
              className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
              onClick={() => void addNoteFromMenu()}
            >
              <Icon name="type" size={12} />
              添加文本
            </button>
          )}
          <button className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]" onClick={() => void arrangeCtx('grid')}>
            网格排列{ctxItem ? '选中' : ''}
          </button>
          <button className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]" onClick={() => void arrangeCtx('row')}>
            横向排列{ctxItem ? '选中' : ''}
          </button>
          <button className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]" onClick={() => void arrangeCtx('column')}>
            纵向排列{ctxItem ? '选中' : ''}
          </button>
        </div>
      )}
    </div>
  )
}
