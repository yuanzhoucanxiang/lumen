import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { assetThumbUrl, useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import { useTheme } from '../theme'
import type { Asset, BoardItem, BoardItemPatch, NewBoardItem, ShapeSpec } from '@shared/types'

const ASSET_MIME = 'application/x-eaglelike-assets'

/** 白板工具模式 */
export type BoardTool = 'select' | 'pen' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'note'

interface Viewport {
  s: number // zoom
  x: number // translate x (px)
  y: number // translate y (px)
}

/** 解析白板已保存视口 JSON(boards.viewport),缺失/非法返回 null(用默认视口) */
function parseBoardViewport(json: string): Viewport | null {
  try {
    const p = JSON.parse(json) as { s?: number; x?: number; y?: number }
    if (typeof p.s === 'number' && typeof p.x === 'number' && typeof p.y === 'number') {
      return { s: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.s)), x: p.x, y: p.y }
    }
  } catch {
    /* ignore */
  }
  return null
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const MIN_SIZE = 40
/** 素材上板初始尺寸:按原比例入板(长边取原像素尺寸、封顶 1280,不放大)。
 *  旧版封顶 280px 太小,大图一进来就是小缩略图,需放大才清晰(对标 PureRef 原尺寸入板)。 */
const BOARD_DROP_LONG_EDGE = 1280
/** 原图切换(方案 B 像素级判据,对标 PureRef):缩略图长边上限 512px(与主进程生成一致),
 *  素材渲染尺寸超过它(= 缩略图被放大)就切原图,否则缩略图足够清晰。
 *  旧版用整体缩放阈值(≥1.25 才开),100% 缩放下的大图仍是放大的缩略图,必须放大才清晰;
 *  逐项滞回防抖动:渲染长边 >512 开原图、< ~358 切回缩略图(控制大图显存)。 */
const ORIG_PX_UP = 512
const ORIG_PX_DOWN = 512 * 0.7
/**
 * 同时挂原图的数量上限。判据只看「屏幕上被放大」，于是缩小视图下几百个元素
 * 一起够格 → 几百张原图解码 + 显存直接顶穿。超了按屏幕尺寸排序取前 N，
 * 反正越大的原图越需要那点对比度，小图用缩略图肉眼无差。
 */
