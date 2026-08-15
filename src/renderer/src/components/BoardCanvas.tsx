import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { assetThumbUrl, useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import { useTheme } from '../theme'
import type { BoardItem, ShapeSpec } from '@shared/types'

const ASSET_MIME = 'application/x-eaglelike-assets'

/** 白板工具模式 */
export type BoardTool = 'select' | 'pen' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'note'

interface Viewport {
  s: number // zoom
  x: number // translate x (px)
  y: number // translate y (px)
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const MIN_SIZE = 40
/** 框选拖拽超过该距离(画布坐标 px)才视为框选而非点击 */
const MARQUEE_THRESHOLD = 3
/** 形状描边默认样式（新绘制时使用,右键改样式后记忆） */
const DEFAULT_SHAPE_STYLE = { color: '#5aa0ff', sw: 2.5 }
/** 形状可选颜色 */
const SHAPE_COLORS = ['#5aa0ff', '#ff6b6b', '#ffd166', '#4ade80', '#c792ea', '#e8eef7']
/** 形状可选线宽 */
const SHAPE_WIDTHS = [1.5, 2.5, 4, 6, 8]
/** 画布外观预设（bg 键 → 颜色） */
const APPEARANCE_PRESETS: Record<string, string> = {
  dark: '#191c20',
  gray: '#262a31',
  light: '#e8e8e8',
  white: '#ffffff',
  black: '#0c0d0f'
}

interface BoardAppearance {
  bg: string
  grid: boolean
  gridSize: number
}
const DEFAULT_APPEARANCE: BoardAppearance = { bg: 'dark', grid: true, gridSize: 24 }

/** hex 颜色亮度（0-1），用于点阵颜色深浅自适应 */
function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0.2
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** XML 转义（导出 SVG 用） */
function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 形状元素 → SVG 子元素（元素内坐标,unit=item 尺寸） */
function shapeSvgNodes(shape: ShapeSpec, w: number, h: number): ReactNode | null {
  const color = shape.color || DEFAULT_SHAPE_STYLE.color
  const sw = shape.sw ?? DEFAULT_SHAPE_STYLE.sw
  const common = { stroke: color, strokeWidth: sw, fill: 'none', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
  const pts = shape.points ?? []
  switch (shape.kind) {
    case 'rect':
      return <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={2} {...common} />
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - sw / 2)} ry={Math.max(0, h / 2 - sw / 2)} {...common} />
    case 'line': {
      const [p0, p1] = [pts[0] ?? [0, 0], pts[1] ?? [1, 1]]
      return <line x1={p0[0] * w} y1={p0[1] * h} x2={p1[0] * w} y2={p1[1] * h} {...common} />
    }
    case 'arrow': {
      const [p0, p1] = [pts[0] ?? [0, 0], pts[1] ?? [1, 1]]
      const x1 = p0[0] * w
      const y1 = p0[1] * h
      const x2 = p1[0] * w
      const y2 = p1[1] * h
      const ang = Math.atan2(y2 - y1, x2 - x1)
      const hs = Math.max(10, sw * 3.5)
      const hx1 = x2 - hs * Math.cos(ang - 0.42)
      const hy1 = y2 - hs * Math.sin(ang - 0.42)
      const hx2 = x2 - hs * Math.cos(ang + 0.42)
      const hy2 = y2 - hs * Math.sin(ang + 0.42)
      return (
        <>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
          <polygon points={`${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`} fill={color} stroke="none" />
        </>
      )
    }
    case 'pen': {
      if (pts.length < 2) return null
      const poly = pts.map(([x, y]) => `${(x * w).toFixed(2)},${(y * h).toFixed(2)}`).join(' ')
      return <polyline points={poly} {...common} />
    }
  }
}

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
  fitContent: () => void
  /** 生成画布场景 SVG（图片内嵌 base64） */
  exportSvg: () => Promise<string>
  /** 当前工具（工具栏切换时同步） */
  setTool: (t: BoardTool) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: () => boolean
  canRedo: () => boolean
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 白板画布核心：无限画布（frame+surface 两层结构）。
 * - 滚轮缩放以光标为锚点
 * - 空格+拖拽 / 中键平移
 * - 空白处拖拽 = 框选多选（Shift=追加），框选后组移动 / 组缩放（8 向手柄）
 * - 从图库拖素材进来（application/x-eaglelike-assets MIME）
 * - 元素：图片/视频/文字/矢量形状；拖动/8 向手柄缩放/Delete 删除/点击置顶
 * - 绘图工具：手绘/箭头/直线/矩形/椭圆/文字（tool prop 控制）
 * - 快捷键：Ctrl+Z/Y 撤销重做 / Ctrl+C/V/D 复制粘贴 / 方向键微调 / 0 复位 / ± 缩放 / F 适配
 * - 双击空白适配全部内容；画布外观（背景色/网格）按白板持久化
 * - onApiReady 暴露缩放/适配/导出/工具控制给工具栏
 */
export default function BoardCanvas({
  onApiReady,
  tool = 'select',
  onViewportChange
}: {
  onApiReady?: (api: BoardCanvasApi) => void
  tool?: BoardTool
  onViewportChange?: (s: number) => void
}) {
  const theme = useTheme()
  const pixel = theme === 'pixel-glitch'
  const boardItems = useLibraryStore((s) => s.boardItems)
  const assets = useLibraryStore((s) => s.assets)
  const boards = useLibraryStore((s) => s.boards)
  const refreshBoardItems = useLibraryStore((s) => s.refreshBoardItems)
  const refreshBoards = useLibraryStore((s) => s.refreshBoards)
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

  /* ---------- 画布外观（背景色/网格,按白板持久化） ---------- */
  const [appearance, setAppearance] = useState<BoardAppearance>(DEFAULT_APPEARANCE)
  useEffect(() => {
    const b = boards.find((x) => x.id === activeBoardId)
    let a: BoardAppearance = DEFAULT_APPEARANCE
    try {
      const p = JSON.parse(b?.appearance ?? '')
      if (p && typeof p === 'object') {
        a = { bg: typeof p.bg === 'string' ? p.bg : 'dark', grid: p.grid !== false, gridSize: Number(p.gridSize) || 24 }
      }
    } catch {
      /* 忽略 */
    }
    setAppearance(a)
  }, [boards, activeBoardId])
  const bgColor = APPEARANCE_PRESETS[appearance.bg] ?? appearance.bg
  const gridDotColor = hexLuminance(bgColor) > 0.6 ? 'rgba(60,60,60,0.22)' : 'rgba(255,255,255,0.14)'
  // ref 镜像：导出 SVG 等异步回调避免闭包过期
  const appearanceRef = useRef(appearance)
  appearanceRef.current = appearance

  /* ---------- 绘图工具状态 ---------- */
  // 进行中的绘制（画布坐标）
  const drawingRef = useRef<{ kind: Exclude<BoardTool, 'select' | 'note'>; startX: number; startY: number; curX: number; curY: number; points: [number, number][] } | null>(null)
  // 实时预览（画布坐标）
  const [drawPreview, setDrawPreview] = useState<{ kind: Exclude<BoardTool, 'select' | 'note'>; x: number; y: number; w: number; h: number; points: [number, number][]; color: string; sw: number } | null>(null)
  // 形状样式记忆：右键改样式后,新绘制沿用
  const shapeStyleRef = useRef<{ color: string; sw: number }>({ ...DEFAULT_SHAPE_STYLE })
  // 工具 prop 的 ref 镜像（事件回调里读最新值）
  const toolRef = useRef(tool)
  toolRef.current = tool

  /* ---------- 撤销/重做（按当前白板,切换白板即清空） ---------- */
  const histRef = useRef<{ undo: BoardItem[][]; redo: BoardItem[][] }>({ undo: [], redo: [] })
  useEffect(() => {
    histRef.current = { undo: [], redo: [] }
  }, [activeBoardId])
  const pushHistory = () => {
    const h = histRef.current
    h.undo.push(boardItemsRef.current.map((i) => ({ ...i, shape: i.shape })))
    if (h.undo.length > 60) h.undo.shift()
    h.redo = []
  }
  /** 快照 diff 应用：删除多余 / 新增缺失 / 更新差异字段 */
  const applySnapshot = async (target: BoardItem[]) => {
    if (boardIdRef.current == null) return
    const cur = useLibraryStore.getState().boardItems
    const curMap = new Map(cur.map((i) => [i.id, i]))
    const tgtMap = new Map(target.map((i) => [i.id, i]))
    const toDelete = cur.filter((i) => !tgtMap.has(i.id)).map((i) => i.id)
    const toAdd = target.filter((i) => !curMap.has(i.id))
    const toUpdate: { id: string; patch: Record<string, string | number | null> }[] = []
    for (const t of target) {
      const c = curMap.get(t.id)
      if (!c) continue
      const patch: Record<string, string | number | null> = {}
      for (const k of ['x', 'y', 'width', 'height', 'z', 'text', 'noteFont', 'noteColor', 'opacity', 'shape'] as const) {
        if (c[k] !== t[k]) patch[k] = t[k] as string | number | null
      }
      if (Object.keys(patch).length > 0) toUpdate.push({ id: t.id, patch })
    }
    for (const id of toDelete) await window.api.deleteBoardItem(id)
    for (const t of toAdd) {
      const row = await window.api.addBoardItem(boardIdRef.current, {
        type: t.type,
        assetId: t.assetId,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        text: t.text,
        shape: t.shape ?? undefined,
        opacity: t.opacity ?? 100,
        noteFont: t.noteFont ?? '',
        noteColor: t.noteColor ?? ''
      })
      // 还原层级（addBoardItem 自增 z,快照里的 z 需显式恢复）
      if (row.z !== t.z) await window.api.updateBoardItem(row.id, { z: t.z })
    }
    if (toUpdate.length > 0) await window.api.updateBoardItems(toUpdate as { id: string; patch: Partial<BoardItem> }[])
    await refreshBoardItems(boardIdRef.current)
  }
  const undo = async () => {
    const h = histRef.current
    const prev = h.undo.pop()
    if (!prev) return
    h.redo.push(useLibraryStore.getState().boardItems.map((i) => ({ ...i, shape: i.shape })))
    await applySnapshot(prev)
  }
  const redo = async () => {
    const h = histRef.current
    const next = h.redo.pop()
    if (!next) return
    h.undo.push(useLibraryStore.getState().boardItems.map((i) => ({ ...i, shape: i.shape })))
    await applySnapshot(next)
  }

  /* ---------- 复制/粘贴 ---------- */
  const clipboardRef = useRef<BoardItem[]>([])
  const copySelection = () => {
    const ids = selectedIdsRef.current
    if (ids.length === 0) return
    clipboardRef.current = boardItemsRef.current
      .filter((i) => ids.includes(i.id))
      .map((i) => ({ ...i, shape: i.shape }))
  }
  const addItemCopies = async (src: BoardItem[], dx: number, dy: number) => {
    if (boardIdRef.current == null || src.length === 0) return
    pushHistory()
    for (const it of src) {
      await window.api.addBoardItem(boardIdRef.current, {
        type: it.type,
        assetId: it.assetId,
        x: Math.round(it.x + dx),
        y: Math.round(it.y + dy),
        width: it.width,
        height: it.height,
        text: it.text,
        shape: it.shape ?? undefined,
        opacity: it.opacity ?? 100,
        noteFont: it.noteFont ?? '',
        noteColor: it.noteColor ?? ''
      })
    }
    await refreshBoardItems(boardIdRef.current)
  }
  const duplicateSelection = () => addItemCopies(boardItemsRef.current.filter((i) => selectedIdsRef.current.includes(i.id)), 24, 24)
  const pasteClipboard = () => addItemCopies(clipboardRef.current, 24, 24)

  /* ---------- 方向键微调（DOM 实时,keyup 落库） ---------- */
  const nudgeRef = useRef<{ origs: Map<string, { x: number; y: number }>; dx: number; dy: number } | null>(null)
  const startNudge = () => {
    if (nudgeRef.current) return
    const ids = selectedIdsRef.current
    if (ids.length === 0) return
    const origs = new Map<string, { x: number; y: number }>()
    for (const it of boardItemsRef.current) {
      if (ids.includes(it.id)) origs.set(it.id, { x: it.x, y: it.y })
    }
    if (origs.size === 0) return
    pushHistory()
    nudgeRef.current = { origs, dx: 0, dy: 0 }
  }
  const applyNudge = (dx: number, dy: number) => {
    const n = nudgeRef.current
    if (!n) return
    n.dx += dx
    n.dy += dy
    for (const [id, o] of n.origs) {
      const el = itemEls.current.get(id)
      if (el) {
        el.style.left = `${o.x + n.dx}px`
        el.style.top = `${o.y + n.dy}px`
      }
    }
  }
  const flushNudge = async () => {
    const n = nudgeRef.current
    if (!n) return
    nudgeRef.current = null
    if (n.dx === 0 && n.dy === 0) return
    const updates = [...n.origs].map(([id, o]) => ({ id, patch: { x: Math.round(o.x + n.dx), y: Math.round(o.y + n.dy) } }))
    await window.api.updateBoardItems(updates)
    if (boardIdRef.current != null) await refreshBoardItems(boardIdRef.current)
  }
  // 窗口失焦时兜底落库,避免微调状态卡死
  useEffect(() => {
    const onBlur = () => void flushNudge()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  // boardId 的 ref 镜像（回调闭包里避免过期）
  const boardIdRef = useRef(activeBoardId)
  boardIdRef.current = activeBoardId

  /* ---------- 视口应用辅助（滚轮/快捷键/适配共用） ---------- */
  const applyViewport = useCallback(
    (next: Viewport) => {
      viewportRef.current = next
      setViewport(next)
      if (surfaceRef.current) surfaceRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.s})`
      onViewportChange?.(next.s)
    },
    [onViewportChange]
  )

  /* ---------- 选中（多选） ---------- */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdsRef = useRef<string[]>([])
  const setSel = (ids: string[]) => {
    selectedIdsRef.current = ids
    setSelectedIds(ids)
  }
  const isSelected = (id: string) => selectedIdsRef.current.includes(id)

  // 元素 DOM 引用（组移动/组缩放时直接改 style,避免逐帧 React 渲染）
  const itemEls = useRef(new Map<string, HTMLElement>())

  // 框选状态：start = 按下时的画布坐标;rect = 当前框(画布坐标),null = 未开始/未拖动
  const marqueeRef = useRef<{
    startX: number
    startY: number
    curX: number
    curY: number
    additive: boolean
    moved: boolean
  } | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)

  // 拖动/调整大小中的元素组（实时改 DOM style,松手写 DB）
  const dragRef = useRef<{
    ids: string[]
    mode: 'move' | 'resize'
    dir?: ResizeDir
    startX: number
    startY: number
    origs: Map<string, Rect>
    bbox: Rect // resize 模式的原始组包围盒
  } | null>(null)
  // 组包围盒 DOM（缩放时直接改 style）
  const groupBoxRef = useRef<HTMLDivElement>(null)

  // 素材宽高比缓存（用于 height=0 时自动计算）
  const [aspectCache, setAspectCache] = useState<Record<string, number>>({})
  const aspectCacheRef = useRef(aspectCache)
  aspectCacheRef.current = aspectCache

  /* ---------- 右键菜单 ---------- */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; itemId: string | null } | null>(null)
  /** 参考线右键菜单（index 指向 guides 数组） */
  const [guideMenu, setGuideMenu] = useState<{ x: number; y: number; index: number } | null>(null)

  /* ---------- 参考线（对标 PureRef 参考辅助） ---------- */
  interface Guide {
    x?: number
    y?: number
    horizontal: boolean
  }
  const [guides, setGuides] = useState<Guide[]>([])
  // 白板切换时从 store 的 boards 解析参考线（用 activeBoardId：boardId 声明在后面,render 求值 deps 会 TDZ）
  useEffect(() => {
    const b = boards.find((x) => x.id === activeBoardId)
    let g: Guide[] = []
    try {
      const parsed = JSON.parse(b?.guides ?? '[]') as Guide[]
      g = Array.isArray(parsed) ? parsed : []
    } catch {
      g = []
    }
    setGuides(g)
  }, [boards, activeBoardId])
  // 拖动中的参考线（实时改局部 state,松手持久化）
  const guideDragRef = useRef<{ index: number; horizontal: boolean; startX: number; startY: number; orig: number } | null>(null)
  // guides 的 ref 镜像：pointerup 可能发生在 setGuides 重渲染前,闭包里的 guides 会过期
  const guidesRef = useRef<Guide[]>([])
  guidesRef.current = guides

  const persistGuides = async (next: Guide[]) => {
    setGuides(next)
    if (boardId != null) {
      await window.api.setBoardGuides(boardId, JSON.stringify(next))
      await refreshBoards()
    }
  }

  const startGuideDrag = (index: number, g: Guide, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件忽略 */
    }
    guideDragRef.current = { index, horizontal: g.horizontal, startX: e.clientX, startY: e.clientY, orig: g.horizontal ? g.y ?? 0 : g.x ?? 0 }
  }
  const onGuidePointerMove = (e: React.PointerEvent) => {
    const d = guideDragRef.current
    if (!d) return
    const delta = (d.horizontal ? e.clientY - d.startY : e.clientX - d.startX) / viewportRef.current.s
    setGuides((prev) =>
      prev.map((g, i) => (i === d.index ? (d.horizontal ? { ...g, y: Math.round(d.orig + delta) } : { ...g, x: Math.round(d.orig + delta) }) : g))
    )
  }
  const onGuidePointerUp = async (e: React.PointerEvent) => {
    const d = guideDragRef.current
    if (!d) return
    guideDragRef.current = null
    // 从 drag 起点重算目标位置（不依赖可能过期的闭包 state）
    const delta = (d.horizontal ? e.clientY - d.startY : e.clientX - d.startX) / viewportRef.current.s
    const next = guidesRef.current.map((g, i) =>
      i === d.index ? (d.horizontal ? { ...g, y: Math.round(d.orig + delta) } : { ...g, x: Math.round(d.orig + delta) }) : g
    )
    setGuides(next)
    if (boardId != null) {
      await window.api.setBoardGuides(boardId, JSON.stringify(next))
      await refreshBoards()
    }
  }
  const openGuideMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu(null)
    setGuideMenu({ x: e.clientX, y: e.clientY, index })
  }
  const deleteGuide = async () => {
    const idx = guideMenu?.index
    setGuideMenu(null)
    if (idx == null) return
    await persistGuides(guides.filter((_, i) => i !== idx))
  }
  const addGuideFromMenu = async (horizontal: boolean) => {
    if (boardId == null) return
    const pt = canvasPointFromClient(ctxMenu?.x ?? 0, ctxMenu?.y ?? 0)
    const next = horizontal ? [...guides, { horizontal, y: Math.round(pt.y) }] : [...guides, { horizontal, x: Math.round(pt.x) }]
    await persistGuides(next)
    setCtxMenu(null)
  }

  // 切换白板时重置视口与选中
  useEffect(() => {
    const reset = { s: 1, x: 0, y: 0 }
    viewportRef.current = reset
    setViewport(reset)
    setSel([])
    setMarquee(null)
    setDrawPreview(null)
    drawingRef.current = null
    if (surfaceRef.current) surfaceRef.current.style.transform = 'translate3d(0px, 0px, 0px) scale(1)'
    onViewportChange?.(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoardId])

  const boardId = activeBoardId

  /** 全部元素包围盒（画布坐标,空画布返回 null） */
  const itemsBBox = useCallback((): Rect | null => {
    const items = boardItemsRef.current
    if (items.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const it of items) {
      const h = it.height > 0 ? it.height : it.width * (aspectCacheRef.current[it.assetId ?? ''] ?? 0.75)
      minX = Math.min(minX, it.x)
      minY = Math.min(minY, it.y)
      maxX = Math.max(maxX, it.x + it.width)
      maxY = Math.max(maxY, it.y + h)
    }
    if (minX === Infinity) return null
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }, [])

  /** 以指定屏幕点为锚点缩放（factor>1 放大） */
  const zoomBy = useCallback(
    (factor: number) => {
      const frame = frameRef.current
      if (!frame) return
      const rect = frame.getBoundingClientRect()
      const v = viewportRef.current
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.s * factor))
      if (nextZoom === v.s) return
      const anchorX = rect.width / 2
      const anchorY = rect.height / 2
      const boardX = (anchorX - v.x) / v.s
      const boardY = (anchorY - v.y) / v.s
      applyViewport({ s: nextZoom, x: anchorX - boardX * nextZoom, y: anchorY - boardY * nextZoom })
    },
    [applyViewport]
  )

  /** 适配全部内容（有内容时缩放居中;空画布复位 100%） */
  const fitContent = useCallback(() => {
    const frame = frameRef.current
    if (!frame) return
    const bbox = itemsBBox()
    if (!bbox) {
      applyViewport({ s: 1, x: 0, y: 0 })
      return
    }
    const rect = frame.getBoundingClientRect()
    const pad = 60
    const s = Math.max(
      MIN_ZOOM,
      Math.min(1, (rect.width - pad * 2) / Math.max(1, bbox.w), (rect.height - pad * 2) / Math.max(1, bbox.h))
    )
    const cx = bbox.x + bbox.w / 2
    const cy = bbox.y + bbox.h / 2
    applyViewport({ s, x: rect.width / 2 - cx * s, y: rect.height / 2 - cy * s })
  }, [applyViewport, itemsBBox])

  // 暴露画布 API 给工具栏（缩放/复位/适配/导出/工具/撤销重做）
  useEffect(() => {
    onApiReady?.({
      zoomTo: (s) => {
        const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s))
        applyViewport({ s: ns, x: viewportRef.current.x, y: viewportRef.current.y })
      },
      resetView: () => {
        applyViewport({ s: 1, x: 0, y: 0 })
      },
      fitContent: () => fitContent(),
      exportSvg: () => buildBoardSvg(),
      setTool: () => {
        /* tool 由 prop 驱动 */
      },
      undo: () => undo(),
      redo: () => redo(),
      canUndo: () => histRef.current.undo.length > 0,
      canRedo: () => histRef.current.redo.length > 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onApiReady, applyViewport])

  /** 素材缩略图/故事板 → dataURL（导出 SVG 内嵌用） */
  const fetchToDataUrl = async (url: string): Promise<string> => {
    try {
      const r = await fetch(url)
      const blob = await r.blob()
      return await new Promise<string>((resolve) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => resolve('')
        fr.readAsDataURL(blob)
      })
    } catch {
      return ''
    }
  }

  /** 生成画布场景 SVG（背景/参考线/图片/文字/形状全量导出,图片内嵌 base64） */
  const buildBoardSvg = async (): Promise<string> => {
    const bbox = itemsBBox() ?? { x: 0, y: 0, w: 1200, h: 800 }
    const pad = 60
    const w = Math.max(800, Math.ceil(bbox.w + pad * 2))
    const h = Math.max(600, Math.ceil(bbox.h + pad * 2))
    const ox = bbox.x - pad
    const oy = bbox.y - pad
    const appr = appearanceRef.current
    const bg = APPEARANCE_PRESETS[appr.bg] ?? appr.bg
    const dotColor = hexLuminance(bg) > 0.6 ? 'rgba(60,60,60,0.22)' : 'rgba(255,255,255,0.14)'
    const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`]
    parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>`)
    if (appr.grid) {
      const gs = appr.gridSize
      parts.push(
        `<defs><pattern id="dots" width="${gs}" height="${gs}" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${dotColor}"/></pattern></defs>`
      )
      parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="url(#dots)"/>`)
    }
    for (const g of guidesRef.current) {
      if (g.horizontal) parts.push(`<line x1="0" y1="${(g.y ?? 0) - oy}" x2="${w}" y2="${(g.y ?? 0) - oy}" stroke="rgba(90,160,255,0.55)" stroke-dasharray="6 4"/>`)
      else parts.push(`<line x1="${(g.x ?? 0) - ox}" y1="0" x2="${(g.x ?? 0) - ox}" y2="${h}" stroke="rgba(90,160,255,0.55)" stroke-dasharray="6 4"/>`)
    }
    const assetMap = new Map(useLibraryStore.getState().assets.map((a) => [a.id, a]))
    for (const it of boardItemsRef.current) {
      const ex = it.x - ox
      const ey = it.y - oy
      const op = ((it.opacity ?? 100) / 100).toFixed(2)
      if (it.type === 'asset' && it.assetId) {
        const asset = assetMap.get(it.assetId)
        if (!asset) continue
        const dataUrl = await fetchToDataUrl(`${assetThumbUrl(asset)}&e=${asset.edited ?? 0}`)
        const ih = it.height > 0 ? it.height : it.width * (aspectCacheRef.current[it.assetId] ?? 0.75)
        if (dataUrl) {
          parts.push(`<image href="${dataUrl}" x="${ex}" y="${ey}" width="${it.width}" height="${ih}" opacity="${op}" preserveAspectRatio="none"/>`)
        } else {
          parts.push(`<rect x="${ex}" y="${ey}" width="${it.width}" height="${ih}" fill="none" stroke="#888" stroke-dasharray="4 3"/>`)
        }
      } else if (it.type === 'note') {
        const color = it.noteColor || '#e8eef7'
        const font = it.noteFont || 'sans-serif'
        const text = xmlEscape(it.text).replace(/\n/g, '<br/>')
        parts.push(
          `<foreignObject x="${ex}" y="${ey}" width="${it.width}" height="${it.height}" opacity="${op}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;background:rgba(30,32,36,0.9);color:${color};font-family:${font};font-size:13px;padding:6px;box-sizing:border-box;overflow:hidden;border-radius:2px">${text}</div></foreignObject>`
        )
      } else if (it.type === 'shape' && it.shape) {
        let shape: ShapeSpec
        try {
          shape = JSON.parse(it.shape) as ShapeSpec
        } catch {
          continue
        }
        const sw = shape.sw ?? 2.5
        const color = shape.color || '#5aa0ff'
        parts.push(`<g transform="translate(${ex},${ey})" opacity="${op}">`)
        if (shape.kind === 'rect') {
          parts.push(`<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, it.width - sw)}" height="${Math.max(0, it.height - sw)}" rx="2" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>`)
        } else if (shape.kind === 'ellipse') {
          parts.push(`<ellipse cx="${it.width / 2}" cy="${it.height / 2}" rx="${Math.max(0, it.width / 2 - sw / 2)}" ry="${Math.max(0, it.height / 2 - sw / 2)}" fill="none" stroke="${color}" stroke-width="${sw}"/>`)
        } else {
          const pts = shape.points ?? []
          const p0 = pts[0] ?? [0, 0]
          const p1 = pts[1] ?? [1, 1]
          const x1 = p0[0] * it.width
          const y1 = p0[1] * it.height
          const x2 = p1[0] * it.width
          const y2 = p1[1] * it.height
          if (shape.kind === 'line') {
            parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`)
          } else if (shape.kind === 'arrow') {
            const ang = Math.atan2(y2 - y1, x2 - x1)
            const hs = Math.max(10, sw * 3.5)
            const hx1 = x2 - hs * Math.cos(ang - 0.42)
            const hy1 = y2 - hs * Math.sin(ang - 0.42)
            const hx2 = x2 - hs * Math.cos(ang + 0.42)
            const hy2 = y2 - hs * Math.sin(ang + 0.42)
            parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`)
            parts.push(`<polygon points="${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}" fill="${color}"/>`)
          } else if (shape.kind === 'pen' && pts.length >= 2) {
            const poly = pts.map(([x, y]) => `${(x * it.width).toFixed(2)},${(y * it.height).toFixed(2)}`).join(' ')
            parts.push(`<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`)
          }
        }
        parts.push('</g>')
      }
    }
    parts.push('</svg>')
    return parts.join('')
  }

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

  /** 元素有效高度（height=0 时按素材宽高比推算） */
  const effHeight = useCallback(
    (item: BoardItem) => (item.height > 0 ? item.height : item.width * (aspectCache[item.assetId ?? ''] ?? 0.75)),
    [aspectCache]
  )

  /** 选中元素组的包围盒（画布坐标，按当前 boardItems 数据计算） */
  const selectionBBox = useMemo((): Rect | null => {
    const ids = selectedIds // 必须用 state 而非 ref：选中变化时触发 memo 重算
    if (ids.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const it of boardItems) {
      if (!ids.includes(it.id)) continue
      const h = effHeight(it)
      minX = Math.min(minX, it.x)
      minY = Math.min(minY, it.y)
      maxX = Math.max(maxX, it.x + it.width)
      maxY = Math.max(maxY, it.y + h)
    }
    if (minX === Infinity) return null
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }, [boardItems, effHeight, selectedIds])

  /** 素材加入白板（照抄 MOTZ 错开摆放）——供拖入/发送复用 */
  const addAssetsToBoard = useCallback(
    async (ids: string[], x?: number, y?: number) => {
      if (boardId == null) return
      pushHistory()
      const existing = useLibraryStore.getState().boardItems.length
      const originX = x ?? 96 + ((existing * 42) % 260)
      const originY = y ?? 90 + ((existing * 34) % 180)
      let cursorX = originX
      let cursorY = originY
      let rowHeight = 0
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
      }
      await refreshBoardItems(boardId)
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
      applyViewport({ s: nextZoom, x: anchorX - boardX * nextZoom, y: anchorY - boardY * nextZoom })
    }
    frame.addEventListener('wheel', onWheelNative, { passive: false })
    return () => frame.removeEventListener('wheel', onWheelNative)
  }, [applyViewport])

  /** 框选结束：把与框相交的元素加入/设为选中 */
  const finishMarquee = () => {
    const m = marqueeRef.current
    marqueeRef.current = null
    setMarquee(null)
    if (!m) return
    if (!m.moved) {
      // 空白处点击：清空选中
      if (!m.additive) setSel([])
      return
    }
    // 注意：必须在清空 ref 前算好矩形（marqueeRect 读 ref）
    const rect = {
      x: Math.min(m.startX, m.curX),
      y: Math.min(m.startY, m.curY),
      w: Math.abs(m.curX - m.startX),
      h: Math.abs(m.curY - m.startY)
    }
    if (rect.w === 0 && rect.h === 0) return
    const hit: string[] = []
    for (const it of boardItemsRef.current) {
      const h = effHeight(it)
      const ix = it.x
      const iy = it.y
      const iw = it.width
      const ih = h
      if (rect.x < ix + iw && rect.x + rect.w > ix && rect.y < iy + ih && rect.y + rect.h > iy) {
        hit.push(it.id)
      }
    }
    if (m.additive) {
      const cur = selectedIdsRef.current
      setSel([...new Set([...cur, ...hit])])
    } else {
      setSel(hit)
    }
  }

  /** 当前框选矩形（画布坐标） */
  const marqueeRect = (): Rect | null => {
    const m = marqueeRef.current
    if (!m) return null
    return {
      x: Math.min(m.startX, m.curX),
      y: Math.min(m.startY, m.curY),
      w: Math.abs(m.curX - m.startX),
      h: Math.abs(m.curY - m.startY)
    }
  }

  // 供 finishMarquee 读取最新 boardItems（回调在事件里,避免闭包过期）
  const boardItemsRef = useRef(boardItems)
  boardItemsRef.current = boardItems

  // 空白处双击（<350ms、位移<8px）→ 适配全部内容
  const lastEmptyClickRef = useRef<{ x: number; y: number; t: number } | null>(null)

  /** 在画布坐标放置一个文字便签 */
  const addNoteAt = async (x: number, y: number) => {
    if (boardIdRef.current == null) return
    pushHistory()
    await window.api.addBoardItem(boardIdRef.current, { type: 'note', x: Math.round(x), y: Math.round(y), width: 200, height: 60, text: '' })
    await refreshBoardItems(boardIdRef.current)
  }

  /** 实时预览（画布坐标原始点,渲染时归一化） */
  const updateDrawPreview = (d: NonNullable<typeof drawingRef.current>) => {
    const x = Math.min(d.startX, d.curX)
    const y = Math.min(d.startY, d.curY)
    const w = Math.max(1, Math.abs(d.curX - d.startX))
    const h = Math.max(1, Math.abs(d.curY - d.startY))
    const style = shapeStyleRef.current
    let pts: [number, number][]
    if (d.kind === 'pen') {
      pts = d.points.map(([px, py]) => [px - x, py - y])
    } else if (d.kind === 'line' || d.kind === 'arrow') {
      pts = [
        [d.startX - x, d.startY - y],
        [d.curX - x, d.curY - y]
      ]
    } else {
      pts = []
    }
    setDrawPreview({ kind: d.kind, x, y, w, h, points: pts, color: style.color, sw: style.sw })
  }

  /** 绘制结束：提交形状元素 */
  const commitDrawing = async () => {
    const d = drawingRef.current
    drawingRef.current = null
    setDrawPreview(null)
    if (!d || boardIdRef.current == null) return
    const x = Math.min(d.startX, d.curX)
    const y = Math.min(d.startY, d.curY)
    const w = Math.abs(d.curX - d.startX)
    const h = Math.abs(d.curY - d.startY)
    const style = shapeStyleRef.current
    const color = style.color
    const sw = style.sw
    if (d.kind === 'pen') {
      if (d.points.length < 2) return
      const nw = Math.max(1, w)
      const nh = Math.max(1, h)
      const norm = d.points.map(([px, py]) => [(px - x) / nw, (py - y) / nh])
      pushHistory()
      await window.api.addBoardItem(boardIdRef.current, {
        type: 'shape',
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(2, Math.round(w)),
        height: Math.max(2, Math.round(h)),
        shape: JSON.stringify({ kind: 'pen', points: norm, color, sw } satisfies ShapeSpec)
      })
      await refreshBoardItems(boardIdRef.current)
      return
    }
    if (d.kind === 'line' || d.kind === 'arrow') {
      if (w < 2 && h < 2) return
      const nw = Math.max(1, w)
      const nh = Math.max(1, h)
      const spec: ShapeSpec = {
        kind: d.kind,
        points: [
          [(d.startX - x) / nw, (d.startY - y) / nh],
          [(d.curX - x) / nw, (d.curY - y) / nh]
        ],
        color,
        sw
      }
      pushHistory()
      await window.api.addBoardItem(boardIdRef.current, {
        type: 'shape',
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(2, Math.round(w)),
        height: Math.max(2, Math.round(h)),
        shape: JSON.stringify(spec)
      })
      await refreshBoardItems(boardIdRef.current)
      return
    }
    // 矩形 / 椭圆
    if (w < 3 && h < 3) return
    pushHistory()
    await window.api.addBoardItem(boardIdRef.current, {
      type: 'shape',
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
      shape: JSON.stringify({ kind: d.kind, points: [], color, sw } satisfies ShapeSpec)
    })
    await refreshBoardItems(boardIdRef.current)
  }

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
    if (e.button !== 0) return
    const t = toolRef.current
    if (t !== 'select') {
      // 绘图工具模式：空白处按下即开始绘制（note 工具落点即建便签）
      e.preventDefault()
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* 合成事件忽略 */
      }
      setCtxMenu(null)
      setGuideMenu(null)
      const pt = canvasPointFromClient(e.clientX, e.clientY)
      if (t === 'note') {
        void addNoteAt(pt.x, pt.y)
        return
      }
      drawingRef.current = { kind: t, startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y, points: [[pt.x, pt.y]] }
      setDrawPreview({ kind: t, x: pt.x, y: pt.y, w: 1, h: 1, points: [[0, 0]], color: shapeStyleRef.current.color, sw: shapeStyleRef.current.sw })
      return
    }
    // 空白处按下：开始框选（Shift=追加模式）
    const pt = canvasPointFromClient(e.clientX, e.clientY)
    marqueeRef.current = { startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y, additive: e.shiftKey, moved: false }
    setCtxMenu(null)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current
    if (p) {
      const next = { ...viewportRef.current, x: p.vx + (e.clientX - p.startX), y: p.vy + (e.clientY - p.startY) }
      viewportRef.current = next
      if (surfaceRef.current) {
        surfaceRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.s})`
      }
      return
    }
    const d = drawingRef.current
    if (d) {
      const pt = canvasPointFromClient(e.clientX, e.clientY)
      d.curX = pt.x
      d.curY = pt.y
      if (d.kind === 'pen') {
        const last = d.points[d.points.length - 1]
        if (Math.hypot(pt.x - last[0], pt.y - last[1]) >= 2) d.points.push([pt.x, pt.y])
      }
      updateDrawPreview(d)
      return
    }
    const m = marqueeRef.current
    if (m) {
      const pt = canvasPointFromClient(e.clientX, e.clientY)
      m.curX = pt.x
      m.curY = pt.y
      if (Math.abs(pt.x - m.startX) > MARQUEE_THRESHOLD || Math.abs(pt.y - m.startY) > MARQUEE_THRESHOLD) {
        m.moved = true
        const r = marqueeRect()
        if (r) setMarquee({ ...r })
      }
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    panRef.current = null
    setPanning(false)
    // 绘图工具：提交形状
    if (drawingRef.current) {
      void commitDrawing()
      return
    }
    // 空白处双击（快速点击两次）→ 适配全部内容
    const m = marqueeRef.current
    if (m && !m.moved && toolRef.current === 'select') {
      const now = Date.now()
      const last = lastEmptyClickRef.current
      if (last && now - last.t < 350 && Math.abs(last.x - m.startX) < 8 && Math.abs(last.y - m.startY) < 8) {
        void fitContent()
      }
      lastEmptyClickRef.current = { x: m.startX, y: m.startY, t: now }
    }
    finishMarquee()
  }

  /* ---------- 多窗口同步：窗口获得焦点时刷新（浮动窗与主窗互相看到对方改动） ---------- */
  useEffect(() => {
    const onFocus = () => {
      if (activeBoardId != null) {
        void refreshBoardItems(activeBoardId)
        void refreshBoards()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [activeBoardId, refreshBoardItems, refreshBoards])

  /* ---------- 键盘（空格平移 / Delete 删除选中 / Ctrl+A 全选 / Esc 取消） ---------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inInput = !!target && typeof target.closest === 'function' && !!target.closest('input, textarea')
      if (e.key === ' ' && !inInput) {
        spaceDownRef.current = true
        setSpaceDown(true)
        e.preventDefault()
      }
      // 绘图进行中：Esc 取消
      if (e.key === 'Escape') {
        if (drawingRef.current) {
          drawingRef.current = null
          setDrawPreview(null)
          return
        }
        setCtxMenu(null)
        setGuideMenu(null)
        setSel([])
        return
      }
      if (inInput) return
      const key = e.key.toLowerCase()
      if (e.key === 'Delete' && selectedIdsRef.current.length > 0) {
        const ids = [...selectedIdsRef.current]
        pushHistory()
        setSel([])
        for (const id of ids) void window.api.deleteBoardItem(id)
        if (boardId != null) void refreshBoardItems(boardId)
        return
      }
      if ((e.ctrlKey || e.metaKey) && key === 'a') {
        e.preventDefault()
        setSel(boardItemsRef.current.map((i) => i.id))
        return
      }
      if (e.ctrlKey || e.metaKey) {
        if (key === 'c') {
          e.preventDefault()
          copySelection()
          return
        }
        if (key === 'v') {
          e.preventDefault()
          void pasteClipboard()
          return
        }
        if (key === 'd') {
          e.preventDefault()
          void duplicateSelection()
          return
        }
        if (key === 'z') {
          e.preventDefault()
          if (e.shiftKey) void redo()
          else void undo()
          return
        }
        if (key === 'y') {
          e.preventDefault()
          void redo()
          return
        }
        return
      }
      // 缩放快捷键（以画布中心为锚点）
      if (key === '+' || key === '=') {
        e.preventDefault()
        zoomBy(1.25)
        return
      }
      if (key === '-') {
        e.preventDefault()
        zoomBy(0.8)
        return
      }
      if (key === '0') {
        e.preventDefault()
        applyViewport({ s: 1, x: 0, y: 0 })
        return
      }
      if (key === 'f') {
        e.preventDefault()
        fitContent()
        return
      }
      // 方向键微调（Shift=10px）
      if (e.key.startsWith('Arrow') && selectedIdsRef.current.length > 0) {
        e.preventDefault()
        startNudge()
        const step = e.shiftKey ? 10 : 1
        if (e.key === 'ArrowLeft') applyNudge(-step, 0)
        else if (e.key === 'ArrowRight') applyNudge(step, 0)
        else if (e.key === 'ArrowUp') applyNudge(0, -step)
        else if (e.key === 'ArrowDown') applyNudge(0, step)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceDownRef.current = false
        setSpaceDown(false)
      }
      if (e.key.startsWith('Arrow')) void flushNudge()
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

  /* ---------- 元素拖动 / 组移动 / 8 向缩放 / 组缩放 ---------- */
  const onItemPointerDown = (e: React.PointerEvent, item: BoardItem, mode: 'move' | 'resize', dir?: ResizeDir) => {
    if (e.button !== 0) return
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件忽略 */
    }
    setCtxMenu(null)
    // Shift 点击：切换选中（命中则并入组拖动,未命中则不拖动）
    if (e.shiftKey) {
      const cur = selectedIdsRef.current
      const on = cur.includes(item.id)
      const next = on ? cur.filter((x) => x !== item.id) : [...cur, item.id]
      setSel(next)
      if (!on) {
        // 刚加入选中：整组拖动
        startDrag(next, item, mode, dir, e)
      }
      return
    }
    // 非 Shift：点击已选中元素 = 组拖动;点击未选中元素 = 单选后拖动
    if (isSelected(item.id)) {
      startDrag(selectedIdsRef.current, item, mode, dir, e)
    } else {
      setSel([item.id])
      startDrag([item.id], item, mode, dir, e)
    }
  }

  const startDrag = (
    ids: string[],
    item: BoardItem,
    mode: 'move' | 'resize',
    dir: ResizeDir | undefined,
    e: React.PointerEvent
  ) => {
    const origs = new Map<string, Rect>()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const it of boardItemsRef.current) {
      if (!ids.includes(it.id)) continue
      const h = effHeight(it)
      const r = { x: it.x, y: it.y, w: it.width, h }
      origs.set(it.id, r)
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.w)
      maxY = Math.max(maxY, r.y + r.h)
    }
    if (origs.size === 0) return
    dragRef.current = {
      ids,
      mode,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      origs,
      bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    // 拖动开始即隐藏组包围盒（松手后恢复）
    if (groupBoxRef.current) groupBoxRef.current.style.display = 'none'
  }

  /** 把拖动结果应用到各元素 DOM（不触发 React 渲染） */
  const applyDragToDom = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.startX) / viewportRef.current.s
    const dy = (e.clientY - d.startY) / viewportRef.current.s
    if (d.mode === 'move') {
      for (const id of d.ids) {
        const o = d.origs.get(id)
        const el = itemEls.current.get(id)
        if (o && el) {
          el.style.left = `${o.x + dx}px`
          el.style.top = `${o.y + dy}px`
        }
      }
      return
    }
    // 8 向缩放（组缩放 = 包围盒缩放后按比例映射每个元素）
    const dir = d.dir ?? 'se'
    const b = d.bbox
    let { x, y, w, h } = { x: b.x, y: b.y, w: b.w, h: b.h }
    if (dir.includes('e')) w = Math.max(MIN_SIZE, b.w + dx)
    if (dir.includes('s')) h = Math.max(MIN_SIZE, b.h + dy)
    if (dir.includes('w')) {
      const nw = Math.max(MIN_SIZE, b.w - dx)
      x = b.x + (b.w - nw)
      w = nw
    }
    if (dir.includes('n')) {
      const nh = Math.max(MIN_SIZE, b.h - dy)
      y = b.y + (b.h - nh)
      h = nh
    }
    const sx = b.w > 0 ? w / b.w : 1
    const sy = b.h > 0 ? h / b.h : 1
    for (const id of d.ids) {
      const o = d.origs.get(id)
      const el = itemEls.current.get(id)
      if (o && el) {
        el.style.left = `${x + (o.x - b.x) * sx}px`
        el.style.top = `${y + (o.y - b.y) * sy}px`
        el.style.width = `${Math.max(16, o.w * sx)}px`
        el.style.height = `${Math.max(16, o.h * sy)}px`
      }
    }
    // 组包围盒实时跟随
    if (groupBoxRef.current) {
      groupBoxRef.current.style.left = `${x}px`
      groupBoxRef.current.style.top = `${y}px`
      groupBoxRef.current.style.width = `${w}px`
      groupBoxRef.current.style.height = `${h}px`
    }
  }

  const onItemPointerMove = (e: React.PointerEvent) => {
    applyDragToDom(e)
  }

  const onItemPointerUp = async (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (groupBoxRef.current) groupBoxRef.current.style.display = 'flex'
    // 移动/缩放前入栈（此时 store 还是拖动前状态）
    pushHistory()
    const dx = (e.clientX - d.startX) / viewportRef.current.s
    const dy = (e.clientY - d.startY) / viewportRef.current.s
    const updates: { id: string; patch: Partial<BoardItem> }[] = []
    if (d.mode === 'move') {
      for (const id of d.ids) {
        const o = d.origs.get(id)
        if (o) updates.push({ id, patch: { x: Math.round(o.x + dx), y: Math.round(o.y + dy) } })
      }
    } else {
      const dir = d.dir ?? 'se'
      const b = d.bbox
      let { x, y, w, h } = { x: b.x, y: b.y, w: b.w, h: b.h }
      if (dir.includes('e')) w = Math.max(MIN_SIZE, b.w + dx)
      if (dir.includes('s')) h = Math.max(MIN_SIZE, b.h + dy)
      if (dir.includes('w')) {
        const nw = Math.max(MIN_SIZE, b.w - dx)
        x = b.x + (b.w - nw)
        w = nw
      }
      if (dir.includes('n')) {
        const nh = Math.max(MIN_SIZE, b.h - dy)
        y = b.y + (b.h - nh)
        h = nh
      }
      const sx = b.w > 0 ? w / b.w : 1
      const sy = b.h > 0 ? h / b.h : 1
      for (const id of d.ids) {
        const o = d.origs.get(id)
        if (!o) continue
        const nw = Math.max(16, o.w * sx)
        const nh = Math.max(16, o.h * sy)
        updates.push({
          id,
          patch: { x: Math.round(x + (o.x - b.x) * sx), y: Math.round(y + (o.y - b.y) * sy), width: Math.round(nw), height: Math.round(nh) }
        })
      }
    }
    if (updates.length > 0) await window.api.updateBoardItems(updates)
    if (boardId != null) await refreshBoardItems(boardId)
  }

  /** 点击元素置顶 + 选中（多选状态下点击选中元素保持组选中） */
  const onItemClick = async (item: BoardItem) => {
    if (boardId != null) {
      pushHistory()
      await window.api.bringBoardItemToFront(item.id, boardId)
      await refreshBoardItems(boardId)
    }
  }

  /* ---------- 右键菜单 ---------- */
  const openCtxMenu = (e: React.MouseEvent, item: BoardItem | null) => {
    e.preventDefault()
    e.stopPropagation()
    // 右键未选中元素：单选它;右键已选中元素：保持组选中（菜单作用于组）
    if (item && !isSelected(item.id)) setSel([item.id])
    setCtxMenu({ x: e.clientX, y: e.clientY, itemId: item?.id ?? null })
  }
  /** 菜单作用对象：多选时作用于选中组,否则单元素/全部素材 */
  const ctxTarget = (): BoardItem[] => {
    const ids = selectedIdsRef.current
    if (ids.length > 1) return boardItemsRef.current.filter((i) => ids.includes(i.id))
    if (ctxMenu?.itemId) return boardItemsRef.current.filter((i) => i.id === ctxMenu.itemId)
    return []
  }
  const removeCtxItem = async () => {
    const target = ctxTarget()
    if (target.length > 0) {
      pushHistory()
      for (const it of target) await window.api.deleteBoardItem(it.id)
      setSel([])
      if (boardId != null) await refreshBoardItems(boardId)
    }
    setCtxMenu(null)
  }
  const addNoteFromMenu = async () => {
    if (boardId == null) return
    const pt = canvasPointFromClient(ctxMenu?.x ?? 0, ctxMenu?.y ?? 0)
    pushHistory()
    await window.api.addBoardItem(boardId, { type: 'note', x: Math.round(pt.x), y: Math.round(pt.y), width: 200, height: 60, text: '' })
    await refreshBoardItems(boardId)
    setCtxMenu(null)
  }
  const arrangeCtx = async (mode: 'grid' | 'row' | 'column') => {
    if (boardId == null) return
    const selected = ctxTarget()
    const target =
      selected.length > 0
        ? selected
        : boardItemsRef.current.filter((i) => i.type === 'asset') // 空白右键:排列全部素材
    pushHistory()
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
    const target = ctxTarget()
    if (target.length === 0) return
    pushHistory()
    const updates = target.map((it) => ({ id: it.id, patch }))
    await window.api.updateBoardItems(updates)
    if (boardId != null) await refreshBoardItems(boardId)
    setCtxMenu(null)
  }
  /** 批量设置透明度（对标 PureRef 参考图透明度对比） */
  const setOpacityCtx = async (opacity: number) => {
    const target = ctxTarget()
    if (target.length === 0) return
    pushHistory()
    const updates = target.map((it) => ({ id: it.id, patch: { opacity } }))
    await window.api.updateBoardItems(updates)
    if (boardId != null) await refreshBoardItems(boardId)
  }
  /** 批量设置形状样式（颜色/线宽）,并记忆为新绘制默认 */
  const setShapeStyleCtx = async (patch: { color?: string; sw?: number }) => {
    const target = ctxTarget()
    if (target.length === 0) return
    pushHistory()
    const updates = target
      .map((it) => {
        let shape: ShapeSpec | null = null
        try {
          shape = it.shape ? (JSON.parse(it.shape) as ShapeSpec) : null
        } catch {
          shape = null
        }
        if (!shape) return null
        const next: ShapeSpec = { ...shape, ...patch }
        return { id: it.id, patch: { shape: JSON.stringify(next) } }
      })
      .filter((u): u is { id: string; patch: { shape: string } } => u != null)
    if (updates.length > 0) {
      await window.api.updateBoardItems(updates as { id: string; patch: Partial<BoardItem> }[])
      if (boardId != null) await refreshBoardItems(boardId)
    }
    // 记忆为新绘制默认样式
    if (patch.color) shapeStyleRef.current.color = patch.color
    if (patch.sw) shapeStyleRef.current.sw = patch.sw
  }
  /** 复制选中（含多选）到剪贴板缓冲 + 关闭菜单 */
  const copyCtx = () => {
    copySelection()
    setCtxMenu(null)
  }
  const pasteCtx = () => {
    setCtxMenu(null)
    void pasteClipboard()
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
  const ctxIsShape = ctxItem?.type === 'shape'
  const ctxShapeSpec: ShapeSpec | null = ctxIsShape && ctxItem?.shape ? (() => { try { return JSON.parse(ctxItem.shape) as ShapeSpec } catch { return null } })() : null
  const multiSelected = selectedIds.length > 1

  return (
    <div
      ref={frameRef}
      data-board-frame
      className="relative min-h-0 flex-1 overflow-hidden"
      style={{
        backgroundColor: bgColor,
        cursor: panning ? 'grabbing' : spaceDown ? 'grab' : marquee ? 'crosshair' : tool !== 'select' ? 'crosshair' : 'default'
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={(e) => openCtxMenu(e, null)}
    >
      {/* 点阵背景（画布外观：开关 + 密度 + 颜色随背景亮度自适应） */}
      {appearance.grid && (
        <div
          data-grid
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(circle, ${gridDotColor} 1px, transparent 1px)`,
            backgroundSize: `${appearance.gridSize}px ${appearance.gridSize}px`,
            transform: `translate(${viewport.x % appearance.gridSize}px, ${viewport.y % appearance.gridSize}px)`
          }}
        />
      )}
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
          const sel = isSelected(item.id)
          return (
            <div
              key={item.id}
              ref={(el) => {
                if (el) itemEls.current.set(item.id, el)
                else itemEls.current.delete(item.id)
              }}
              data-board-item={item.id}
              className="absolute select-none"
              style={{
                left: item.x,
                top: item.y,
                width: item.width,
                height: item.type === 'asset' ? autoH : item.height,
                zIndex: item.z,
                outline: sel ? '2px solid var(--accent)' : '1px solid rgba(128,128,128,0.35)',
                outlineOffset: sel ? 1 : 0,
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
                    style={{ opacity: (item.opacity ?? 100) / 100 }}
                    muted
                    playsInline
                  />
                ) : (
                  <img
                    src={assetThumbUrl(asset)}
                    className="pointer-events-none h-full w-full object-cover"
                    style={{ opacity: (item.opacity ?? 100) / 100 }}
                    alt={asset.name}
                    draggable={false}
                    onLoad={(e) => onImgLoad(item, e)}
                  />
                )
              ) : item.type === 'shape' && item.shape ? (
                (() => {
                  let shape: ShapeSpec | null = null
                  try {
                    shape = JSON.parse(item.shape) as ShapeSpec
                  } catch {
                    shape = null
                  }
                  if (!shape) return null
                  return (
                    <svg
                      data-shape
                      className="pointer-events-none h-full w-full"
                      viewBox={`0 0 ${Math.max(1, item.width)} ${Math.max(1, item.height)}`}
                      preserveAspectRatio="none"
                      style={{ opacity: (item.opacity ?? 100) / 100 }}
                    >
                      {shapeSvgNodes(shape, Math.max(1, item.width), Math.max(1, item.height))}
                    </svg>
                  )
                })()
              ) : (
                <>
                  {/* note 拖动手柄：文字便签可被拖拽（textarea 区域保留给编辑） */}
                  <div
                    data-note-handle
                    className="absolute inset-x-0 top-0 h-4 cursor-move touch-none"
                    onPointerDown={(e) => onItemPointerDown(e, item, 'move')}
                    onPointerMove={onItemPointerMove}
                    onPointerUp={(e) => void onItemPointerUp(e)}
                  />
                  <textarea
                    aria-label="白板文字"
                    className="h-full w-full resize-none bg-transparent p-1.5 pt-5 text-[13px] outline-none"
                    style={{ fontFamily: item.noteFont || undefined, color: item.noteColor || 'var(--text-main)', opacity: (item.opacity ?? 100) / 100 }}
                    placeholder="输入文字…"
                    defaultValue={item.text}
                    onBlur={(e) => {
                      if (e.target.value !== item.text) {
                        pushHistory()
                        void window.api.updateBoardItem(item.id, { text: e.target.value })
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                </>
              )}
              {/* 单选时的 8 向缩放手柄（照抄 MOTZ selection-handles） */}
              {sel && !multiSelected && (
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

        {/* 多选时的组包围盒 + 8 向组缩放手柄（照抄 MOTZ group-selection） */}
        {multiSelected && !dragRef.current && selectionBBox && (
          <div
            ref={groupBoxRef}
            data-group-box
            className="pointer-events-none absolute"
            style={{
              left: selectionBBox.x,
              top: selectionBBox.y,
              width: selectionBBox.w,
              height: selectionBBox.h,
              border: '2px solid var(--accent)',
              zIndex: 100000
            }}
          >
            {RESIZE_HANDLES.map((handle) => (
              <span
                key={handle}
                data-group-handle={handle}
                className="pointer-events-auto absolute h-3 w-3 border border-[var(--accent)] bg-[var(--bg-base)]"
                style={{
                  ...(handle.includes('n') ? { top: -6 } : handle.includes('s') ? { bottom: -6 } : { top: '50%', marginTop: -6 }),
                  ...(handle.includes('w') ? { left: -6 } : handle.includes('e') ? { right: -6 } : { left: '50%', marginLeft: -6 }),
                  cursor: `${handle === 'nw' || handle === 'se' ? 'nwse' : handle === 'ne' || handle === 'sw' ? 'nesw' : handle === 'n' || handle === 's' ? 'ns' : 'ew'}-resize`
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  // 组缩放：以包围盒为基准,把首元素作为 mode 载体
                  const first = boardItemsRef.current.find((i) => selectedIdsRef.current.includes(i.id))
                  if (first) onItemPointerDown(e, first, 'resize', handle)
                }}
                onPointerMove={onItemPointerMove}
                onPointerUp={(e) => void onItemPointerUp(e)}
              />
            ))}
          </div>
        )}

        {/* 绘图工具实时预览（rect/ellipse/line/arrow/pen 用同一套形状渲染） */}
        {drawPreview && (
          <svg
            data-draw-preview
            className="pointer-events-none absolute"
            style={{ left: drawPreview.x, top: drawPreview.y, width: drawPreview.w, height: drawPreview.h, zIndex: 40000 }}
            viewBox={`0 0 ${drawPreview.w} ${drawPreview.h}`}
            preserveAspectRatio="none"
          >
            {drawPreview.kind === 'pen' ? (
              <polyline
                points={drawPreview.points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke={drawPreview.color}
                strokeWidth={drawPreview.sw}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              shapeSvgNodes(
                { kind: drawPreview.kind, points: drawPreview.points as unknown as number[][], color: drawPreview.color, sw: drawPreview.sw },
                drawPreview.w,
                drawPreview.h
              )
            )}
          </svg>
        )}

        {/* 参考线（对标 PureRef 参考辅助）：可拖动、右键删除 */}
        {guides.map((g, i) =>
          g.horizontal ? (
            <div
              key={`guide-h-${i}`}
              data-guide="h"
              data-guide-index={i}
              className="absolute cursor-ns-resize"
              style={{ left: -10000, top: g.y ?? 0, width: 20000, height: 0, borderTop: '1px dashed rgba(90,160,255,0.55)', zIndex: 50000 }}
              onPointerDown={(e) => startGuideDrag(i, g, e)}
              onPointerMove={onGuidePointerMove}
              onPointerUp={(e) => void onGuidePointerUp(e)}
              onContextMenu={(e) => openGuideMenu(e, i)}
            />
          ) : (
            <div
              key={`guide-v-${i}`}
              data-guide="v"
              data-guide-index={i}
              className="absolute cursor-ew-resize"
              style={{ top: -10000, left: g.x ?? 0, height: 20000, width: 0, borderLeft: '1px dashed rgba(90,160,255,0.55)', zIndex: 50000 }}
              onPointerDown={(e) => startGuideDrag(i, g, e)}
              onPointerMove={onGuidePointerMove}
              onPointerUp={(e) => void onGuidePointerUp(e)}
              onContextMenu={(e) => openGuideMenu(e, i)}
            />
          )
        )}

      </div>

      {/* 空态必须留在屏幕坐标层，不能跟随持久化的画布 viewport 偏移。 */}
      {boardItems.length === 0 && (
        <div className="archive-board-empty pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <span className="archive-board-empty__eyebrow mono">{pixel ? 'NODE CANVAS / EMPTY' : 'LIGHT TABLE / EMPTY'}</span>
          <strong>{pixel ? '把素材接入视觉节点' : '把参考素材送上看片台'}</strong>
          <p>从左侧素材卡片发送或拖拽素材到这里，也可以右键添加文字并使用上方工具标注。</p>
          <small className="mono">F 适配 · 0 复位 · ± 缩放 · 方向键微调 · CTRL+D 复制</small>
        </div>
      )}

      {/* 框选矩形 */}
      {marquee && (
        <div
          data-marquee
          className="pointer-events-none absolute"
          style={{
            left: marquee.x * viewport.s + viewport.x,
            top: marquee.y * viewport.s + viewport.y,
            width: marquee.w * viewport.s,
            height: marquee.h * viewport.s,
            background: 'rgba(90,160,255,0.10)',
            border: '1px solid rgba(90,160,255,0.8)',
            zIndex: 100001
          }}
        />
      )}

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
                {multiSelected ? `从白板移除（${selectedIds.length} 项）` : '从白板移除'}
              </button>
              <button
                className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => copyCtx()}
              >
                <Icon name="copy" size={12} />
                {multiSelected ? `复制（${selectedIds.length} 项）` : '复制'}
              </button>
              <div className="my-1 border-t border-[var(--border)]" />
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
              {/* 形状样式（颜色/线宽,多选时批量应用;新绘制沿用所选样式） */}
              {ctxIsShape && (
                <div className="border-t border-[var(--border)] px-3 py-2">
                  <div className="mb-1 text-[10px] text-[var(--text-faint)]">描边颜色</div>
                  <div className="flex items-center gap-1">
                    {SHAPE_COLORS.map((c) => (
                      <button
                        key={c}
                        aria-label={`形状颜色 ${c}`}
                        className={`h-4 w-4 rounded-full border transition-transform duration-100 hover:scale-110 ${
                          ctxShapeSpec?.color === c ? 'ring-2 ring-white/60' : 'border-white/20'
                        }`}
                        style={{ background: c }}
                        onClick={() => void setShapeStyleCtx({ color: c })}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="自定义形状颜色"
                      className="h-4 w-4 cursor-pointer border-none bg-transparent p-0"
                      value={ctxShapeSpec?.color ?? '#5aa0ff'}
                      onChange={(e) => void setShapeStyleCtx({ color: e.target.value })}
                    />
                  </div>
                  <div className="mb-1 mt-2 text-[10px] text-[var(--text-faint)]">线宽</div>
                  <div className="flex items-center gap-1">
                    {SHAPE_WIDTHS.map((w) => (
                      <button
                        key={w}
                        aria-label={`线宽 ${w}`}
                        className={`h-4 flex-1 rounded-sm border text-[10px] leading-none transition-colors duration-100 ${
                          ctxShapeSpec?.sw === w
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                            : 'border-[var(--border)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]'
                        }`}
                        onClick={() => void setShapeStyleCtx({ sw: w })}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* 透明度（对标 PureRef 参考图透明度对比,多选时批量应用） */}
              {ctxItem && (
                <div className="border-t border-[var(--border)] px-3 py-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--text-faint)]">
                    <span>透明度</span>
                    <span className="mono">{ctxItem.opacity ?? 100}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {[100, 75, 50, 25].map((p) => (
                      <button
                        key={p}
                        aria-label={`透明度 ${p}%`}
                        className={`h-4 flex-1 rounded-sm border text-[10px] leading-none transition-colors duration-100 ${
                          ctxItem.opacity === p
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                            : 'border-[var(--border)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]'
                        }`}
                        onClick={() => void setOpacityCtx(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="透明度滑块"
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={ctxItem.opacity ?? 100}
                    onChange={(e) => void setOpacityCtx(Number(e.target.value))}
                    className="mt-1 w-full accent-[var(--accent)]"
                  />
                </div>
              )}
              <div className="my-1 border-t border-[var(--border)]" />
            </>
          ) : (
            <>
              <button
                className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => void addNoteFromMenu()}
              >
                <Icon name="type" size={12} />
                添加文本
              </button>
              {clipboardRef.current.length > 0 && (
                <button
                  className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                  onClick={() => pasteCtx()}
                >
                  <Icon name="copy" size={12} />
                  粘贴
                </button>
              )}
              <button
                className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  setCtxMenu(null)
                  fitContent()
                }}
              >
                <Icon name="fit" size={12} />
                适配全部内容
              </button>
              <div className="my-1 border-t border-[var(--border)]" />
              <button
                className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => void addGuideFromMenu(false)}
              >
                添加垂直参考线
              </button>
              <button
                className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => void addGuideFromMenu(true)}
              >
                添加水平参考线
              </button>
            </>
          )}
          <button className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]" onClick={() => void arrangeCtx('grid')}>
            网格排列{multiSelected ? '选中' : ctxItem ? '选中' : ''}
          </button>
          <button className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]" onClick={() => void arrangeCtx('row')}>
            横向排列{multiSelected ? '选中' : ctxItem ? '选中' : ''}
          </button>
          <button className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]" onClick={() => void arrangeCtx('column')}>
            纵向排列{multiSelected ? '选中' : ctxItem ? '选中' : ''}
          </button>
        </div>
      )}

      {/* 参考线右键菜单 */}
      {guideMenu && (
        <div
          className="menu fixed z-[300] w-36 py-1"
          style={{ left: Math.min(guideMenu.x, window.innerWidth - 160), top: Math.min(guideMenu.y, window.innerHeight - 90) }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] text-[var(--danger)] hover:bg-[var(--bg-hover)]"
            onClick={() => void deleteGuide()}
          >
            删除参考线
          </button>
        </div>
      )}
    </div>
  )
}
