import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import type { SortBy } from '@renderer/stores/libraryStore'
import ColorWheel from './ColorWheel'
import DupeModal from './DupeModal'
import ConfirmDialog from './ConfirmDialog'
import Icon from './Icon'
import SegmentedControl from './ui/SegmentedControl'

const EXT_GROUPS = [
  { label: 'JPG', exts: ['jpg', 'jpeg'] },
  { label: 'PNG', exts: ['png'] },
  { label: 'GIF', exts: ['gif'] },
  { label: 'WebP', exts: ['webp'] },
  { label: 'SVG', exts: ['svg'] },
  { label: 'PSD', exts: ['psd', 'ai'] },
  { label: '视频', exts: ['mp4', 'webm', 'mov', 'mkv', 'avi'] },
  { label: '音频', exts: ['mp3', 'wav', 'ogg', 'flac'] },
  { label: '字体', exts: ['ttf', 'otf', 'ttc', 'woff', 'woff2'] }
]

/** Eagle 风格色环（12 色） */
const COLOR_WHEEL = [
  '#e53935', '#ff9800', '#ffeb3b', '#8bc34a',
  '#4caf50', '#009688', '#00bcd4', '#2196f3',
  '#3f51b5', '#9c27b0', '#e91e63', '#795548'
]

function Popover({
  open,
  onClose,
  children,
  width = 240,
  anchorRef
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  width?: number
  anchorRef: React.RefObject<HTMLDivElement | null>
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  // fixed 定位：工具栏 overflow-x:auto 会裁剪 absolute 弹层，必须逃出其溢出上下文
  useEffect(() => {
    if (open && anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect()
      const toolbarBottom = anchorRef.current.closest('.archive-filterbar')?.getBoundingClientRect().bottom ?? r.bottom
      setPos({
        x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        y: Math.max(r.bottom + 8, toolbarBottom + 6)
      })
    }
  }, [open, anchorRef, width])

  if (!open || !pos) return null
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[150]"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        className="anim-menu menu fixed z-[160] p-3.5"
        style={{ left: pos.x, top: pos.y, width }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  )
}

/** 格式筛选项（内联弹层与窄窗筛选面板共用） */
function FormatFilterSection({
  extFilters,
  toggleExtFilter,
  compact = false
}: {
  extFilters: string[]
  toggleExtFilter: (ext: string) => void
  compact?: boolean
}) {
  return (
    <>
      <div className={`grid gap-1.5 ${compact ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {EXT_GROUPS.map((g) => {
          const active = g.exts.some((e) => extFilters.includes(e))
          return (
            <button
              key={g.label}
              type="button"
              aria-pressed={active}
              className={`rounded-sm border px-2 py-1.5 text-left text-[12px] transition-colors duration-100 ${
                active
                  ? 'border-[var(--accent-deep)] bg-[var(--accent)] font-medium text-[var(--on-accent)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => g.exts.forEach((e) => toggleExtFilter(e))}
            >
              {g.label}
            </button>
          )
        })}
      </div>
      {extFilters.length > 0 && (
        <button
          className="btn-ghost mt-2.5 w-full"
          onClick={() => extFilters.forEach((e) => toggleExtFilter(e))}
        >
          清除格式筛选
        </button>
      )}
    </>
  )
}