const ORIG_MAX = 32
/** 白板可直接用浏览器解码的扩展名(heic/psd/ai 等无浏览器原图,仍用缩略图) */
const BOARD_ORIG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'tiff', 'tif', 'svg'])
/** 框选拖拽超过该距离(画布坐标 px)才视为框选而非点击 */
const MARQUEE_THRESHOLD = 3
/** 智能吸附容差（屏幕像素，除以缩放换算到画布坐标）：对标 Figma/PureRef 的对齐磁吸 */
const SNAP_TOL = 6
/** 形状描边默认样式（新绘制时使用,右键改样式后记忆） */
const DEFAULT_SHAPE_STYLE = { color: '#5aa0ff', sw: 2.5 }
/** 形状可选颜色 */
const SHAPE_COLORS = ['#5aa0ff', '#ff6b6b', '#ffd166', '#4ade80', '#c792ea', '#e8eef7']
/** 形状可选线宽 */
const SHAPE_WIDTHS = [1.5, 2.5, 4, 6, 8]
/** 画布外观预设（bg 键 → 颜色）。导出给 BoardPanel 色板共用,两处不许再各自维护 */
export const APPEARANCE_PRESETS: Record<string, string> = {
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

/** 素材元素屏幕渲染尺寸小于该值(px)时降级为色块占位:
 *  超大规模白板缩小视图时,数千张缩略图的解码/绘制是主要瓶颈,
 *  色块只占一个 div 无解码开销(对标"视口降级",见项目策划案进行中项)。 */
const DEGRADE_PX = 22

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

/** 收敛为有限数值（白板元素字段可能源于导入的 .lumenboard，防 SVG 属性逃逸；null/undefined 回退默认） */
function toFiniteNum(v: unknown, fallback: number): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** PNG 导出笔记 clipPath 的自增序号（同屏多次导出防 id 冲突） */
let clipSeq = 0

/** 画布背景白名单：仅预设键或 #hex，其余回退 dark（bg 源于可导入的 .lumenboard） */
function resolveBgColor(bg: string): string {
  if (APPEARANCE_PRESETS[bg]) return APPEARANCE_PRESETS[bg]
  return /^#[0-9a-f]{3,8}$/i.test(bg) ? bg : APPEARANCE_PRESETS.dark
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
const NOTE_SIZES = [12, 16, 20, 28, 36, 48]
type NoteStylePatch = { noteFont?: string; noteColor?: string; noteFontSize?: number }

export interface BoardCanvasApi {
  zoomTo: (s: number) => void
  resetView: () => void
  fitContent: () => void
  /** 生成画布场景 SVG（图片内嵌 base64） */
  exportSvg: () => Promise<string>
  /** SVG → PNG dataUrl（scale 倍超采样，默认 2） */
  exportPng: (scale?: number) => Promise<string>
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
 * - 元素：图片/视频/文字/矢量形状；拖动/8 向手柄缩放/Shift 等比缩放/Delete 删除/点击置顶
 * - 拖动智能吸附到邻近元素边·中心与手动参考线（Alt 临时关闭）
 * - 锁定（不可拖动/缩放/删除，仍可选中以便解锁）与成组（组内一起选中、一起变换）
 * - 右键：对齐六向 / 图层置顶·置底·上下移一层 / 成组解组 / 锁定 / 透明度 / 翻转 / 排列分布
 * - 绘图工具：手绘/箭头/直线/矩形/椭圆/文字（tool prop 控制）
 * - 快捷键：Ctrl+Z/Y 撤销重做 / Ctrl+C/V/D 复制粘贴 / Ctrl+G·Shift+G 成组解组 / Ctrl+L 锁定
 *   / Ctrl+] 与 [ 图层移动（Shift 为置顶置底）/ 方向键微调 / 0 复位 / ± 缩放 / F 适配
 * - 双击空白适配全部内容；画布外观（背景色/网格）按白板持久化
 * - onApiReady 暴露缩放/适配/导出/工具控制给工具栏
 */
export default function BoardCanvas({
  onApiReady,
  tool = 'select',
  onViewportChange,
  onToolChange,
  onHistoryChange
}: {
  onApiReady?: (api: BoardCanvasApi) => void
  tool?: BoardTool
  onViewportChange?: (s: number) => void
  onToolChange?: (tool: BoardTool) => void
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void
}) {
  const theme = useTheme()
  const pixel = theme === 'pixel-glitch'
  const cyber = theme === 'cyber-glitch'
  const boardItems = useLibraryStore((s) => s.boardItems)
  const assets = useLibraryStore((s) => s.assets)
  const boards = useLibraryStore((s) => s.boards)
  const boardViewMode = useLibraryStore((s) => s.boardViewMode)
  const boardViewModeRef = useRef(boardViewMode)
  boardViewModeRef.current = boardViewMode
  const refreshBoardItems = useLibraryStore((s) => s.refreshBoardItems)
  const refreshBoards = useLibraryStore((s) => s.refreshBoards)
  const activeBoardId = useLibraryStore((s) => s.activeBoardId)
  /**
   * 白板素材缓存独立于左侧参考来源。切换文件夹会替换 store.assets，
   * 但已放上画布的素材必须继续显示与导出。
   */
  const [boardAssetCache, setBoardAssetCache] = useState<Record<string, Asset>>({})
  const boardAssetCacheRef = useRef(boardAssetCache)
  boardAssetCacheRef.current = boardAssetCache
  const assetById = useMemo(() => {
    const merged = new Map<string, Asset>(Object.entries(boardAssetCache))
    for (const asset of assets) merged.set(asset.id, asset)
    return merged
  }, [assets, boardAssetCache])

  useEffect(() => {
    const visible = new Set(assets.map((asset) => asset.id))
    const missing = Array.from(
      new Set(
        boardItems
          .flatMap((item) => (item.assetId ? [item.assetId] : []))
          .filter((id) => !visible.has(id) && !boardAssetCacheRef.current[id])
      )
    )
    if (missing.length === 0) return
    let cancelled = false
    // 单个素材已被删除时 getAsset 会 reject：逐个 catch,不让一个坏 id 拖垮整批缓存
    void Promise.all(
      missing.map((id) =>
        window.api.getAsset(id).catch(() => null)
      )
    ).then((found) => {
      if (cancelled) return
      setBoardAssetCache((current) => {
        const next = { ...current }
        for (const asset of found) if (asset) next[asset.id] = asset
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [assets, boardItems])

  const [viewport, setViewport] = useState<Viewport>({ s: 1, x: 0, y: 0 })
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const surfaceRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [panning, setPanning] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const spaceDownRef = useRef(false)
  const panRef = useRef<{ startX: number; startY: number; vx: number; vy: number; moved: boolean } | null>(null)
  const suppressItemClickUntilRef = useRef(0)

  /* ---------- 原图/缩略图切换(方案 B,逐项像素判据)----------
     素材渲染长边超过缩略图分辨率才换原图(淡入覆盖,像素级清晰),否则缩略图足够;
     逐项滞回防抖动,切回缩略图控制大图显存。 */
  const [origItems, setOrigItems] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    setOrigItems((prev) => {
      // 收集时带上屏幕尺寸：超过上限就按「屏幕上更大」的优先给原图
      const want: { id: string; px: number }[] = []
      for (const it of boardItems) {
        if (it.type !== 'asset' || !it.assetId) continue
        const h = it.height > 0 ? it.height : it.width * (aspectCacheRef.current[it.assetId] ?? 0.75)
        const rendered = Math.max(it.width, h) * viewport.s
        // 已在原图:缩回阈值以下才切回；不在原图:放大到阈值以上才换（滞回防抖动）
        if (prev.has(it.id) ? rendered > ORIG_PX_DOWN : rendered >= ORIG_PX_UP) want.push({ id: it.id, px: rendered })
      }
      if (want.length > ORIG_MAX) {
        want.sort((a, b) => b.px - a.px)
        want.length = ORIG_MAX
      }
      const next = new Set(want.map((w) => w.id))
      if (next.size !== prev.size) return next
      for (const id of next) if (!prev.has(id)) return next
      return prev
    })
  }, [viewport.s, boardItems])
  /** 已成功加载原图的 assetId(驱动淡入,避免原图未就绪时的空白闪动) */
  const [origLoaded, setOrigLoaded] = useState<Set<string>>(new Set())

  /**
   * 素材/原图缓存按当前白板收敛：两者此前只增不减，来回切几块板就把用不到的
   * Asset 对象与已加载标记一直留在内存里。缺的条目由上面的补查 effect 重新拉，
   * 所以裁剪是安全的；没有东西可裁时保持原对象引用，避免无谓重渲染。
   */
  useEffect(() => {
    const keep = new Set<string>()
    for (const it of boardItems) if (it.assetId) keep.add(it.assetId)
    setBoardAssetCache((cur) => {
      const ids = Object.keys(cur)
      if (ids.length === keep.size && ids.every((id) => keep.has(id))) return cur
      const next: Record<string, Asset> = {}
      for (const id of ids) if (keep.has(id)) next[id] = cur[id]
      return next
    })
    setOrigLoaded((cur) => {
      const gone = Array.from(cur).some((id) => !keep.has(id))
      return gone ? new Set(Array.from(cur).filter((id) => keep.has(id))) : cur
    })
  }, [boardItems])

  /* ---------- 视口状态 ---------- */
  const markOrigLoaded = (id: string): void => {
    setOrigLoaded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }
  /* ---------- 视口裁剪(千元素白板只渲染可见区) ----------
     首帧 frame 未布局,cullRect=null 时先渲染空 surface;
     useLayoutEffect 量帧后二次渲染(paint 前完成,无闪烁),之后裁剪生效。
     余量 = 一个视口尺寸:短平移不露空白;平移过程 rAF 同步裁剪(见 onPointerMove)。 */
  const [frameReady, setFrameReady] = useState(false)
  useLayoutEffect(() => {
    setFrameReady(true)
  }, [])
  /**
   * 帧矩形量测：cullRect（渲染裁剪）与 viewportRect（原图加载）共用同一次
   * getBoundingClientRect——此前每次渲染各量一次，等于每帧两轮强制同步布局。
   */
  const frameMetrics = useMemo(() => {
    const frame = frameRef.current
    if (!frame) return null
    const r = frame.getBoundingClientRect()
    const s = viewport.s
    return { left: -viewport.x / s, top: -viewport.y / s, w: r.width / s, h: r.height / s, margin: Math.max(r.width, r.height) / s }
  }, [viewport, frameReady])
  /** 当前视口对应的画布可见矩形(供"仅视口内元素加载原图"判定) */
  const viewportRect = frameMetrics
    ? { x: frameMetrics.left, y: frameMetrics.top, w: frameMetrics.w, h: frameMetrics.h }
    : { x: -Infinity, y: -Infinity, w: Infinity, h: Infinity }
  const cullRect = useMemo(() => {
    if (!frameReady || !frameMetrics) return null
    const m = frameMetrics
    return { x: m.left - m.margin, y: m.top - m.margin, w: m.w + m.margin * 2, h: m.h + m.margin * 2 }
  }, [frameMetrics, frameReady])

  // 平移期间 rAF 节流同步裁剪(每帧最多一次 setState;窗口失焦时 rAF 不调度,pointerup 兜底)
  const cullSyncPendingRef = useRef(false)
  // 窗口尺寸变化时强制一次渲染,重算裁剪矩形
  useEffect(() => {
    const onResize = () => setViewport((v) => ({ ...v }))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
  const bgColor = resolveBgColor(appearance.bg)
  const gridDotColor = hexLuminance(bgColor) > 0.6 ? 'rgba(60,60,60,0.22)' : 'rgba(255,255,255,0.14)'
  // ref 镜像：导出 SVG 等异步回调避免闭包过期
  const appearanceRef = useRef(appearance)
  appearanceRef.current = appearance
  // 点阵背景 DOM（平移时直改,不逐帧走 React state——否则点阵要等松手才跟上）
  const gridRef = useRef<HTMLDivElement>(null)
  /** 按视口偏移更新点阵背景 transform(取模使网格无限延伸) */
  const applyGridTransform = (v: Viewport) => {
    const gs = appearanceRef.current.gridSize
    if (gridRef.current) gridRef.current.style.transform = `translate(${v.x % gs}px, ${v.y % gs}px)`
  }

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
  // 绘制中途切换工具：取消进行中的笔画（Esc 有取消,换工具此前没有）
  useEffect(() => {
    if (drawingRef.current) {
      drawingRef.current = null
      setDrawPreview(null)
    }
  }, [tool])
  /** 文字对象把编辑态与成品态分开；样式同时作为下一次新建文字的默认值。 */
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteDefaults, setNoteDefaults] = useState<Required<NoteStylePatch>>({ noteFont: '', noteColor: '#e8eef7', noteFontSize: 16 })

  /* ---------- 撤销/重做（按当前白板,切换白板即清空） ---------- */
  const histRef = useRef<{ undo: BoardItem[][]; redo: BoardItem[][] }>({ undo: [], redo: [] })
  const onHistoryChangeRef = useRef(onHistoryChange)
  onHistoryChangeRef.current = onHistoryChange
  /** 历史栈变化时通知工具栏（驱动撤销/重做按钮禁用态） */
  const notifyHistory = () => {
    const h = histRef.current
    onHistoryChangeRef.current?.(h.undo.length > 0, h.redo.length > 0)
  }
  useEffect(() => {
    histRef.current = { undo: [], redo: [] }
    notifyHistory()
  }, [activeBoardId])
  /** 外部添加(参考架/素材库发送)进入撤销历史：store 记录添加前快照,这里消费入栈 */
  useEffect(() => {
    const hint = useLibraryStore.getState().boardHistoryHint
    if (!hint) return
    if (hint.boardId !== activeBoardId) {
      useLibraryStore.setState({ boardHistoryHint: null })
      return
    }
    const h = histRef.current
    h.undo.push(hint.snapshot.map((i) => ({ ...i, shape: i.shape })))
    if (h.undo.length > 60) h.undo.shift()
    h.redo = []
    notifyHistory()
    useLibraryStore.setState({ boardHistoryHint: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardItems, activeBoardId])
  const pushHistory = () => {
    const h = histRef.current
    h.undo.push(boardItemsRef.current.map((i) => ({ ...i, shape: i.shape })))
    if (h.undo.length > 60) h.undo.shift()
    h.redo = []
    notifyHistory()
  }
  /** 快照 diff 应用：删除多余 / 新增缺失 / 更新差异字段 */
  const histBusyRef = useRef(false)
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
      for (const k of ['x', 'y', 'width', 'height', 'z', 'text', 'noteFont', 'noteColor', 'noteFontSize', 'opacity', 'shape', 'flipX', 'flipY'] as const) {
        if (c[k] !== t[k]) patch[k] = t[k] as string | number | null
      }
      if (Object.keys(patch).length > 0) toUpdate.push({ id: t.id, patch })
    }
    // 三类差异各一次批量 IPC（此前逐条 await：撤销一次 = 元素数 × 2 次 IPC 往返）
    if (toDelete.length > 0) await window.api.deleteBoardItems(toDelete)
    if (toAdd.length > 0)
      await window.api.addBoardItems(
        boardIdRef.current,
        toAdd.map((t) => ({
          type: t.type,
          assetId: t.assetId,
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
          text: t.text,
          shape: t.shape,
          opacity: t.opacity ?? 100,
          noteFont: t.noteFont ?? '',
          noteColor: t.noteColor ?? '',
          noteFontSize: t.noteFontSize ?? 16,
          flipX: t.flipX,
          flipY: t.flipY,
          // 快照里的层级原样还原（不给则 addBoardItems 自增到顶层）
          z: t.z
        }))
      )
    if (toUpdate.length > 0) await window.api.updateBoardItems(toUpdate as { id: string; patch: Partial<BoardItem> }[])
    await refreshBoardItems(boardIdRef.current)
  }
  const undo = async () => {
    const h = histRef.current
    if (histBusyRef.current) return
    const prev = h.undo.pop()
    if (!prev) return
    histBusyRef.current = true
    try {
      h.redo.push(useLibraryStore.getState().boardItems.map((i) => ({ ...i, shape: i.shape })))
      await applySnapshot(prev)
    } finally {
      histBusyRef.current = false
      notifyHistory()
    }
  }
  const redo = async () => {
    const h = histRef.current
    if (histBusyRef.current) return
    const next = h.redo.pop()
    if (!next) return
    histBusyRef.current = true
    try {
      h.undo.push(useLibraryStore.getState().boardItems.map((i) => ({ ...i, shape: i.shape })))
      await applySnapshot(next)
    } finally {
      histBusyRef.current = false
      notifyHistory()
    }
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
    // 粘贴与撤销/重做共用 busy 位：快速连按时丢弃后续请求,避免多个 async 交错互相踩踏
    if (histBusyRef.current) return
    histBusyRef.current = true
    try {
      pushHistory()
      await window.api.addBoardItems(
        boardIdRef.current,
        src.map((it) => ({
          type: it.type,
          assetId: it.assetId,
          x: Math.round(it.x + dx),
          y: Math.round(it.y + dy),
          width: it.width,
          height: it.height,
          text: it.text,
          shape: it.shape,
          opacity: it.opacity ?? 100,
          noteFont: it.noteFont ?? '',
          noteColor: it.noteColor ?? '',
          noteFontSize: it.noteFontSize ?? 16,
          // 镜像必须跟着复制走（此前漏传，Ctrl+D 出来的图左右翻回正面）
          flipX: it.flipX,
          flipY: it.flipY
        }))
      )
      await refreshBoardItems(boardIdRef.current)
    } finally {
      histBusyRef.current = false
    }
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
  // 窗口失焦时兜底：微调落库 + 收尾所有进行中的手势（Alt+Tab 后收不到 pointerup/keyup，
  // 否则空格卡死、元素停在中间态永不落库、组包围盒消失）
  useEffect(() => {
    const onBlur = () => {
      void flushNudge()
      spaceDownRef.current = false
      setSpaceDown(false)
      if (panRef.current) {
        panRef.current = null
        setPanning(false)
        applyViewport({ ...viewportRef.current })
      }
      if (drawingRef.current) {
        drawingRef.current = null
        setDrawPreview(null)
      }
      if (marqueeRef.current) finishMarquee()
      const gd = guideDragRef.current
      if (gd) void finishGuideDrag(gd.startX, gd.startY)
      const d = dragRef.current
      if (d) {
        // 元素拖动回滚到原位（与"按下后才按空格转平移"同策略：不落库半途位移）
        for (const id of d.ids) {
          const o = d.origs.get(id)
          const el = itemEls.current.get(id)
          if (o && el) {
            el.style.left = `${o.x}px`
            el.style.top = `${o.y}px`
            el.style.width = `${o.w}px`
            el.style.height = `${o.h}px`
          }
        }
        dragRef.current = null
        if (groupBoxRef.current) groupBoxRef.current.style.display = 'flex'
      }
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      applyGridTransform(next)
      onViewportChange?.(next.s)
    },
    [onViewportChange]
  )

  /* ---------- 选中（多选） ---------- */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdsRef = useRef<string[]>([])
  // 成员判定用 Set:isSelected 每个元素每帧渲染都调用,数组 includes 是 O(n),全选大板时整体 O(n²)
  const selectedSetRef = useRef<Set<string>>(new Set())
  const setSel = (ids: string[]) => {
    selectedIdsRef.current = ids
    selectedSetRef.current = new Set(ids)
    setSelectedIds(ids)
  }
  const isSelected = (id: string) => selectedSetRef.current.has(id)

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
    /** Shift 等比缩放（resize 模式，随 pointermove 实时更新） */
    lockAspect?: boolean
    /** Alt 临时关闭吸附（随 pointermove 更新，松手落库沿用最后一帧的判定） */
    snapOff?: boolean
  } | null>(null)
  // 组包围盒 DOM（缩放时直接改 style）
  const groupBoxRef = useRef<HTMLDivElement>(null)
  /** 吸附线 DOM 池（拖动时直改 style；进 state 会让整棵画布每帧重渲染） */
  const snapLinesRef = useRef<(HTMLDivElement | null)[]>([])

  // 素材宽高比缓存（用于 height=0 时自动计算）
  const [aspectCache, setAspectCache] = useState<Record<string, number>>({})
  const aspectCacheRef = useRef(aspectCache)
  aspectCacheRef.current = aspectCache

  /**
   * 元素 y 轴索引：按上边界升序 + 前缀最大下边界。
   * 有了它，裁剪只需扫描「可能与视口相交」的那一段，而不是每帧把全量元素比一遍。
   */
  const yIndex = useMemo(() => {
    const arr = boardItems.map((it, i) => ({
      y: it.y,
      bottom: it.y + (it.height > 0 ? it.height : it.width * (aspectCache[it.assetId ?? ''] ?? 0.75)),
      i
    }))
    arr.sort((a, b) => a.y - b.y)
    const maxBottom: number[] = new Array(arr.length)
    let m = -Infinity
    arr.forEach((e, k) => {
      m = Math.max(m, e.bottom)
      maxBottom[k] = m
    })
    return { arr, maxBottom }
  }, [boardItems, aspectCache])

  /** 视口内应渲染的元素（含一圈余量；正在编辑的文字豁免——卸载即丢编辑内容） */
  const visibleItems = useMemo(() => {
    if (!cullRect) return boardItems // 首帧未布局：先全渲染，量完帧后下一帧起裁剪生效
    const top = cullRect.y
    const bottom = cullRect.y + cullRect.h
    const left = cullRect.x
    const right = cullRect.x + cullRect.w
    const { arr, maxBottom } = yIndex
    // 下界：跳过整段都在视口上方的元素（maxBottom 单调不减，可二分）
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (maxBottom[mid] <= top) lo = mid + 1
      else hi = mid
    }
    const start = lo
    // 上界：arr 按 y 升序，第一个上边界越过视口下沿的即为终点
    lo = start
    hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid].y <= bottom) lo = mid + 1
      else hi = mid
    }
    const picked: number[] = []
    for (let k = start; k < lo; k++) {
      const idx = arr[k].i
      const it = boardItems[idx]
      if (it.x + it.width > left && it.x < right) picked.push(idx)
    }
    if (editingNoteId) {
      const at = boardItems.findIndex((i) => i.id === editingNoteId)
      if (at >= 0 && !picked.includes(at)) picked.push(at)
    }
    // 数组下标即 z 顺序（listBoardItems 按 z 升序返回），排序保证叠放不被打乱
    picked.sort((a, b) => a - b)
    return picked.map((i) => boardItems[i])
  }, [boardItems, cullRect, yIndex, editingNoteId])

  /* ---------- 右键菜单 ---------- */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; itemId: string | null } | null>(null)
  /** 参考线右键菜单（index 指向 guides 数组） */
  const [guideMenu, setGuideMenu] = useState<{ x: number; y: number; index: number } | null>(null)

  /* ---------- 参考线（对标 PureRef 参考辅助） ---------- */
  interface Guide {
    /** 稳定标识（新建时生成,旧数据缺省时按位置+方向回退） */
    id?: string
    x?: number
    y?: number
    horizontal: boolean
  }
  const [guides, setGuides] = useState<Guide[]>([])
  const guideId = () => 'g' + Math.random().toString(36).slice(2, 8)
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
  // 拖动中的参考线（拖动只改 DOM 不触发 React 渲染,松手落定+持久化）
  const guideDragRef = useRef<{ index: number; horizontal: boolean; startX: number; startY: number; orig: number; el?: HTMLElement | null } | null>(null)
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
    guideDragRef.current = { index, horizontal: g.horizontal, startX: e.clientX, startY: e.clientY, orig: g.horizontal ? g.y ?? 0 : g.x ?? 0, el: e.currentTarget as HTMLElement }
  }
  const onGuidePointerMove = (e: React.PointerEvent) => {
    const d = guideDragRef.current
    if (!d) return
    const delta = (d.horizontal ? e.clientY - d.startY : e.clientX - d.startX) / viewportRef.current.s
    // 拖动中直接改线身 DOM（此前每帧 setGuides 会重渲染整棵画布）
    const pos = Math.round(d.orig + delta)
    if (d.el) {
      if (d.horizontal) d.el.style.top = `${pos}px`
      else d.el.style.left = `${pos}px`
    }
  }
  /** 落定参考线拖动：从 drag 起点重算最终位置（不依赖可能过期的闭包 state）并持久化 */
  const finishGuideDrag = async (clientX: number, clientY: number) => {
    const d = guideDragRef.current
    if (!d) return
    guideDragRef.current = null
    const delta = (d.horizontal ? clientY - d.startY : clientX - d.startX) / viewportRef.current.s
    const next = guidesRef.current.map((g, i) =>
      i === d.index ? (d.horizontal ? { ...g, y: Math.round(d.orig + delta) } : { ...g, x: Math.round(d.orig + delta) }) : g
    )
    setGuides(next)
    if (boardIdRef.current != null) {
      await window.api.setBoardGuides(boardIdRef.current, JSON.stringify(next))
      await refreshBoards()
    }
  }
  const onGuidePointerUp = async (e: React.PointerEvent) => {
    await finishGuideDrag(e.clientX, e.clientY)
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
    const next: Guide[] = horizontal
      ? [...guides, { id: guideId(), horizontal, y: Math.round(pt.y) }]
      : [...guides, { id: guideId(), horizontal, x: Math.round(pt.x) }]
    await persistGuides(next)
    setCtxMenu(null)
  }

  // 切换白板时重置选中,并恢复上次视口(缩放+位置,无保存则默认)。
  // 视口保存只写 DB 不同步 store,故恢复用 listBoards 取最新值;已恢复过的板不再重复应用
  const lastSavedViewportRef = useRef<Viewport | null>(null)
  const restoredForRef = useRef<number | null>(null)
  useEffect(() => {
    if (!activeBoardId || restoredForRef.current === activeBoardId) return
    setSel([])
    setMarquee(null)
    setDrawPreview(null)
    drawingRef.current = null
    // 正在编辑的 note 随 boardItems 替换被卸载,textarea 卸载不触发 blur:显式退出编辑态
    setEditingNoteId(null)
    let cancelled = false
    void window.api.listBoards().then((bs) => {
      if (cancelled) return
      const b = bs.find((x) => x.id === activeBoardId)
      const next = (b ? parseBoardViewport(b.viewport) : null) ?? { s: 1, x: 0, y: 0 }
      applyViewport(next)
      lastSavedViewportRef.current = { ...next }
      restoredForRef.current = activeBoardId
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoardId])

  // 视口持久化:缩放/平移后防抖 600ms 落库;未变或恢复值不重复写
  useEffect(() => {
    if (!activeBoardId || restoredForRef.current !== activeBoardId) return
    const last = lastSavedViewportRef.current
    if (last && last.s === viewport.s && last.x === viewport.x && last.y === viewport.y) return
    const t = setTimeout(() => {
      lastSavedViewportRef.current = { ...viewport }
      void window.api.setBoardViewport(activeBoardId, JSON.stringify(viewport))
    }, 600)
    return () => clearTimeout(t)
  }, [viewport, activeBoardId])

  // 卸载/切板前把防抖窗口内的最后一次视口立即写入(白板重开保持上次缩放与位置)
  useEffect(() => {
    return () => {
      const id = activeBoardId
      if (!id) return
      const v = viewportRef.current
      const last = lastSavedViewportRef.current
      if (last && (last.s !== v.s || last.x !== v.x || last.y !== v.y)) {
        lastSavedViewportRef.current = { ...v }
        void window.api.setBoardViewport(id, JSON.stringify(v))
      }
    }
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
        // 以画布中心为锚（与滚轮/±快捷键一致），否则滑块缩放时内容向左上/右下漂移
        const frame = frameRef.current
        const v = viewportRef.current
        if (!frame || ns === v.s) {
          applyViewport({ s: ns, x: v.x, y: v.y })
          return
        }
        const rect = frame.getBoundingClientRect()
        const anchorX = rect.width / 2
        const anchorY = rect.height / 2
        const boardX = (anchorX - v.x) / v.s
        const boardY = (anchorY - v.y) / v.s
        applyViewport({ s: ns, x: anchorX - boardX * ns, y: anchorY - boardY * ns })
      },
      resetView: () => {
        applyViewport({ s: 1, x: 0, y: 0 })
      },
      fitContent: () => fitContent(),
      exportSvg: () => buildBoardSvg(),
      /** SVG → PNG(默认 2 倍超采样)。pngMode 下笔记走 <text>——含 foreignObject 的 SVG 绘入 canvas 会污染画布(实测探针确认) */
      exportPng: async (scale = 2): Promise<string> => {
        const svg = await buildBoardSvg(true)
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        try {
          const img = new Image()
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error('SVG 渲染失败'))
            img.src = url
          })
          const m = /^<svg[^>]*width="(\d+)" height="(\d+)"/.exec(svg)
          const w = m ? Number(m[1]) : img.naturalWidth || 1200
          const h = m ? Number(m[2]) : img.naturalHeight || 800
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(w * scale))
          canvas.height = Math.max(1, Math.round(h * scale))
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('canvas 不可用')
          ctx.scale(scale, scale)
          ctx.drawImage(img, 0, 0, w, h)
          return canvas.toDataURL('image/png')
        } finally {
          URL.revokeObjectURL(url)
        }
      },
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

  /**
   * 生成画布场景 SVG（背景/参考线/图片/文字/形状全量导出,图片内嵌 base64）。
   * pngMode=true 时笔记用 SVG <text> 渲染而非 foreignObject——Chromium 下
   * 含 foreignObject 的 SVG 绘入 canvas 会污染画布,无法 toDataURL(实测探针确认)。
   */
  const buildBoardSvg = async (pngMode = false): Promise<string> => {
    const bbox = itemsBBox() ?? { x: 0, y: 0, w: 1200, h: 800 }
    const pad = 60
    const w = Math.max(800, Math.ceil(bbox.w + pad * 2))
    const h = Math.max(600, Math.ceil(bbox.h + pad * 2))
    const ox = bbox.x - pad
    const oy = bbox.y - pad
    const appr = appearanceRef.current
    const bg = resolveBgColor(appr.bg)
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
    for (const rawIt of boardItemsRef.current) {
      // 元素几何/样式字段源于可导入的 .lumenboard，统一收敛为有限数值/白名单，防 SVG 属性逃逸
      const it = {
        ...rawIt,
        x: toFiniteNum(rawIt.x, 0),
        y: toFiniteNum(rawIt.y, 0),
        width: Math.max(0, toFiniteNum(rawIt.width, 100)),
        height: Math.max(0, toFiniteNum(rawIt.height, 100)),
        opacity: Math.min(100, Math.max(0, toFiniteNum(rawIt.opacity, 100))),
        noteFontSize: Math.min(200, Math.max(8, toFiniteNum(rawIt.noteFontSize, 16)))
      }
      const ex = it.x - ox
      const ey = it.y - oy
      const op = ((it.opacity ?? 100) / 100).toFixed(2)
      if (it.type === 'asset' && it.assetId) {
        const asset = assetById.get(it.assetId) ?? (await window.api.getAsset(it.assetId))
        if (!asset) continue
        // assetThumbUrl 已含 edited 戳;不可出缩略图的格式返回 ''(fetch('') 会抓当前页面)
        const thumb = assetThumbUrl(asset)
        const dataUrl = thumb ? await fetchToDataUrl(thumb) : ''
        const ih = it.height > 0 ? it.height : it.width * (aspectCacheRef.current[it.assetId] ?? 0.75)
        if (dataUrl) {
          // 翻转:以元素自身为中心镜像(translate 到对角再反向缩放)
          const flipT =
            it.flipX || it.flipY
              ? ` transform="translate(${it.flipX ? ex + it.width : ex}, ${it.flipY ? ey + ih : ey}) scale(${it.flipX ? -1 : 1}, ${it.flipY ? -1 : 1})"`
              : ''
          parts.push(
            `<image href="${dataUrl}"${flipT} x="${it.flipX || it.flipY ? 0 : ex}" y="${it.flipX || it.flipY ? 0 : ey}" width="${it.width}" height="${ih}" opacity="${op}" preserveAspectRatio="none"/>`
          )
        } else {
          parts.push(`<rect x="${ex}" y="${ey}" width="${it.width}" height="${ih}" fill="none" stroke="#888" stroke-dasharray="4 3"/>`)
        }
      } else if (it.type === 'note') {
        // noteColor/noteFont 可能源于恶意 .lumenboard 导入：注入 SVG 前白名单化/转义
        const rawColor = it.noteColor || '#e8eef7'
        const color = /^#[0-9a-f]{3,8}$/i.test(rawColor) ? rawColor : '#e8eef7'
        const font = (it.noteFont || 'sans-serif').replace(/[^a-zA-Z0-9 _.-]/g, '') || 'sans-serif'
        if (pngMode) {
          // PNG 路径:foreignObject 会污染画布,笔记降级为 <text> 逐行渲染(clipPath 裁剪溢出)
          const clipId = `nc-${clipSeq++}`
          const lines = String(it.text ?? '').split('\n').slice(0, 500)
          const tspans = lines
            .map((l, li) => `<tspan x="${ex + 4}" dy="${li === 0 ? 0 : Math.round(it.noteFontSize * 1.35)}">${xmlEscape(l)}</tspan>`)
            .join('')
          parts.push(
            `<clipPath id="${clipId}"><rect x="${ex}" y="${ey}" width="${it.width}" height="${it.height}"/></clipPath>` +
              `<g clip-path="url(#${clipId})" opacity="${op}"><text x="${ex + 4}" y="${ey + 4 + it.noteFontSize}" font-size="${it.noteFontSize}" font-family="${font}" fill="${color}" xml:space="preserve">${tspans}</text></g>`
          )
        } else {
          const text = xmlEscape(it.text).replace(/\n/g, '<br/>')
          parts.push(
            `<foreignObject x="${ex}" y="${ey}" width="${it.width}" height="${it.height}" opacity="${op}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;color:${color};font-family:${font};font-size:${it.noteFontSize}px;line-height:1.35;padding:4px;box-sizing:border-box;overflow:hidden;white-space:pre-wrap">${text}</div></foreignObject>`
          )
        }
      } else if (it.type === 'shape' && it.shape) {
        let shape: ShapeSpec
        try {
          shape = JSON.parse(it.shape) as ShapeSpec
        } catch {
          continue
        }
        const sw = Math.min(30, Math.max(0.5, toFiniteNum(shape.sw, 2.5)))
        const rawShapeColor = shape.color || '#5aa0ff'
        const color = /^#[0-9a-f]{3,8}$/i.test(rawShapeColor) ? rawShapeColor : '#5aa0ff'
        parts.push(`<g transform="translate(${ex},${ey})" opacity="${op}">`)
        if (shape.kind === 'rect') {
          parts.push(`<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, it.width - sw)}" height="${Math.max(0, it.height - sw)}" rx="2" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>`)
        } else if (shape.kind === 'ellipse') {
          parts.push(`<ellipse cx="${it.width / 2}" cy="${it.height / 2}" rx="${Math.max(0, it.width / 2 - sw / 2)}" ry="${Math.max(0, it.height / 2 - sw / 2)}" fill="none" stroke="${color}" stroke-width="${sw}"/>`)
        } else {
          const pts = (Array.isArray(shape.points) ? shape.points : []).map(
            (p) => [toFiniteNum(p?.[0], 0), toFiniteNum(p?.[1], 0)] as [number, number]
          )
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
      if (!selectedSetRef.current.has(it.id)) continue
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
      const added: NewBoardItem[] = []
      for (let i = 0; i < ids.length; i++) {
        if (i > 0 && i % 3 === 0) {
          cursorX = originX
          cursorY += rowHeight
          rowHeight = 0
        }
        // 实时回退:外部文件刚导入时 assetById 闭包可能未及刷新(await refreshAssets 后旧闭包
        // 仍缺新素材),从 store 现态补查,保证新导入素材也按原比例落位
        const asset = assetById.get(ids[i]) ?? useLibraryStore.getState().assets.find((a) => a.id === ids[i])
        // 按原比例入板:长边取原像素尺寸、封顶 1280(不放大),比例保持
        let w = 240
        let h = 0
        if (asset && asset.width > 0 && asset.height > 0) {
          const scale = Math.min(1, BOARD_DROP_LONG_EDGE / Math.max(asset.width, asset.height))
          w = Math.round(asset.width * scale)
          h = Math.round(asset.height * scale)
        }
        added.push({
          assetId: ids[i],
          type: 'asset',
          x: Math.round(cursorX),
          y: Math.round(cursorY),
          width: w,
          height: h
        })
        cursorX += w
        rowHeight = Math.max(rowHeight, h || w * 0.75)
      }
      // 一次批量 IPC（此前逐个 await：拖 20 张 = 20 趟往返）
      if (added.length > 0) await window.api.addBoardItems(boardId, added)
      await refreshBoardItems(boardId)
    },
    [assetById, boardId, refreshBoardItems]
  )

  /* ---------- 画布事件 ---------- */
  // 滚轮缩放用原生监听(passive:false 保证 preventDefault 生效)
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let wheelAcc = 0
    let wheelAnchor = { x: 0, y: 0 }
    let wheelRaf = 0
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      // 元素拖动/缩放/平移进行中禁止滚轮缩放：松手落库按按下时的视口换算,
      // 中途变焦会让 dx/dy 与 origs 口径不一致,元素落错位置
      if (dragRef.current || panRef.current) return
      // 合帧：一次滚动手势连发十几个 wheel 事件，逐事件 applyViewport 会让
      // 全组件重渲染十几遍（还连带原图判定的全量遍历）。这里累加 delta、每帧只落一次。
      wheelAcc += e.deltaY
      const rect = frame.getBoundingClientRect()
      wheelAnchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      if (wheelRaf) return
      wheelRaf = requestAnimationFrame(() => {
        wheelRaf = 0
        const dy = wheelAcc
        wheelAcc = 0
        const v = viewportRef.current
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.s * Math.exp(-dy * 0.0015)))
        if (nextZoom === v.s) return
        const boardX = (wheelAnchor.x - v.x) / v.s
        const boardY = (wheelAnchor.y - v.y) / v.s
        applyViewport({ s: nextZoom, x: wheelAnchor.x - boardX * nextZoom, y: wheelAnchor.y - boardY * nextZoom })
      })
    }
    frame.addEventListener('wheel', onWheelNative, { passive: false })
    return () => {
      frame.removeEventListener('wheel', onWheelNative)
      if (wheelRaf) cancelAnimationFrame(wheelRaf)
    }
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
    const hitSet = new Set<string>()
    const hitGroups = new Set<string>()
    for (const it of boardItemsRef.current) {
      const h = effHeight(it)
      const ix = it.x
      const iy = it.y
      const iw = it.width
      const ih = h
      if (rect.x < ix + iw && rect.x + rect.w > ix && rect.y < iy + ih && rect.y + rect.h > iy) {
        hit.push(it.id)
        hitSet.add(it.id)
        if (it.groupId) hitGroups.add(it.groupId)
      }
    }
    // 框到成组元素的任一成员 = 整组入选（组是「一起动」的单位，半组入选会把组拆散）
    if (hitGroups.size > 0) {
      for (const it of boardItemsRef.current) {
        if (it.groupId && hitGroups.has(it.groupId) && !hitSet.has(it.id)) {
          hit.push(it.id)
          hitSet.add(it.id)
        }
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

  /** 在画布坐标放置一个文字对象；单次放置后回到选择工具并立即编辑。 */
  const addNoteAt = async (x: number, y: number) => {
    if (boardIdRef.current == null) return
    pushHistory()
    const row = await window.api.addBoardItem(boardIdRef.current, {
      type: 'note',
      x: Math.round(x),
      y: Math.round(y),
      width: 240,
      height: 64,
      text: '',
      ...noteDefaults
    })
    setSel([row.id])
    setEditingNoteId(row.id)
    onToolChange?.('select')
    await refreshBoardItems(boardIdRef.current)
  }

  /** 实时预览（画布坐标原始点,渲染时归一化） */
  const updateDrawPreview = (d: NonNullable<typeof drawingRef.current>) => {
    const style = shapeStyleRef.current
    let x: number, y: number, w: number, h: number
    if (d.kind === 'pen') {
      // pen 的包围盒必须覆盖全部采样点：回笔形状(V/S/圈)的首尾范围远小于实际笔画
      x = Infinity; y = Infinity; w = -Infinity; h = -Infinity
      for (const [px, py] of d.points) {
        if (px < x) x = px
        if (py < y) y = py
        if (px > w) w = px
        if (py > h) h = py
      }
      w = Math.max(1, w - x)
      h = Math.max(1, h - y)
    } else {
      x = Math.min(d.startX, d.curX)
      y = Math.min(d.startY, d.curY)
      w = Math.max(1, Math.abs(d.curX - d.startX))
      h = Math.max(1, Math.abs(d.curY - d.startY))
    }
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
    let x: number, y: number, w: number, h: number
    if (d.kind === 'pen') {
      // 与预览同口径：包围盒取全部采样点,而非首尾两点
      x = Infinity; y = Infinity; w = -Infinity; h = -Infinity
      for (const [px, py] of d.points) {
        if (px < x) x = px
        if (py < y) y = py
        if (px > w) w = px
        if (py > h) h = py
      }
      w = Math.max(0, w - x)
      h = Math.max(0, h - y)
    } else {
      x = Math.min(d.startX, d.curX)
      y = Math.min(d.startY, d.curY)
      w = Math.abs(d.curX - d.startX)
      h = Math.abs(d.curY - d.startY)
    }
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

  /** 画布交互即聚焦 frame：split 模式下把键盘接管到画布（frame tabIndex=-1 可编程聚焦） */
  const focusFrame = (target: EventTarget | null) => {
    const el = target as HTMLElement | null
    if (el && typeof el.closest === 'function' && el.closest('input, textarea, select')) return
    try {
      frameRef.current?.focus()
    } catch {
      /* 忽略 */
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    focusFrame(e.target)
    // 中键或空格+左键：平移画布
    if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
      e.preventDefault()
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* 合成事件忽略 */
      }
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        vx: viewportRef.current.x,
        vy: viewportRef.current.y,
        moved: false
      }
      setPanning(true)
      return
    }
    if (e.button !== 0) return
    const t = toolRef.current
    if (t !== 'select') {
      // 绘图工具模式：空白处按下即开始绘制（文字为单次放置）
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
    // 空白处按下：开始框选（Shift=追加模式）。捕获指针,允许移出画布继续框选
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件忽略 */
    }
    const pt = canvasPointFromClient(e.clientX, e.clientY)
    marqueeRef.current = { startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y, additive: e.shiftKey, moved: false }
    setCtxMenu(null)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current
    if (p) {
      if (Math.abs(e.clientX - p.startX) > 2 || Math.abs(e.clientY - p.startY) > 2) p.moved = true
      const next = { ...viewportRef.current, x: p.vx + (e.clientX - p.startX), y: p.vy + (e.clientY - p.startY) }
      viewportRef.current = next
      if (surfaceRef.current) {
        surfaceRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.s})`
      }
      applyGridTransform(next)
      // 平移全程 DOM 直改(不逐帧 React 渲染);裁剪矩形靠 rAF 节流同步——
      // 长距离平移时新划入视口的元素即时挂载,视口 state 跟手(下次渲染不跳回),
      // 且原图叠加层随视口及时更新;rAF 不调度(CDP/后台窗)时 pointerup 的 applyViewport 兜底
      if (!cullSyncPendingRef.current) {
        cullSyncPendingRef.current = true
        requestAnimationFrame(() => {
          cullSyncPendingRef.current = false
          setViewport({ ...viewportRef.current })
        })
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
    const pan = panRef.current
    if (pan) {
      panRef.current = null
      setPanning(false)
      // 平移逐帧直接写 DOM；结束时必须同步回 React state，否则下一次渲染会把画布
      // 恢复到平移前的位置，看起来像素材突然跳向鼠标。
      applyViewport({ ...viewportRef.current })
      if (pan.moved) suppressItemClickUntilRef.current = Date.now() + 240
      return
    }
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
      if (activeBoardId == null) return
      // 本地手势/文字编辑进行中不刷新:异步回写会与 DOM 中间态/编辑内容交错覆盖
      if (
        dragRef.current ||
        drawingRef.current ||
        panRef.current ||
        guideDragRef.current ||
        nudgeRef.current ||
        marqueeRef.current ||
        editingNoteId != null
      ) {
        return
      }
      void refreshBoardItems(activeBoardId)
      void refreshBoards()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [activeBoardId, refreshBoardItems, refreshBoards, editingNoteId])

  /* ---------- 键盘（空格平移 / Delete 删除选中 / Ctrl+A 全选 / Esc 取消） ---------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const closest = (sel: string): boolean =>
        !!target && typeof target.closest === 'function' && !!target.closest(sel)
      const editable = closest('input, textarea, select, [contenteditable="true"]')
      // split 模式下焦点在素材库/工具栏时,画布快捷键让位（否则劫持图库的 Ctrl+A/方向键/Delete）;
      // 白板全屏始终生效。画布 pointerdown 会聚焦 frame,交互过画布即接管键盘。
      if (boardViewModeRef.current !== 'board' && !closest('[data-board-frame]')) return
      if (e.key === ' ' && !editable) {
        spaceDownRef.current = true
        setSpaceDown(true)
        e.preventDefault()
      }
      // 绘制进行中：Esc 取消
      if (e.key === 'Escape') {
        // note 编辑中的 Esc 由 textarea 自身处理(提交退出),这里不再清空选中
        if (editable) return
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
      if (editable) return
      const key = e.key.toLowerCase()
      if (e.key === 'Delete' && selectedIdsRef.current.length > 0) {
        // 锁定元素删不掉（Delete 与右键移除同一口径），否则误触就没法找回
        const ids = boardItemsRef.current.filter((i) => selectedIdsRef.current.includes(i.id) && !i.locked).map((i) => i.id)
        if (ids.length === 0) return
        setSel(selectedIdsRef.current.filter((id) => !ids.includes(id)))
        // 逐个并发发起但不等待就刷新,listBoardItems 可能先于删除返回旧数据 → 已删元素"闪回"。
        // 等全部删除落库后再刷新。
        void (async () => {
          pushHistory()
          await window.api.deleteBoardItems(ids)
          if (boardIdRef.current != null) await refreshBoardItems(boardIdRef.current)
        })()
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
        // 成组 / 解组（对标 Figma Ctrl+G / Ctrl+Shift+G）
        if (key === 'g') {
          e.preventDefault()
          if (e.shiftKey) void ungroupCtx()
          else void groupCtx()
          return
        }
        // 锁定 / 解锁（按当前选中态取反）
        if (key === 'l') {
          e.preventDefault()
          void lockCtx(null)
          return
        }
        // 图层：] 上移 / [ 下移，Shift 版为置顶 / 置底（对标 Figma）
        if (key === ']' || key === '[') {
          e.preventDefault()
          const up = key === ']'
          void reorderCtx(e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward')
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
    // 内部素材 MIME 或系统文件拖入都接受(后者对标 PureRef:外部图直接拖上白板)
    if (e.dataTransfer.types.includes(ASSET_MIME) || e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e: React.DragEvent) => {
    // 外部系统文件:导入素材库并把新素材放到落点(对标 PureRef 拖图上板)
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      if (boardId == null) return
      const pt = canvasPointFromClient(e.clientX, e.clientY)
      void (async () => {
        const result = await window.api.importFileObjects(Array.from(e.dataTransfer.files))
        const ids = result?.importedIds ?? []
        if (ids.length > 0) {
          await useLibraryStore.getState().refreshAssets()
          await addAssetsToBoard(ids, Math.round(pt.x), Math.round(pt.y))
          useLibraryStore.getState().showToast(`已导入 ${ids.length} 张并加入白板`)
        } else if (result && result.skipped > 0) {
          useLibraryStore.getState().showToast('这些图片已在素材库中(可从左侧参考架拖入)')
        }
      })()
      return
    }
    const raw = e.dataTransfer.getData(ASSET_MIME)
    if (!raw) return
    e.preventDefault()
    e.stopPropagation()
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
  /** 命中元素 → 应选中的 id 集合：成组元素整组选中（组就是「一起动」的语义单位） */
  const groupOf = (item: BoardItem): string[] =>
    item.groupId ? boardItemsRef.current.filter((i) => i.groupId === item.groupId).map((i) => i.id) : [item.id]

  const onItemPointerDown = (e: React.PointerEvent, item: BoardItem, mode: 'move' | 'resize', dir?: ResizeDir) => {
    if (e.button !== 0) return
    focusFrame(e.target)
    // 空格+左键始终属于画布平移。这里不阻止冒泡，让 frame 接管 pointer，
    // 即使起点落在素材上也不能启动元素拖动。
    if (spaceDownRef.current) return
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件忽略 */
    }
    setCtxMenu(null)
    // 锁定元素只选中、不拖动/缩放（否则只能删掉才能解锁）
    if (item.locked) {
      setSel(groupOf(item))
      return
    }
    // Shift 点击：切换选中（命中则并入组拖动,未命中则不拖动）
    if (e.shiftKey) {
      const cur = selectedIdsRef.current
      const hit = groupOf(item)
      const on = hit.every((id) => cur.includes(id))
      const next = on ? cur.filter((x) => !hit.includes(x)) : [...new Set([...cur, ...hit])]
      setSel(next)
      if (!on) {
        // 刚加入选中：整组拖动
        startDrag(next, item, mode, dir, e)
      }
      return
    }
    // 非 Shift：点击已选中元素 = 组拖动;点击未选中元素 = 单选（含所在组）后拖动
    if (isSelected(item.id)) {
      startDrag(selectedIdsRef.current, item, mode, dir, e)
    } else {
      const sel = groupOf(item)
      setSel(sel)
      startDrag(sel, item, mode, dir, e)
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
      // 锁定元素不参与组拖动/组缩放：混选时其余照常移动，锁定的留在原地
      if (!ids.includes(it.id) || it.locked) continue
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
      bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      lockAspect: mode === 'resize' && e.shiftKey
    }
    // 拖动开始即隐藏组包围盒（松手后恢复）
    if (groupBoxRef.current) groupBoxRef.current.style.display = 'none'
  }

  /**
   * 智能吸附：把被拖包围盒的「左/水平中/右」「顶/垂直中/底」贴到附近元素对应边或手动参考线上。
   * 返回位移修正量与命中的吸附线位置（画布坐标）。
   */
  const snapOffsets = (box: Rect, moving: Set<string>) => {
    const tol = SNAP_TOL / viewportRef.current.s
    const vTargets: number[] = []
    const hTargets: number[] = []
    for (const g of guidesRef.current) {
      // 参考线位置统一存在 x（旧数据可能只有 y,一并兜底）
      const pos = g.x ?? g.y
      if (pos == null) continue
      if (g.horizontal) hTargets.push(pos)
      else vTargets.push(pos)
    }
    for (const it of boardItemsRef.current) {
      if (moving.has(it.id)) continue
      vTargets.push(it.x, it.x + it.width / 2, it.x + it.width)
      const h = effHeight(it)
      hTargets.push(it.y, it.y + h / 2, it.y + h)
    }
    const pick = (edges: number[], targets: number[]) => {
      let best: { off: number; line: number; dist: number } | null = null
      for (const t of targets) {
        for (const e of edges) {
          const dist = Math.abs(t - e)
          if (dist <= tol && (!best || dist < best.dist)) best = { off: t - e, line: t, dist }
        }
      }
      return best
    }
    const v = pick([box.x, box.x + box.w / 2, box.x + box.w], vTargets)
    const h = pick([box.y, box.y + box.h / 2, box.y + box.h], hTargets)
    return { dx: v?.off ?? 0, dy: h?.off ?? 0, v: v ? [v.line] : [], h: h ? [h.line] : [] }
  }

  /** 吸附线绘制：只在命中时显示；线宽按缩放反算，屏幕上恒为 1px */
  const paintSnapLines = (vLines: number[], hLines: number[], box: Rect | null) => {
    const s = viewportRef.current.s
    const thick = Math.max(0.5, 1 / s)
    const pad = 48 / s
    const put = (k: number, show: boolean, style: Record<string, string>) => {
      const el = snapLinesRef.current[k]
      if (!el) return
      if (!show || !box) {
        el.style.display = 'none'
        return
      }
      Object.assign(el.style, { display: 'block', position: 'absolute', background: 'var(--accent)', zIndex: 4 }, style)
    }
    const v = vLines[0]
    const h = hLines[0]
    put(0, v !== undefined, { left: `${v ?? 0}px`, top: `${box ? box.y - pad : 0}px`, width: `${thick}px`, height: `${box ? box.h + pad * 2 : 0}px` })
    put(1, h !== undefined, { left: `${box ? box.x - pad : 0}px`, top: `${h ?? 0}px`, width: `${box ? box.w + pad * 2 : 0}px`, height: `${thick}px` })
    put(2, false, {})
    put(3, false, {})
  }

  /** 拖动/缩放的落位计算：预览（DOM 直改）与松手落库共用同一套数学，避免两处口径漂移 */
  const layoutDrag = (
    d: NonNullable<typeof dragRef.current>,
    dx: number,
    dy: number,
    opts: { snap: boolean; lockAspect: boolean }
  ): { rects: Map<string, Rect>; vLines: number[]; hLines: number[]; box: Rect | null } => {
    const rects = new Map<string, Rect>()
    if (d.mode === 'move') {
      let sx = Infinity
      let sy = Infinity
      let ex = -Infinity
      let ey = -Infinity
      for (const id of d.ids) {
        const o = d.origs.get(id)
        if (!o) continue
        sx = Math.min(sx, o.x)
        sy = Math.min(sy, o.y)
        ex = Math.max(ex, o.x + o.w)
        ey = Math.max(ey, o.y + o.h)
      }
      let ox = dx
      let oy = dy
      let vLines: number[] = []
      let hLines: number[] = []
      if (sx < ex) {
        const box = { x: sx + dx, y: sy + dy, w: ex - sx, h: ey - sy }
        if (opts.snap) {
          const s = snapOffsets(box, new Set(d.ids))
          ox += s.dx
          oy += s.dy
          vLines = s.v
          hLines = s.h
        }
        box.x += ox - dx
        box.y += oy - dy
      }
      for (const id of d.ids) {
        const o = d.origs.get(id)
        if (o) rects.set(id, { x: o.x + ox, y: o.y + oy, w: o.w, h: o.h })
      }
      return { rects, vLines, hLines, box: sx < ex ? { x: sx + ox, y: sy + oy, w: ex - sx, h: ey - sy } : null }
    }
    // 8 向缩放（组缩放 = 包围盒缩放后按比例映射每个元素）
    const dir = d.dir ?? 'se'
    const b = d.bbox
    let { x, y, w, h } = { x: b.x, y: b.y, w: b.w, h: b.h }
    if (opts.lockAspect && b.w > 0 && b.h > 0) {
      // Shift 等比：两轴取同一个缩放比（变化更大的那一轴说了算），短边跟随长边
      const cands: number[] = []
      if (dir.includes('e')) cands.push((b.w + dx) / b.w)
      if (dir.includes('w')) cands.push((b.w - dx) / b.w)
      if (dir.includes('s')) cands.push((b.h + dy) / b.h)
      if (dir.includes('n')) cands.push((b.h - dy) / b.h)
      let scale = cands.length > 0 ? cands.reduce((best, v) => (Math.abs(v - 1) > Math.abs(best - 1) ? v : best), cands[0]) : 1
      scale = Math.max(MIN_SIZE / Math.max(b.w, b.h), scale)
      w = Math.max(MIN_SIZE, b.w * scale)
      h = Math.max(MIN_SIZE, b.h * scale)
      if (dir.includes('w')) x = b.x + (b.w - w)
      if (dir.includes('n')) y = b.y + (b.h - h)
    } else {
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
    }
    const sx = b.w > 0 ? w / b.w : 1
    const sy = b.h > 0 ? h / b.h : 1
    for (const id of d.ids) {
      const o = d.origs.get(id)
      if (o)
        rects.set(id, {
          x: x + (o.x - b.x) * sx,
          y: y + (o.y - b.y) * sy,
          w: Math.max(16, o.w * sx),
          h: Math.max(16, o.h * sy)
        })
    }
    return { rects, vLines: [], hLines: [], box: { x, y, w, h } }
  }

  const applyDragToDom = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const s = viewportRef.current.s
    const dx = (e.clientX - d.startX) / s
    const dy = (e.clientY - d.startY) / s
    d.lockAspect = d.mode === 'resize' && e.shiftKey
    // Alt 临时关闭吸附（对标 Figma：需要精确错位摆放时按住 Alt）
    d.snapOff = e.altKey
    const { rects, vLines, hLines, box } = layoutDrag(d, dx, dy, { snap: !e.altKey, lockAspect: d.lockAspect })
    for (const [id, r] of rects) {
      const el = itemEls.current.get(id)
      if (!el) continue
      el.style.left = `${r.x}px`
      el.style.top = `${r.y}px`
      if (d.mode === 'resize') {
        el.style.width = `${r.w}px`
        el.style.height = `${r.h}px`
      }
    }
    paintSnapLines(vLines, hLines, box)
    // 组包围盒实时跟随（仅缩放模式；移动时按下即隐藏）
    if (d.mode === 'resize' && box && groupBoxRef.current) {
      groupBoxRef.current.style.left = `${box.x}px`
      groupBoxRef.current.style.top = `${box.y}px`
      groupBoxRef.current.style.width = `${box.w}px`
      groupBoxRef.current.style.height = `${box.h}px`
    }
  }

  const onItemPointerMove = (e: React.PointerEvent) => {
    // 用户可能在已经按下素材后才按住空格：取消尚未落库的元素拖动，
    // 从当前位置无缝转成画布平移，避免素材跟到鼠标位置。
    if (spaceDownRef.current && dragRef.current) {
      const drag = dragRef.current
      for (const id of drag.ids) {
        const original = drag.origs.get(id)
        const element = itemEls.current.get(id)
        if (original && element) {
          element.style.left = `${original.x}px`
          element.style.top = `${original.y}px`
          element.style.width = `${original.w}px`
          element.style.height = `${original.h}px`
        }
      }
      dragRef.current = null
      if (groupBoxRef.current) groupBoxRef.current.style.display = 'flex'
      paintSnapLines([], [], null)
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        vx: viewportRef.current.x,
        vy: viewportRef.current.y,
        moved: false
      }
      setPanning(true)
      return
    }
    applyDragToDom(e)
  }

  const onItemPointerUp = async (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (groupBoxRef.current) groupBoxRef.current.style.display = 'flex'
    paintSnapLines([], [], null)
    const rawDx = e.clientX - d.startX
    const rawDy = e.clientY - d.startY
    // 未发生位移的按下-松开 = 纯点击：交给随后的 click(选中/置顶)处理,
    // 不写库不入栈,否则每次点击都往撤销历史塞无意义快照(move/resize 同理)
    if (Math.abs(rawDx) < 0.5 && Math.abs(rawDy) < 0.5) return
    // 真实拖动后抑制尾随 click(避免拖动后再触发一次置顶+快照)
    suppressItemClickUntilRef.current = Date.now() + 240
    // 移动/缩放前入栈（此时 store 还是拖动前状态）
    pushHistory()
    const s = viewportRef.current.s
    // 与预览同一套数学（吸附/等比沿用最后一帧的修饰键状态，避免松手瞬间跳几像素）
    const { rects } = layoutDrag(d, rawDx / s, rawDy / s, { snap: !d.snapOff, lockAspect: !!d.lockAspect })
    const updates: { id: string; patch: BoardItemPatch }[] = []
    for (const [id, r] of rects) {
      const o = d.origs.get(id)
      if (!o) continue
      const x = Math.round(r.x)
      const y = Math.round(r.y)
      const patch: BoardItemPatch = { x, y }
      let changed = x !== Math.round(o.x) || y !== Math.round(o.y)
      if (d.mode === 'resize') {
        const width = Math.round(r.w)
        const height = Math.round(r.h)
        patch.width = width
        patch.height = height
        changed = changed || width !== Math.round(o.w) || height !== Math.round(o.h)
      }
      // 组变换里没动过的成员不写库
      if (changed) updates.push({ id, patch })
    }
    if (updates.length > 0) await window.api.updateBoardItems(updates)
    if (boardId != null) await refreshBoardItems(boardId)
  }

  /** 点击元素置顶 + 选中（多选状态下点击选中元素保持组选中） */
  const onItemClick = async (item: BoardItem) => {
    if (Date.now() < suppressItemClickUntilRef.current) return
    if (boardId != null) {
      // 已在顶层：不写库不入栈（否则每次点击都污染撤销历史）
      let maxZ = -Infinity
      for (const i of boardItemsRef.current) if (i.z > maxZ) maxZ = i.z
      if (item.z >= maxZ) return
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
  /**
   * 菜单/命令作用对象：多选时作用于选中组，否则作用于右键元素。
   * 右键菜单关闭时（键盘 Ctrl+G / Ctrl+L / Ctrl+] 走的就是这条路）回落到当前选中集——
   * 否则单选状态下所有键盘命令都会静默空转。
   */
  const ctxTarget = (): BoardItem[] => {
    const ids = selectedIdsRef.current
    if (ids.length > 1) return boardItemsRef.current.filter((i) => ids.includes(i.id))
    if (ctxMenu?.itemId) return boardItemsRef.current.filter((i) => i.id === ctxMenu.itemId)
    if (ids.length === 1) return boardItemsRef.current.filter((i) => i.id === ids[0])
    return []
  }
  const removeCtxItem = async () => {
    const target = ctxTarget().filter((i) => !i.locked)
    if (target.length > 0) {
      pushHistory()
      await window.api.deleteBoardItems(target.map((i) => i.id))
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
    const updates: { id: string; patch: BoardItemPatch }[] = []
    for (const it of target) {
      // 高度口径与拖动包围盒一致（aspectCache 推算）
      const h = effHeight(it)
      if (mode === 'row') {
        updates.push({ id: it.id, patch: { x: startX + cursor, y: startY } })
        cursor += it.width
      } else if (mode === 'column') {
        updates.push({ id: it.id, patch: { x: startX, y: startY + cursor } })
        cursor += h
      } else {
        if (assetIdx > 0 && assetIdx % 3 === 0) {
          gridX = startX
          gridY += rowHeight
          rowHeight = 0
        }
        if (it.type === 'asset') {
          // 网格排列统一素材卡片尺寸;note/shape 保持原尺寸,只摆位置(否则破坏文字/形状)
          updates.push({ id: it.id, patch: { x: gridX, y: gridY, width: 240, height: Math.round(h) } })
          gridX += 240
        } else {
          updates.push({ id: it.id, patch: { x: gridX, y: gridY } })
          gridX += it.width
        }
        rowHeight = Math.max(rowHeight, h)
      }
      assetIdx++
    }
    // 一次批量 IPC（此前逐条 await：排列 200 个元素 = 200 趟往返）
    await window.api.updateBoardItems(updates)
    await refreshBoardItems(boardId)
    setCtxMenu(null)
  }
  /** 多选等距分布(对标 Figma/PureRef distribute):保持首尾位置不动,中间均匀间距,不改尺寸 */
  const distributeCtx = async (axis: 'h' | 'v') => {
    if (boardId == null) return
    const target = ctxTarget()
    if (target.length < 3) return
    pushHistory()
    const updates: { id: string; patch: BoardItemPatch }[] = []
    if (axis === 'h') {
      const sorted = [...target].sort((a, b) => a.x - b.x)
      const span = sorted[sorted.length - 1].x - sorted[0].x
      const sumSizes = sorted.reduce((s, it) => s + it.width, 0)
      const gap = (span - sumSizes) / (sorted.length - 1)
      let x = sorted[0].x
      for (const it of sorted) {
        updates.push({ id: it.id, patch: { x: Math.round(x) } })
        x += it.width + gap
      }
    } else {
      const sorted = [...target].sort((a, b) => a.y - b.y)
      const span = sorted[sorted.length - 1].y - sorted[0].y
      const sumSizes = sorted.reduce((s, it) => s + effHeight(it), 0)
      const gap = (span - sumSizes) / (sorted.length - 1)
      let y = sorted[0].y
      for (const it of sorted) {
        updates.push({ id: it.id, patch: { y: Math.round(y) } })
        y += effHeight(it) + gap
      }
    }
    await window.api.updateBoardItems(updates)
    await refreshBoardItems(boardId)
    setCtxMenu(null)
  }
  const setNoteStyle = async (patch: NoteStylePatch) => {
    const target = ctxTarget()
    if (target.length === 0) return
    pushHistory()
    const updates = target.map((it) => ({ id: it.id, patch }))
    await window.api.updateBoardItems(updates)
    if (boardId != null) await refreshBoardItems(boardId)
    setCtxMenu(null)
  }
  /** 翻转素材（对标 PureRef 画师对照）:以右键元素的当前态取反,多选时统一应用 */
  const flipCtx = async (axis: 'flipX' | 'flipY') => {
    const targets = ctxTarget()
    if (targets.length === 0) return
    pushHistory()
    const next = !(targets[0][axis] ?? false)
    const updates = targets.map((it) => ({ id: it.id, patch: { [axis]: next } as BoardItemPatch }))
    await window.api.updateBoardItems(updates)
    if (boardId != null) await refreshBoardItems(boardId)
    setCtxMenu(null)
  }
  /** 批量落库 + 刷新（右键菜单各命令共用；刷新保持对象引用，不会让全画布重渲染） */
  const commitPatches = async (updates: { id: string; patch: BoardItemPatch }[]): Promise<boolean> => {
    if (updates.length === 0) return false
    pushHistory()
    await window.api.updateBoardItems(updates)
    if (boardId != null) await refreshBoardItems(boardId)
    return true
  }
  /** 锁定/解锁：locked 传 null = 按当前态取反（对标 PureRef 钉住参考图） */
  const lockCtx = async (locked: boolean | null) => {
    const targets = ctxTarget()
    if (targets.length === 0) return
    // 选中里有未锁定的就整体锁定，全已锁定才整体解锁
    const next = locked ?? targets.some((it) => !it.locked)
    if (await commitPatches(targets.map((it) => ({ id: it.id, patch: { locked: next } })))) setCtxMenu(null)
  }
  /** 成组：选中元素打同一个 groupId（已在组里的保留原组，不拆开别人的组） */
  const groupCtx = async () => {
    const targets = ctxTarget()
    if (targets.length < 2) return
    const gid = Math.random().toString(36).slice(2, 10)
    if (await commitPatches(targets.map((it) => ({ id: it.id, patch: { groupId: it.groupId || gid } })))) setCtxMenu(null)
  }
  const ungroupCtx = async () => {
    const targets = boardItemsRef.current.filter((i) => selectedIdsRef.current.includes(i.id) && i.groupId)
    if (targets.length === 0) return
    if (await commitPatches(targets.map((it) => ({ id: it.id, patch: { groupId: '' } })))) setCtxMenu(null)
  }
  /**
   * 图层顺序：置顶 / 置底 / 上移一层 / 下移一层。
   * z 是叠放的唯一依据（listBoardItems 按 z 升序，数组下标即绘制顺序），
   * 所以这里只算目标顺序、把 z 重编号为下标，且只落库真正变化的行——
   * 顺带把导入/撤销可能留下的重复 z 压实。
   */
  const reorderCtx = async (action: 'front' | 'back' | 'forward' | 'backward') => {
    const targets = ctxTarget()
    if (targets.length === 0) return
    const all = boardItemsRef.current
    const ids = new Set(targets.map((i) => i.id))
    const arr = all.map((i) => i.id)
    const moved = all.filter((i) => ids.has(i.id)).map((i) => i.id)
    const rest = all.filter((i) => !ids.has(i.id)).map((i) => i.id)
    if (action === 'front' || action === 'back') {
      arr.length = 0
      arr.push(...(action === 'front' ? [...rest, ...moved] : [...moved, ...rest]))
    } else if (action === 'forward') {
      // 自上而下冒泡：选中元素与它上面那个未选中元素交换
      for (let k = arr.length - 2; k >= 0; k--) {
        if (ids.has(arr[k]) && !ids.has(arr[k + 1])) [arr[k], arr[k + 1]] = [arr[k + 1], arr[k]]
      }
    } else {
      for (let k = 1; k < arr.length; k++) {
        if (ids.has(arr[k]) && !ids.has(arr[k - 1])) [arr[k], arr[k - 1]] = [arr[k - 1], arr[k]]
      }
    }
    const before = new Map(all.map((i) => [i.id, i.z]))
    const updates: { id: string; patch: BoardItemPatch }[] = []
    arr.forEach((id, k) => {
      if (before.get(id) !== k) updates.push({ id, patch: { z: k } })
    })
    if (updates.length === 0) {
      setCtxMenu(null)
      return
    }
    if (await commitPatches(updates)) setCtxMenu(null)
  }
  /**
   * 多选对齐（对标 Figma/PureRef）：以选区包围盒为基准六向对齐。
   * 高度口径与拖动包围盒一致（asset 的 height=0 走 aspectCache 推算），否则对齐到"看不见的边"。
   */
  const alignCtx = async (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    const targets = ctxTarget()
    if (targets.length < 2) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const hs = new Map<string, number>()
    for (const it of targets) {
      const h = effHeight(it)
      hs.set(it.id, h)
      minX = Math.min(minX, it.x)
      minY = Math.min(minY, it.y)
      maxX = Math.max(maxX, it.x + it.width)
      maxY = Math.max(maxY, it.y + h)
    }
    const updates: { id: string; patch: BoardItemPatch }[] = []
    for (const it of targets) {
      const h = hs.get(it.id) ?? effHeight(it)
      const horizontal = mode === 'left' || mode === 'hcenter' || mode === 'right'
      const before = horizontal ? it.x : it.y
      const after =
        mode === 'left'
          ? minX
          : mode === 'right'
            ? maxX - it.width
            : mode === 'hcenter'
              ? (minX + maxX) / 2 - it.width / 2
              : mode === 'top'
                ? minY
                : mode === 'bottom'
                  ? maxY - h
                  : (minY + maxY) / 2 - h / 2
      const pos = Math.round(after)
      if (pos === Math.round(before)) continue
      updates.push({ id: it.id, patch: horizontal ? { x: pos } : { y: pos } })
    }
    if (await commitPatches(updates)) setCtxMenu(null)
  }
  const setActiveNoteStyle = async (patch: NoteStylePatch) => {
    setNoteDefaults((current) => ({ ...current, ...patch }))
    const id = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null
    const selected = id ? boardItemsRef.current.find((item) => item.id === id && item.type === 'note') : null
    if (!selected) return
    pushHistory()
    await window.api.updateBoardItem(selected.id, patch)
    if (boardId != null) await refreshBoardItems(boardId)
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
    // naturalHeight 也要 >0：损坏图片的 aspect 会算出 Infinity
    if (img.naturalWidth > 0 && img.naturalHeight > 0 && item.assetId) {
      setAspectCache((prev) => ({ ...prev, [item.assetId!]: img.naturalWidth / img.naturalHeight }))
    }
  }

  // 右键菜单里的 note 元素
  const ctxItem = ctxMenu?.itemId ? boardItems.find((i) => i.id === ctxMenu.itemId) : null
  const ctxIsNote = ctxItem?.type === 'note'
  const ctxIsShape = ctxItem?.type === 'shape'
  const ctxShapeSpec: ShapeSpec | null = ctxIsShape && ctxItem?.shape ? (() => { try { return JSON.parse(ctxItem.shape) as ShapeSpec } catch { return null } })() : null
  const multiSelected = selectedIds.length > 1
  const selectedNote = selectedIds.length === 1 ? boardItems.find((item) => item.id === selectedIds[0] && item.type === 'note') ?? null : null
  const activeNoteStyle = selectedNote
    ? {
        noteFont: selectedNote.noteFont || '',
        noteColor: selectedNote.noteColor || '#e8eef7',
        noteFontSize: selectedNote.noteFontSize || 16
      }
    : noteDefaults
  const showTextStyleBar = tool === 'note' || selectedNote != null

  /** memo 化子元素的事件句柄走 ref(每次渲染刷新为最新闭包,ref 本身身份稳定):
   * 视口/选中等父级变化时子元素 shallow 比较 props 直接跳过,不重渲染不重建事件函数 */
  const itemApiRef = useRef<BoardItemApi>(null as unknown as BoardItemApi)
  itemApiRef.current = {
    itemEls,
    onPointerDown: onItemPointerDown,
    onPointerMove: onItemPointerMove,
    onPointerUp: onItemPointerUp,
    onClick: onItemClick,
    onDoubleClick: (item: BoardItem) => {
      setSel([item.id])
      setEditingNoteId(item.id)
    },
    onContextMenu: openCtxMenu,
    onImgLoad,
    focusFrame,
    spaceDownRef,
    setEditingNoteId,
    onToolChange,
    toolRef,
    pushHistory,
    setSel,
    refreshBoardItems,
    boardIdRef,
    markOrigLoaded
  }

  return (
    <div
      ref={frameRef}
      data-board-frame
      tabIndex={-1}
      className="archive-board-frame relative min-h-0 flex-1 overflow-hidden outline-none"
      style={{
        backgroundColor: bgColor,
        cursor: panning ? 'grabbing' : spaceDown ? 'grab' : marquee ? 'crosshair' : tool !== 'select' ? 'crosshair' : 'default'
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={(e) => openCtxMenu(e, null)}
      onDoubleClick={(e) => {
        // 双击空白 = 适配全部内容（工具栏 tooltip 一直这么写着，此前并没有实现）。
        // 元素上的双击另有语义（文字进编辑），必须排除。
        const el = e.target as HTMLElement
        if (el.closest('[data-board-item]') || el.closest('[data-group-box]')) return
        fitContent()
      }}
    >
      {showTextStyleBar && (
        <div
          data-board-text-stylebar
          className="archive-board-text-stylebar absolute left-1/2 top-3 z-[220] flex -translate-x-1/2 items-center gap-2 rounded-sm border border-[var(--border-strong)] bg-[var(--bg-panel)]/95 px-2 py-1.5 shadow-lg backdrop-blur"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="mono mr-1 text-[9px] tracking-[0.12em] text-[var(--text-faint)]">文字</span>
          <select
            aria-label="文字字体"
            className="field-input h-7 w-28 px-1.5 text-[11px]"
            value={activeNoteStyle.noteFont}
            onChange={(event) => void setActiveNoteStyle({ noteFont: event.target.value })}
          >
            {NOTE_FONTS.map((font) => (
              <option key={font.label} value={font.value} style={{ fontFamily: font.value || undefined }}>
                {font.label}
              </option>
            ))}
          </select>
          <select
            aria-label="文字字号"
            className="field-input h-7 w-16 px-1.5 text-[11px]"
            value={activeNoteStyle.noteFontSize}
            onChange={(event) => void setActiveNoteStyle({ noteFontSize: Number(event.target.value) })}
          >
            {NOTE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          <div className="flex items-center gap-1" aria-label="文字颜色">
            {NOTE_COLORS.map((color) => (
              <button
                key={color}
                aria-label={`文字颜色 ${color}`}
                className={`h-4 w-4 rounded-full border ${activeNoteStyle.noteColor === color ? 'ring-2 ring-[var(--accent)]' : 'border-white/20'}`}
                style={{ background: color }}
                onClick={() => void setActiveNoteStyle({ noteColor: color })}
              />
            ))}
            <input
              type="color"
              aria-label="自定义文字颜色"
              className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
              value={activeNoteStyle.noteColor}
              onChange={(event) => void setActiveNoteStyle({ noteColor: event.target.value })}
            />
          </div>
        </div>
      )}
      {/* 点阵背景（画布外观：开关 + 密度 + 颜色随背景亮度自适应） */}
      {appearance.grid && (
        <div
          ref={gridRef}
          data-grid
          className="archive-board-grid pointer-events-none absolute inset-0"
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
        {visibleItems.map((item) => {
          const autoH = item.height > 0 ? item.height : item.width * (aspectCache[item.assetId ?? ''] ?? 0.75)
          const asset = item.assetId ? assetById.get(item.assetId) : undefined
          const sel = isSelected(item.id)
          const editing = item.type === 'note' && editingNoteId === item.id
          // 视口降级:素材渲染尺寸过小时用主色色块占位,免除缩略图解码/绘制(仅 asset,文字/形状保持可读)
          const degraded = item.type === 'asset' && (item.width * viewport.s < DEGRADE_PX || autoH * viewport.s < DEGRADE_PX)
          // 方案 B:渲染尺寸超过缩略图分辨率(被放大)且浏览器可解码的静态图,叠加原图淡入(视口内才加载,控显存)
          const elig =
            !degraded &&
            origItems.has(item.id) &&
            !!asset &&
            BOARD_ORIG_EXTS.has(asset.ext) &&
            asset.width > 0 &&
            item.x + item.width > viewportRect.x &&
            item.x < viewportRect.x + viewportRect.w &&
            item.y + autoH > viewportRect.y &&
            item.y < viewportRect.y + viewportRect.h
          const origSrc = elig ? `${window.api.originalUrl(item.assetId!)}&e=${asset!.edited ?? 0}` : ''
          let placeholderColor = 'rgba(148,163,184,0.4)'
          if (degraded && asset) {
            try {
              const colors = JSON.parse(asset.colors ?? '[]') as unknown
              if (Array.isArray(colors) && colors.length > 0) {
                const first = colors[0] as number[] | undefined
                if (Array.isArray(first) && first.length >= 3) placeholderColor = `rgb(${first[0]},${first[1]},${first[2]})`
              }
            } catch {
              /* 主色解析失败用中性占位色 */
            }
          }
          const thumbSrc = asset ? assetThumbUrl(asset) : ''
          return (
            <BoardItemView
              key={item.id}
              item={item}
              api={itemApiRef}
              autoH={autoH}
              sel={sel}
              multiSelected={multiSelected}
              editing={editing}
              degraded={degraded}
              placeholderColor={placeholderColor}
              thumbSrc={thumbSrc}
              origSrc={origSrc}
              origLoaded={item.assetId != null && origLoaded.has(item.assetId)}
              alt={asset?.name ?? ''}
            />
          )
        })}

        {/* 智能吸附线：拖动命中时由 paintSnapLines 直改 style（进 state 会让整棵画布每帧重渲染）*/}
        {[0, 1, 2, 3].map((k) => (
          <div
            key={k}
            ref={(el) => {
              snapLinesRef.current[k] = el
            }}
            aria-hidden="true"
            data-snap-line
            className="pointer-events-none absolute"
            style={{ display: 'none', zIndex: 100001 }}
          />
        ))}

        {/* 多选时的组包围盒 + 8 向组缩放手柄（照抄 MOTZ group-selection）。
            拖动/缩放进行中由 groupBoxRef.style.display='none' 隐藏(不读 ref 做条件渲染) */}
        {multiSelected && selectionBBox && (
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
                  if (spaceDownRef.current) return
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

        {/* 参考线（对标 PureRef 参考辅助）：可拖动、右键删除。key 用稳定 id(旧数据按位置回退) */}
        {guides.map((g, i) =>
          g.horizontal ? (
            <div
              key={g.id ?? `guide-h-${g.y ?? 0}-${i}`}
              data-guide="h"
              data-guide-index={i}
              className="absolute cursor-ns-resize"
              style={{ left: -10000, top: g.y ?? 0, width: 20000, height: 0, borderTop: '1px dashed rgba(90,160,255,0.55)', zIndex: 50000 }}
              onPointerDown={(e) => startGuideDrag(i, g, e)}
              onPointerMove={onGuidePointerMove}
              onPointerUp={(e) => void onGuidePointerUp(e)}
              onPointerCancel={(e) => void onGuidePointerUp(e)}
              onContextMenu={(e) => openGuideMenu(e, i)}
            />
          ) : (
            <div
              key={g.id ?? `guide-v-${g.x ?? 0}-${i}`}
              data-guide="v"
              data-guide-index={i}
              className="absolute cursor-ew-resize"
              style={{ top: -10000, left: g.x ?? 0, height: 20000, width: 0, borderLeft: '1px dashed rgba(90,160,255,0.55)', zIndex: 50000 }}
              onPointerDown={(e) => startGuideDrag(i, g, e)}
              onPointerMove={onGuidePointerMove}
              onPointerUp={(e) => void onGuidePointerUp(e)}
              onPointerCancel={(e) => void onGuidePointerUp(e)}
              onContextMenu={(e) => openGuideMenu(e, i)}
            />
          )
        )}

      </div>

      {/* 空态必须留在屏幕坐标层，不能跟随持久化的画布 viewport 偏移。 */}
      {boardItems.length === 0 && (
        <div className="archive-board-empty pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <span className="archive-board-empty__eyebrow mono">{pixel ? 'ARCHIVE CANVAS / EMPTY' : cyber ? 'NODE CANVAS / NO SIGNAL' : 'LIGHT TABLE / EMPTY'}</span>
          <strong>{pixel ? '把素材编入视觉档案' : cyber ? '把素材接入信号矩阵' : '把参考素材送上看片台'}</strong>
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
          /* 菜单加了锁定/成组/图层/对齐后高度翻倍（note 元素那份实测 634px 内容 > 503px 可视）：
             按视口钳高并显式开启纵向滚动，否则底部命令永远点不到。
             modal-scroll 只定制滚动条外观、不设 overflow，所以 overflowY 必须自己写 */
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 190),
            top: Math.min(ctxMenu.y, Math.max(8, window.innerHeight - 460)),
            maxHeight: `calc(100vh - ${Math.max(16, ctxMenu.y)}px)`,
            overflowY: 'auto'
          }}
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
              {/* 锁定：锁住后不可拖动/缩放/删除，仍可选中以便解锁 */}
              <button
                aria-label={ctxItem.locked ? '解锁选中元素' : '锁定选中元素'}
                className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => void lockCtx(null)}
              >
                <Icon name={ctxItem.locked ? 'lock' : 'unlock'} size={12} />
                {ctxItem.locked ? '解锁' : '锁定'}
                {multiSelected && `（${selectedIds.length} 项）`}
              </button>
              {/* 成组 / 解组（组内成员一起选中、一起变换） */}
              {selectedIds.length >= 2 ? (
                <button
                  aria-label="成组"
                  className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                  onClick={() => void groupCtx()}
                >
                  <Icon name="group" size={12} />
                  成组（{selectedIds.length} 项）
                </button>
              ) : (
                ctxItem.groupId && (
                  <button
                    aria-label="解组"
                    className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                    onClick={() => void ungroupCtx()}
                  >
                    <Icon name="group" size={12} />
                    解组
                  </button>
                )
              )}
              {/* 对齐（对标 Figma）：以选区包围盒为基准，仅多选时出现 */}
              {multiSelected && (
                <div className="flex items-center gap-1 px-4 py-1.5">
                  <span className="mr-1 text-[10px] text-[var(--text-faint)]">对齐</span>
                  {(
                    [
                      ['left', '左对齐', 'alignLeft'],
                      ['hcenter', '水平居中', 'alignCenterH'],
                      ['right', '右对齐', 'alignRight'],
                      ['top', '顶对齐', 'alignTop'],
                      ['vcenter', '垂直居中', 'alignMiddle'],
                      ['bottom', '底对齐', 'alignBottom']
                    ] as const
                  ).map(([mode, label, icon]) => (
                    <button
                      key={mode}
                      aria-label={label}
                      title={label}
                      className="flex h-5 flex-1 cursor-pointer items-center justify-center rounded-sm border border-[var(--border)] text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
                      onClick={() => void alignCtx(mode)}
                    >
                      <Icon name={icon} size={12} />
                    </button>
                  ))}
                </div>
              )}
              {/* 图层顺序（对标 Figma）：四个图标按钮一行，避免菜单被撑长 */}
              <div className="flex items-center gap-1 px-4 py-1.5">
                <span className="mr-1 text-[10px] text-[var(--text-faint)]">图层</span>
                {(
                  [
                    ['front', '置顶', 'chevronUp'],
                    ['forward', '上移一层', 'arrowUp'],
                    ['backward', '下移一层', 'arrowDown'],
                    ['back', '置底', 'chevronDown']
                  ] as const
                ).map(([action, label, icon]) => (
                  <button
                    key={action}
                    aria-label={`图层${label}`}
                    title={label}
                    className="flex h-5 flex-1 cursor-pointer items-center justify-center rounded-sm border border-[var(--border)] text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
                    onClick={() => void reorderCtx(action)}
                  >
                    <Icon name={icon} size={12} />
                  </button>
                ))}
              </div>
              {ctxItem?.type === 'asset' && (
                <>
                  <button
                    className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                    onClick={() => void flipCtx('flipX')}
                  >
                    <Icon name="rotate" size={12} />
                    水平翻转{ctxItem.flipX ? ' ✓' : ''}
                  </button>
                  <button
                    className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                    onClick={() => void flipCtx('flipY')}
                  >
                    <Icon name="rotate" size={12} className="-scale-y-100" />
                    垂直翻转{ctxItem.flipY ? ' ✓' : ''}
                  </button>
                </>
              )}
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
                  <div className="mb-1 mt-2 text-[10px] text-[var(--text-faint)]">字号</div>
                  <select
                    aria-label="note 字号"
                    className="field-input w-full px-1.5 py-1 text-[11px]"
                    value={ctxItem.noteFontSize || 16}
                    onChange={(e) => void setNoteStyle({ noteFontSize: Number(e.target.value) })}
                  >
                    {NOTE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
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
          {multiSelected && selectedIdsRef.current.length >= 3 && (
            <>
              <button
                className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => void distributeCtx('h')}
              >
                水平等距分布选中
              </button>
              <button
                className="block w-full cursor-pointer px-4 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => void distributeCtx('v')}
              >
                垂直等距分布选中
              </button>
            </>
          )}
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

/* ==========================================================================
 * 元素子组件(memo + 稳定句柄)
 * 视口/选中/主题等父级变化时,未变更的元素直接跳过渲染。
 * 事件回调全部经 api ref 读取最新闭包,props 全为原始值(shallow 比较即可)。
 * ========================================================================== */

/** 画布元素子组件可用的事件句柄(每次渲染由父组件刷新为最新闭包,ref 身份稳定) */
interface BoardItemApi {
  itemEls: MutableRefObject<Map<string, HTMLElement>>
  onPointerDown: (e: React.PointerEvent, item: BoardItem, mode: 'move' | 'resize', dir?: ResizeDir) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => Promise<void>
  onClick: (item: BoardItem) => void
  onDoubleClick: (item: BoardItem) => void
  onContextMenu: (e: React.MouseEvent, item: BoardItem) => void
  onImgLoad: (item: BoardItem, e: React.SyntheticEvent<HTMLImageElement>) => void
  focusFrame: (target: EventTarget | null) => void
  spaceDownRef: MutableRefObject<boolean>
  setEditingNoteId: (id: string | null) => void
  onToolChange?: (tool: BoardTool) => void
  toolRef: MutableRefObject<BoardTool>
  pushHistory: () => void
  setSel: (ids: string[]) => void
  refreshBoardItems: (boardId: number) => Promise<void>
  boardIdRef: MutableRefObject<number | null>
  markOrigLoaded: (id: string) => void
}

interface BoardItemViewProps {
  item: BoardItem
  api: MutableRefObject<BoardItemApi>
  /** 有效高度(height=0 时按宽高比推算) */
  autoH: number
  sel: boolean
  multiSelected: boolean
  editing: boolean
  /** 视口降级:渲染尺寸过小时用色块占位,免除缩略图解码 */
  degraded: boolean
  placeholderColor: string
  /** 缩略图/故事板 URL(asset 类型) */
  thumbSrc: string
  /** 原图叠加层 URL('' = 不叠加;方案 B 放大高清) */
  origSrc: string
  /** 原图是否已加载完成(驱动淡入) */
  origLoaded: boolean
  alt: string
}

const BoardItemView = memo(function BoardItemView({
  item,
  api,
  autoH,
  sel,
  multiSelected,
  editing,
  degraded,
  placeholderColor,
  thumbSrc,
  origSrc,
  origLoaded,
  alt
}: BoardItemViewProps) {
  const a = api.current
  // 素材翻转（对标 PureRef 画师对照）:镜像缩略图/原图/占位块,外框与选中态不镜像
  const flipTransform =
    item.type === 'asset' && (item.flipX || item.flipY)
      ? `scale(${item.flipX ? -1 : 1}, ${item.flipY ? -1 : 1})`
      : undefined
  return (
    <div
      ref={(el) => {
        if (el) a.itemEls.current.set(item.id, el)
        else a.itemEls.current.delete(item.id)
      }}
      data-board-item={item.id}
      className="absolute select-none"
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.type === 'asset' ? autoH : item.height,
        zIndex: item.z,
        outline: editing
          ? '1px dashed var(--accent)'
          : sel
            ? '2px solid var(--accent)'
            : item.type === 'note'
              ? 'none'
              : '1px solid rgba(128,128,128,0.35)',
        outlineOffset: sel ? 1 : 0,
        cursor: 'move',
        background: 'transparent'
      }}
      onPointerDown={(e) => a.onPointerDown(e, item, 'move')}
      onPointerMove={a.onPointerMove}
      onPointerUp={(e) => void a.onPointerUp(e)}
      onPointerCancel={(e) => void a.onPointerUp(e)}
      onClick={(e) => {
        e.stopPropagation()
        a.onClick(item)
        if (item.type === 'note' && a.toolRef.current === 'note') {
          a.setEditingNoteId(item.id)
          a.onToolChange?.('select')
        }
      }}
      onDoubleClick={(e) => {
        if (item.type !== 'note') return
        e.stopPropagation()
        a.onDoubleClick(item)
      }}
      onContextMenu={(e) => a.onContextMenu(e, item)}
    >
      {item.type === 'asset' && thumbSrc !== '' ? (
        degraded ? (
          /* 降级:主色色块占位(无解码/绘制开销;透明度与元素一致) */
          <div data-degraded className="h-full w-full" style={{ background: placeholderColor, opacity: (item.opacity ?? 100) / 100, transform: flipTransform }} />
        ) : (
          <>
            {/* 视频也用 <img> 显示故事板四宫格(assetThumbUrl 对视频返回故事板 URL):
                <video> 无法解码静态图片,此前 mp4/webm/mov 在画布上显示为空白 */}
            <img
              src={thumbSrc}
              className="pointer-events-none h-full w-full object-cover"
              style={{ opacity: (item.opacity ?? 100) / 100, transform: flipTransform }}
              alt={alt}
              draggable={false}
              onLoad={(e) => a.onImgLoad(item, e)}
            />
            {origSrc !== '' && (
              <img
                data-board-orig
                src={origSrc}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                style={{
                  opacity: origLoaded ? (item.opacity ?? 100) / 100 : 0,
                  transition: 'opacity 150ms ease',
                  transform: flipTransform
                }}
                alt=""
                draggable={false}
                onLoad={() => a.markOrigLoaded(item.assetId!)}
                onError={() => a.markOrigLoaded(item.assetId!)}
              />
            )}
          </>
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
      ) : editing ? (
        <textarea
          data-board-text-editor
          aria-label="白板文字编辑"
          className="h-full w-full resize-none bg-transparent p-1 outline-none"
          style={{
            fontFamily: item.noteFont || undefined,
            color: item.noteColor || 'var(--text-main)',
            fontSize: item.noteFontSize || 16,
            lineHeight: 1.35,
            opacity: (item.opacity ?? 100) / 100
          }}
          placeholder="输入文字…"
          defaultValue={item.text}
          autoFocus
          onFocus={(event) => {
            const value = event.currentTarget.value
            event.currentTarget.setSelectionRange(value.length, value.length)
            const editor = event.currentTarget
            requestAnimationFrame(() => {
              const height = Math.max(item.height, editor.scrollHeight + 4)
              if (editor.parentElement) editor.parentElement.style.height = `${height}px`
            })
          }}
          onInput={(event) => {
            const editor = event.currentTarget
            const height = Math.max(item.height, editor.scrollHeight + 4)
            if (editor.parentElement) editor.parentElement.style.height = `${height}px`
          }}
          onBlur={(event) => {
            const value = event.currentTarget.value
            const height = Math.max(item.height, event.currentTarget.scrollHeight + 4)
            a.setEditingNoteId(null)
            if (!value.trim()) {
              a.pushHistory()
              a.setSel([])
              void window.api.deleteBoardItem(item.id).then(() => {
                if (a.boardIdRef.current != null) return a.refreshBoardItems(a.boardIdRef.current)
              })
            } else if (value !== item.text || height !== item.height) {
              a.pushHistory()
              void window.api.updateBoardItem(item.id, { text: value, height }).then(() => {
                if (a.boardIdRef.current != null) return a.refreshBoardItems(a.boardIdRef.current)
              })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter')) {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : (
        <div
          data-board-text-display
          className="h-full w-full whitespace-pre-wrap break-words p-1"
          style={{
            fontFamily: item.noteFont || undefined,
            color: item.noteColor || 'var(--text-main)',
            fontSize: item.noteFontSize || 16,
            lineHeight: 1.35,
            opacity: (item.opacity ?? 100) / 100
          }}
        >
          {item.text}
        </div>
      )}
      {/* 单选时的 8 向缩放手柄（照抄 MOTZ selection-handles） */}
      {/* 锁定标记：一眼看出哪些元素动不了（仍可选中以便解锁） */}
      {item.locked && (
        <span
          aria-label="已锁定"
          className="absolute -left-1 -top-1 z-[2] flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-[var(--accent)] text-[var(--on-accent)]"
        >
          <Icon name="lock" size={9} strokeWidth={2.2} />
        </span>
      )}
      {sel && !multiSelected && !editing && !item.locked && (
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
                if (a.spaceDownRef.current) return
                e.stopPropagation()
                e.preventDefault()
                a.focusFrame(e.target)
                a.onPointerDown(e, item, 'resize', handle)
              }}
              onPointerMove={a.onPointerMove}
              onPointerUp={(e) => void a.onPointerUp(e)}
              onPointerCancel={(e) => void a.onPointerUp(e)}
            />
          ))}
        </div>
      )}
    </div>
  )
})
