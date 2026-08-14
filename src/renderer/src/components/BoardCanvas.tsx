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
/** 框选拖拽超过该距离(画布坐标 px)才视为框选而非点击 */
const MARQUEE_THRESHOLD = 3

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
 * - 元素：图片/视频/文字；拖动/8 向手柄缩放/Delete 删除/点击置顶
 * - 右键菜单：元素（移除/排列）/ 空白（添加文本/排列）/ note（字体/颜色）
 * - onApiReady 暴露缩放控制给工具栏
 */
export default function BoardCanvas({ onApiReady }: { onApiReady?: (api: BoardCanvasApi) => void }) {
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
      // 空白处按下：开始框选（Shift=追加模式）
      const pt = canvasPointFromClient(e.clientX, e.clientY)
      marqueeRef.current = { startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y, additive: e.shiftKey, moved: false }
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
  const onPointerUp = () => {
    panRef.current = null
    setPanning(false)
    finishMarquee()
  }

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
      if (e.key === 'Delete' && selectedIdsRef.current.length > 0) {
        const ids = [...selectedIdsRef.current]
        setSel([])
        for (const id of ids) void window.api.deleteBoardItem(id)
        if (boardId != null) void refreshBoardItems(boardId)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !inInput) {
        e.preventDefault()
        setSel(boardItemsRef.current.map((i) => i.id))
      }
      if (e.key === 'Escape') {
        setCtxMenu(null)
        setGuideMenu(null)
        setSel([])
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
      for (const it of target) await window.api.deleteBoardItem(it.id)
      setSel([])
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
    const selected = ctxTarget()
    const target =
      selected.length > 0
        ? selected
        : boardItemsRef.current.filter((i) => i.type === 'asset') // 空白右键:排列全部素材
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
    const updates = target.map((it) => ({ id: it.id, patch }))
    await window.api.updateBoardItems(updates)
    if (boardId != null) await refreshBoardItems(boardId)
    setCtxMenu(null)
  }
  /** 批量设置透明度（对标 PureRef 参考图透明度对比） */
  const setOpacityCtx = async (opacity: number) => {
    const target = ctxTarget()
    if (target.length === 0) return
    const updates = target.map((it) => ({ id: it.id, patch: { opacity } }))
    await window.api.updateBoardItems(updates)
    if (boardId != null) await refreshBoardItems(boardId)
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
  const multiSelected = selectedIds.length > 1

  return (
    <div
      ref={frameRef}
      className="relative min-h-0 flex-1 overflow-hidden"
      style={{ cursor: panning ? 'grabbing' : spaceDown ? 'grab' : marquee ? 'crosshair' : 'default' }}
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
              ) : (
                <textarea
                  aria-label="白板文字"
                  className="h-full w-full resize-none bg-transparent p-1.5 text-[13px] outline-none"
                  style={{ fontFamily: item.noteFont || undefined, color: item.noteColor || 'var(--text-main)', opacity: (item.opacity ?? 100) / 100 }}
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

        {boardItems.length === 0 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
            <p className="text-[13px] text-[var(--text-faint)]">从左侧素材卡片发送/拖拽素材到这里,或右键添加文本</p>
          </div>
        )}
      </div>

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