/** 颜色筛选项：色环 + 常用色 + 容差/颜色数量（内联弹层与窄窗筛选面板共用） */
function ColorFilterSection({
  colorFilter,
  setColorFilter,
  colorCountMax,
  setColorCountMax,
  applyWheelColor,
  compact = false
}: {
  colorFilter: { hex: string; tolerance: number } | null
  setColorFilter: (value: { hex: string; tolerance: number } | null) => void
  colorCountMax: number
  setColorCountMax: (value: number) => void
  applyWheelColor: (hex: string) => void
  compact?: boolean
}) {
  return (
    <>
      <p className="section-title mb-2.5">色环取色（角度=色相，半径=饱和度）</p>
      <ColorWheel value={colorFilter?.hex} onChange={applyWheelColor} size={compact ? 160 : 200} />
      <div className="mt-2.5 grid grid-cols-6 gap-1.5">
        {COLOR_WHEEL.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`筛选颜色 ${c}`}
            aria-pressed={colorFilter?.hex === c}
            className="h-6 w-6 rounded-full border-2 transition-transform duration-100 hover:scale-110"
            style={{
              background: c,
              borderColor: colorFilter?.hex === c ? '#fff' : 'rgba(255,255,255,0.15)'
            }}
            onClick={() => setColorFilter(colorFilter?.hex === c ? null : { hex: c, tolerance: 45 })}
          />
        ))}
      </div>
      {colorFilter && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[12px] text-[var(--text-dim)]">
            <label htmlFor="color-tolerance">容差</label>
            <span className="tnum">{colorFilter.tolerance}%</span>
          </div>
          <input
            id="color-tolerance"
            type="range"
            min={10}
            max={100}
            value={colorFilter.tolerance}
            className="w-full"
            onChange={(e) => setColorFilter({ hex: colorFilter.hex, tolerance: Number(e.target.value) })}
          />
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-[12px] text-[var(--text-dim)]">
        <label htmlFor="color-count">颜色数量</label>
        <select
          id="color-count"
          className="field-input px-1.5 py-0.5 text-[11px]"
          value={colorCountMax}
          onChange={(e) => setColorCountMax(Number(e.target.value))}
        >
          <option value={0}>不限</option>
          <option value={1}>≤ 1（纯色/黑白）</option>
          <option value={2}>≤ 2</option>
          <option value={3}>≤ 3</option>
        </select>
      </div>
      {(colorFilter || colorCountMax > 0) && (
        <button
          className="btn-ghost mt-2.5 w-full"
          onClick={() => {
            setColorFilter(null)
            setColorCountMax(0)
          }}
        >
          清除颜色筛选
        </button>
      )}
    </>
  )
}

/** 星级筛选：窄窗面板里可选 1–5 星（常规模式仍保留一键切换 ★ 的紧凑按钮） */
function RatingFilterSection({
  starMin,
  setStarMin
}: {
  starMin: number
  setStarMin: (value: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`筛选 ${n} 星及以上`}
          aria-pressed={starMin === n}
          className={`border px-2 py-1 text-[12px] transition-colors duration-100 ${
            starMin === n
              ? 'border-[var(--amber)] bg-[var(--amber-soft)] font-medium text-[var(--amber)]'
              : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
          }`}
          onClick={() => setStarMin(starMin === n ? 0 : n)}
        >
          ★{n}+
        </button>
      ))}
      {starMin > 0 && (
        <button className="btn-ghost" onClick={() => setStarMin(0)}>
          不限
        </button>
      )}
    </div>
  )
}

/** 导入时间筛选项 */
function DateFilterSection({
  withinDays,
  setWithinDays,
  onSelect
}: {
  withinDays: number
  setWithinDays: (value: number) => void
  onSelect?: () => void
}) {
  const options = [
    { v: 0, label: '不限' },
    { v: 1, label: '今天' },
    { v: 7, label: '近 7 天' },
    { v: 30, label: '近 30 天' },
    { v: 90, label: '近 90 天' },
    { v: 365, label: '近一年' }
  ]
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={withinDays === o.v}
          className={`rounded-sm border px-2 py-1.5 text-left text-[12px] transition-colors duration-100 ${
            withinDays === o.v
              ? 'border-[var(--accent-deep)] bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]'
              : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
          }`}
          onClick={() => {
            setWithinDays(o.v)
            onSelect?.()
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 工具栏筛选按钮：小便签贴纸 */
function FilterButton({
  active,
  onClick,
  children,
  label
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  label: string
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`archive-filter flex items-center gap-1.5 whitespace-nowrap border px-2.5 py-1.5 text-[12px] tracking-[0.03em] transition-colors duration-100 ${
        active
          ? 'border-[var(--accent-deep)] bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]'
          : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function Toolbar() {
  const keyword = useLibraryStore((s) => s.keyword)
  const setKeyword = useLibraryStore((s) => s.setKeyword)
  const extFilters = useLibraryStore((s) => s.extFilters)
  const toggleExtFilter = useLibraryStore((s) => s.toggleExtFilter)
  const colorFilter = useLibraryStore((s) => s.colorFilter)
  const setColorFilter = useLibraryStore((s) => s.setColorFilter)
  const colorCountMax = useLibraryStore((s) => s.colorCountMax)
  const setColorCountMax = useLibraryStore((s) => s.setColorCountMax)
  const starMin = useLibraryStore((s) => s.starMin)
  const setStarMin = useLibraryStore((s) => s.setStarMin)
  const untagged = useLibraryStore((s) => s.untagged)
  const toggleUntagged = useLibraryStore((s) => s.toggleUntagged)
  const withinDays = useLibraryStore((s) => s.withinDays)
  const setWithinDays = useLibraryStore((s) => s.setWithinDays)
  const sortBy = useLibraryStore((s) => s.sortBy)
  const sortDesc = useLibraryStore((s) => s.sortDesc)
  const setSort = useLibraryStore((s) => s.setSort)
  const zoom = useLibraryStore((s) => s.zoom)
  const setZoom = useLibraryStore((s) => s.setZoom)
  const layout = useLibraryStore((s) => s.layout)
  const setLayout = useLibraryStore((s) => s.setLayout)
  const importDialog = useLibraryStore((s) => s.importDialog)
  const selection = useLibraryStore((s) => s.selection)
  const view = useLibraryStore((s) => s.view)
  const [openPanel, setOpenPanel] = useState<'format' | 'color' | 'sort' | 'date' | 'all' | null>(null)
  const formatRef = useRef<HTMLDivElement>(null)
  const colorRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  /** 筛选台窄窗模式：按容器实际宽度切换，避免侧栏/详情栏变化时误判 */
  const [compactBar, setCompactBar] = useState(false)
  const [dupeOpen, setDupeOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ type: 'deleteSel' | 'emptyTrash' } | null>(null)
  const colorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 860px 以下把格式/颜色/评分/日期收进「筛选」面板，保证 1024px 最小窗口里所有筛选可达。
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const update = () => setCompactBar(el.clientWidth > 0 && el.clientWidth < 860)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    // ResizeObserver 在窗口被遮挡/无头环境可能不派发；窗口 resize 是兜底路径
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  // 布局在常规/紧凑之间切换时，旧弹层的锚点可能已卸载，统一关闭。
  useEffect(() => {
    setOpenPanel(null)
  }, [compactBar])

  /** 当前生效的筛选 chips：常规/紧凑模式都显示，避免忘记还开着筛选 */
  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; swatch?: string; onClear: () => void }[] = []
    const covered = new Set<string>()
    EXT_GROUPS.forEach((group) => {
      const active = group.exts.filter((e) => extFilters.includes(e))
      if (active.length === 0) return
      active.forEach((e) => covered.add(e))
      chips.push({
        key: `ext-${group.label}`,
        label: group.label,
        onClear: () => active.forEach((e) => toggleExtFilter(e))
      })
    })
    extFilters
      .filter((e) => !covered.has(e))
      .forEach((e) =>
        chips.push({
          key: `ext-raw-${e}`,
          label: e.toUpperCase(),
          onClear: () => toggleExtFilter(e)
        })
      )
    if (colorFilter) {
      chips.push({
        key: 'color',
        label: `颜色 ${colorFilter.hex}`,
        swatch: colorFilter.hex,
        onClear: () => setColorFilter(null)
      })
    }
    if (colorCountMax > 0) {
      chips.push({
        key: 'color-count',
        label: `颜色数 ≤${colorCountMax}`,
        onClear: () => setColorCountMax(0)
      })
    }
    if (starMin > 0) {
      chips.push({ key: 'star', label: `≥${starMin}★`, onClear: () => setStarMin(0) })
    }
    if (untagged) {
      chips.push({ key: 'untagged', label: '未标', onClear: () => toggleUntagged() })
    }
    if (withinDays > 0) {
      chips.push({
        key: 'days',
        label: withinDays === 1 ? '今天' : `近 ${withinDays} 天`,
        onClear: () => setWithinDays(0)
      })
    }
    return chips
  }, [
    extFilters,
    colorFilter,
    colorCountMax,
    starMin,
    untagged,
    withinDays,
    toggleExtFilter,
    setColorFilter,
    setColorCountMax,
    setStarMin,
    toggleUntagged,
    setWithinDays
  ])

  const clearAllFilters = () => {
    const st = useLibraryStore.getState()
    st.extFilters.forEach((e) => st.toggleExtFilter(e))
    st.setColorFilter(null)
    st.setColorCountMax(0)
    st.setStarMin(0)
    if (st.untagged) st.toggleUntagged()
    st.setWithinDays(0)
  }


  /* ---------- AI 智能搜索 ---------- */
  const [aiMode, setAiMode] = useState(false)
  const [aiQuery, setAiQuery] = useState('')
  const [aiSearching, setAiSearching] = useState(false)
  const [aiProgressText, setAiProgressText] = useState('')
  const aiSearchInputRef = useRef<HTMLInputElement>(null)

  // 订阅搜索进度推送(卸载时退订)
  useEffect(
    () =>
      window.api.onAiSearchProgress((p) => {
        setAiProgressText(p.total > 1 ? `${p.phase} ${p.done}/${p.total}` : p.phase)
      }),
    []
  )

  /** 执行 AI 搜索 */
  const runAiSearch = async () => {
    const q = aiQuery.trim()
    if (!q || aiSearching) return
    setAiSearching(true)
    setAiProgressText('分析搜索词…')
    // 记录进行中的查询（结果回来时若 pending 已被清，说明用户已退出/切视图，丢弃结果）
    useLibraryStore.getState().setAiSearchPending(q)
    try {
      const results = await window.api.aiSearch(q)
      const st = useLibraryStore.getState()
      // pending 失效则丢弃（setAiSearchResults 内部校验），同时提示用户结果已丢弃
      st.setAiSearchResults(q, results)
      if (st.aiSearch !== null) {
        if (results.length === 0) {
          useLibraryStore.getState().showToast('AI 没有找到匹配的素材，换个说法试试')
        }
      }
    } catch (e) {
      useLibraryStore.getState().showToast(`AI 搜索失败：${(e as Error).message}`)
    } finally {
      setAiSearching(false)
      setAiProgressText('')
      // 清理 pending（若结果已应用，setAiSearchResults 已清；此处兜底）
      const st = useLibraryStore.getState()
      if (st.aiSearchPending !== null) st.setAiSearchPending(null)
    }
  }

  /** 切换 AI 搜索模式（退出时清结果恢复常规视图） */
  const toggleAiMode = () => {
    if (aiMode) {
      setAiMode(false)
      setAiProgressText('')
      useLibraryStore.getState().clearAiSearch()
    } else {
      setAiMode(true)
      // 聚焦输入框
      setTimeout(() => aiSearchInputRef.current?.focus(), 0)
    }
  }

  /** 一键 AI 智能处理：打开配置对话框 */
  const doAiProcess = async () => {
    useLibraryStore.getState().openAiDialog()
  }

  /** 色环拖动时防抖应用筛选 */
  const applyWheelColor = (hex: string) => {
    if (colorDebounceRef.current) clearTimeout(colorDebounceRef.current)
    colorDebounceRef.current = setTimeout(() => {
      const tol = useLibraryStore.getState().colorFilter?.tolerance ?? 40
      setColorFilter({ hex, tolerance: tol })
    }, 250)
  }

  const sortOptions: { key: SortBy; label: string }[] = [
    { key: 'imported', label: '导入时间' },
    { key: 'name', label: '名称' },
    { key: 'size', label: '文件大小' },
    { key: 'star', label: '评分' }
  ]

  return (
    <div className="archive-filterbar-wrap shrink-0">
      <div
        ref={barRef}
        className="archive-filterbar flex h-14 items-stretch overflow-hidden border-b border-[var(--border)] bg-[var(--bg-panel)]"
        onScroll={() => setOpenPanel(null)}
      >
      <div className="archive-filterbar__scroller flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-3">
      {/* 导入按钮 */}
      <button className="btn-primary flex items-center gap-1.5 whitespace-nowrap" onClick={() => void importDialog()}>
        <Icon name="import" size={14} strokeWidth={2.2} />
        导入
      </button>

      {/* 区域截图(对标 Eagle):隐藏主窗后框选屏幕任意区域入库 */}
      <button
        className={`btn-ghost flex items-center whitespace-nowrap ${compactBar ? 'px-2' : 'gap-1.5 px-2.5'}`}
        aria-label="区域截图"
        title="区域截图：框选屏幕任意区域导入素材库"
        onClick={() =>
          void window.api.screenshotStart().catch(() => useLibraryStore.getState().showToast('截图启动失败'))
        }
      >
        <Icon name="crop" size={15} strokeWidth={1.9} />
        {!compactBar && '截图'}
      </button>

      {/* 搜索 / AI 智能搜索 */}
      <div
        className={`archive-filterbar__search relative flex shrink ${
          compactBar ? 'w-32 min-w-[96px]' : 'w-48 min-w-[132px]'
        }`}
      >
        <Icon
          name={aiMode ? 'sparkles' : 'search'}
          size={13}
          className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ${
            aiMode ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'
          }`}
        />
        <input
          ref={aiSearchInputRef}
          aria-label={aiMode ? 'AI 智能搜索' : '搜索素材'}
          className={`min-w-0 flex-1 field-input pl-8 ${(aiMode ? aiQuery : keyword) ? 'pr-6' : 'pr-2'} ${aiMode ? 'border-[var(--accent)]' : ''}`}
          placeholder={aiMode ? '描述画面，如「暗黑城堡带雾」…' : '搜索名称或注释…'}
          value={aiMode ? aiQuery : keyword}
          onChange={(e) => (aiMode ? setAiQuery(e.target.value) : setKeyword(e.target.value))}
          onKeyDown={(e) => {
            if (aiMode && e.key === 'Enter') void runAiSearch()
            if (e.key === 'Escape') {
              // 搜索框聚焦时的 Esc 应作用于搜索本身:AI 退出 AI 模式;普通搜索清空关键词;
              // 无输入时失焦——不冒泡到 App 层(那里 Esc 是清选择/关预览,与搜索语境冲突)
              e.stopPropagation()
              if (aiMode) toggleAiMode()
              else if (keyword) setKeyword('')
              else aiSearchInputRef.current?.blur()
            }
          }}
        />
        {/* 清空按钮:有输入时显示,一键清空并保持焦点 */}
        {(aiMode ? aiQuery : keyword) !== '' && (
          <button
            aria-label={aiMode ? '清空 AI 搜索词' : '清空搜索'}
            title="清空"
            className="pointer-events-auto absolute right-[34px] top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[var(--text-faint)] transition-colors duration-100 hover:text-[var(--text-main)]"
            onClick={() => {
              if (aiMode) setAiQuery('')
              else setKeyword('')
              aiSearchInputRef.current?.focus()
            }}
          >
            <Icon name="close" size={9} />
          </button>
        )}
        <button
          aria-label={aiMode ? '退出 AI 搜索' : 'AI 智能搜索'}
          aria-pressed={aiMode}
          title={aiMode ? '退出 AI 搜索' : 'AI 智能搜索（自然语言找图）'}
          className={`archive-filterbar__search-mode flex h-[30px] w-8 shrink-0 items-center justify-center border transition-colors duration-100 ${
            aiMode
              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]'
          }`}
          onClick={toggleAiMode}
        >
          <Icon name={aiSearching ? 'rotate' : 'sparkles'} size={13} className={aiSearching ? 'animate-spin' : ''} />
        </button>
        {/* 进度行（搜索中显示） */}
        {aiMode && aiProgressText && (
          <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-0.5 text-[12px] text-[var(--accent-text)] shadow-sm">
            {aiProgressText}
          </div>
        )}
      </div>

      {/* 高频动作保持在搜索旁，不能被后面的筛选项挤出可视区 */}
      {view.type !== 'trash' && selection.length > 0 && (
        <button
          className={`archive-ai-action btn-ghost flex items-center whitespace-nowrap ${
            compactBar ? 'gap-1 px-2' : 'gap-1.5'
          }`}
          title={`AI 智能处理所选 ${selection.length} 个素材（改名+打标签）`}
          aria-label={`AI 智能处理所选 ${selection.length} 个素材`}
          onClick={() => void doAiProcess()}
        >
          <Icon name="sparkles" size={13} />
          {!compactBar && 'AI 处理'}
          <span className="mono tnum text-[11px]">{selection.length}</span>
        </button>
      )}

      {/* 窄窗筛选入口：格式/颜色/评分/日期/重复检查统一收进这里 */}
      {compactBar && (
        <div className="relative" ref={filterRef}>
          <FilterButton
            label="打开筛选面板"
            active={activeChips.length > 0}
            onClick={() => setOpenPanel(openPanel === 'all' ? null : 'all')}
          >
            <Icon name="filter" size={12} />
            筛选
            {activeChips.length > 0 && (
              <span className="mono tnum text-[11px]">{activeChips.length}</span>
            )}
          </FilterButton>
          <Popover
            open={openPanel === 'all'}
            onClose={() => setOpenPanel(null)}
            width={330}
            anchorRef={filterRef}
          >
            <div className="modal-scroll max-h-[64vh] space-y-4 overflow-y-auto pr-1">
              <section>
                <p className="section-title mb-2">排序</p>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="排序方式"
                    className="field-input flex-1 text-[12px]"
                    value={sortBy}
                    onChange={(e) => setSort(e.target.value as SortBy, sortDesc)}
                  >
                    {sortOptions.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-ghost whitespace-nowrap"
                    aria-label={sortDesc ? '切换为升序' : '切换为降序'}
                    onClick={() => setSort(sortBy, !sortDesc)}
                  >
                    {sortDesc ? '降序' : '升序'}
                  </button>
                </div>
              </section>
              <section className="border-t border-[var(--border)] pt-3">
                <p className="section-title mb-2">格式</p>
                <FormatFilterSection extFilters={extFilters} toggleExtFilter={toggleExtFilter} compact />
              </section>
              <section className="border-t border-[var(--border)] pt-3">
                <p className="section-title mb-2">颜色</p>
                <ColorFilterSection
                  colorFilter={colorFilter}
                  setColorFilter={setColorFilter}
                  colorCountMax={colorCountMax}
                  setColorCountMax={setColorCountMax}
                  applyWheelColor={applyWheelColor}
                  compact
                />
              </section>
              <section className="border-t border-[var(--border)] pt-3">
                <p className="section-title mb-2">评分</p>
                <RatingFilterSection starMin={starMin} setStarMin={setStarMin} />
              </section>
              <section className="border-t border-[var(--border)] pt-3">
                <p className="section-title mb-2">导入时间</p>
                <DateFilterSection withinDays={withinDays} setWithinDays={setWithinDays} />
              </section>
              <section className="border-t border-[var(--border)] pt-3">
                <p className="section-title mb-2">其他</p>
                <div className="flex flex-wrap gap-2">
                  <FilterButton
                    label="只看未打标签的素材"
                    active={untagged}
                    onClick={toggleUntagged}
                  >
                    未标
                  </FilterButton>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setOpenPanel(null)
                      setDupeOpen(true)
                    }}
                  >
                    重复素材检查
                  </button>
                </div>
              </section>
              <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
                <button
                  className="btn-ghost"
                  disabled={activeChips.length === 0}
                  onClick={clearAllFilters}
                >
                  清除全部
                </button>
                <button className="btn-primary" onClick={() => setOpenPanel(null)}>
                  完成
                </button>
              </div>
            </div>
          </Popover>
        </div>
      )}

      {!compactBar && (
        <>
      {/* 格式筛选 */}
      <div className="relative" ref={formatRef}>
        <FilterButton
          label="按格式筛选"
          active={extFilters.length > 0}
          onClick={() => setOpenPanel(openPanel === 'format' ? null : 'format')}
        >
          格式{extFilters.length > 0 ? ` (${extFilters.length})` : ''}
        </FilterButton>
        <Popover open={openPanel === 'format'} onClose={() => setOpenPanel(null)} width={230} anchorRef={formatRef}>
          <p className="section-title mb-2.5">按格式筛选</p>
          <FormatFilterSection extFilters={extFilters} toggleExtFilter={toggleExtFilter} />
        </Popover>
      </div>

      {/* 颜色筛选 */}
      <div className="relative" ref={colorRef}>
        <FilterButton
          label="按颜色筛选"
          active={!!colorFilter}
          onClick={() => setOpenPanel(openPanel === 'color' ? null : 'color')}
        >
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full border border-[var(--border-strong)]"
            style={{ background: colorFilter?.hex ?? 'transparent' }}
          />
          颜色
        </FilterButton>
        <Popover open={openPanel === 'color'} onClose={() => setOpenPanel(null)} width={290} anchorRef={colorRef}>
          <ColorFilterSection
            colorFilter={colorFilter}
            setColorFilter={setColorFilter}
            colorCountMax={colorCountMax}
            setColorCountMax={setColorCountMax}
            applyWheelColor={applyWheelColor}
          />
        </Popover>
      </div>

      {/* 星级筛选 */}
      <FilterButton
        label="按星级筛选"
        active={starMin > 0}
        onClick={() => setStarMin(starMin > 0 ? 0 : 1)}
      >
        <span className={starMin > 0 ? '' : 'text-[var(--text-faint)]'}>★</span>
        {starMin > 0 ? `${starMin}+` : ''}
      </FilterButton>

      {/* 未标注筛选 */}
      <FilterButton label="只看未打标签的素材" active={untagged} onClick={toggleUntagged}>
        未标
      </FilterButton>

      {/* 导入时间筛选 */}
      <div className="relative" ref={dateRef}>
        <FilterButton
          label="按导入时间筛选"
          active={withinDays > 0}
          onClick={() => setOpenPanel(openPanel === 'date' ? null : 'date')}
        >
          日期{withinDays > 0 ? ` · ${withinDays}天` : ''}
        </FilterButton>
        <Popover open={openPanel === 'date'} onClose={() => setOpenPanel(null)} width={170} anchorRef={dateRef}>
          <DateFilterSection
            withinDays={withinDays}
            setWithinDays={setWithinDays}
            onSelect={() => setOpenPanel(null)}
          />
        </Popover>
      </div>

      {/* 排序 */}
      <div className="relative" ref={sortRef}>
        <FilterButton
          label="排序方式"
          active={false}
          onClick={() => setOpenPanel(openPanel === 'sort' ? null : 'sort')}
        >
          {sortOptions.find((o) => o.key === sortBy)?.label}
          <Icon name={sortDesc ? 'arrowDown' : 'arrowUp'} size={12} />
        </FilterButton>
        <Popover open={openPanel === 'sort'} onClose={() => setOpenPanel(null)} width={170} anchorRef={sortRef}>
          {sortOptions.map((o) => (
            <button
              key={o.key}
              role="menuitem"
              className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)] ${
                sortBy === o.key ? 'font-semibold text-[var(--accent-text)]' : ''
              }`}
              onClick={() => {
                if (sortBy === o.key) setSort(o.key, !sortDesc)
                else setSort(o.key, true)
                setOpenPanel(null)
              }}
            >
              {o.label}
              {sortBy === o.key && (
                <Icon name={sortDesc ? 'arrowDown' : 'arrowUp'} size={12} />
              )}
            </button>
          ))}
        </Popover>
      </div>

      <button
        className="btn-ghost flex items-center gap-1.5 whitespace-nowrap px-2.5"
        aria-label="扫描相似或重复图片"
        title="重复素材检查"
        onClick={() => setDupeOpen(true)}
      >
        <Icon name="duplicateSearch" size={17} strokeWidth={1.9} />
      </button>
        </>
      )}

      {/* 批量操作（回收站视图，纯图标按钮） */}
      {view.type === 'trash' && selection.length > 0 && (
        <button
          className="btn-ghost flex items-center gap-1 px-2"
          title={`恢复所选（${selection.length} 个）`}
          aria-label={`恢复所选 ${selection.length} 个素材`}
          onClick={() => void useLibraryStore.getState().restoreSelection()}
        >
          <Icon name="rotate" size={14} />
          <span className="mono tnum text-[11px]">{selection.length}</span>
        </button>
      )}
      {view.type === 'trash' && selection.length > 0 && (
        <button
          className="btn-danger flex items-center px-2"
          title="永久删除所选"
          aria-label="永久删除所选素材"
          onClick={() => setConfirm({ type: 'deleteSel' })}
        >
          <Icon name="trash" size={14} />
        </button>
      )}
      {view.type === 'trash' && (
        <button
          className="btn-danger-solid flex items-center px-2"
          title="清空回收站"
          aria-label="清空回收站"
          onClick={() => setConfirm({ type: 'emptyTrash' })}
        >
          <Icon name="trash" size={14} />
        </button>
      )}

      </div>

      {/* 布局切换 */}
      <div className="archive-filterbar__fixed flex shrink-0 items-center gap-2 px-3">
      <SegmentedControl
        label="布局切换"
        value={layout}
        options={[
          { value: 'masonry', icon: 'masonry', label: '瀑布流' },
          { value: 'grid', icon: 'grid', label: '网格' },
          { value: 'list', icon: 'listRows', label: '列表' }
        ]}
        onChange={(value) => setLayout(value)}
      />

      {/* 缩略图大小 */}
      <div className="flex items-center gap-2 pl-1 text-[var(--text-dim)]">
        <Icon name="grid" size={13} className="text-[var(--text-faint)]" />
        <input
          aria-label="缩略图大小"
          type="range"
          min={1}
          max={6}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-16"
        />
      </div>
      </div>

      </div>

      {/* 生效筛选条：常规/紧凑模式共用，避免忘记还开着筛选 */}
      {activeChips.length > 0 && (
        <div className="archive-filterbar__chips flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-1.5">
          <span className="mono text-[10px] tracking-[0.14em] text-[var(--text-faint)]">FILTER</span>
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              className="flex items-center gap-1 border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] transition-colors duration-100 hover:border-[var(--border-strong)] hover:text-[var(--text-main)]"
              aria-label={`清除筛选 ${chip.label}`}
              title={`清除筛选：${chip.label}`}
              onClick={chip.onClear}
            >
              {chip.swatch && (
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--border-strong)]"
                  style={{ background: chip.swatch }}
                />
              )}
              {chip.label}
              <Icon name="close" size={9} className="text-[var(--text-faint)]" />
            </button>
          ))}
          <button
            className="ml-auto text-[11px] text-[var(--accent-text)] underline-offset-2 hover:underline"
            onClick={clearAllFilters}
          >
            清除全部
          </button>
        </div>
      )}

      {dupeOpen && createPortal(<DupeModal onClose={() => setDupeOpen(false)} />, document.body)}

      {confirm?.type === 'deleteSel' && createPortal((
        <ConfirmDialog
          title="永久删除所选素材？"
          message={`将永久删除 ${selection.length} 个素材及其文件，此操作无法撤销。`}
          confirmLabel="永久删除"
          onConfirm={() => useLibraryStore.getState().deleteSelection(true)}
          onClose={() => setConfirm(null)}
        />
      ), document.body)}
      {confirm?.type === 'emptyTrash' && createPortal((
        <ConfirmDialog
          title="清空回收站？"
          message="回收站中的所有素材将被永久删除，此操作无法撤销。"
          confirmLabel="清空回收站"
          onConfirm={() => useLibraryStore.getState().emptyTrash()}
          onClose={() => setConfirm(null)}
        />
      ), document.body)}
    </div>
  )
}
