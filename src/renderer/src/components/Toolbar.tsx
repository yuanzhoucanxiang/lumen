import { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import type { SortBy } from '@renderer/stores/libraryStore'
import ColorWheel from './ColorWheel'
import DupeModal from './DupeModal'
import ConfirmDialog from './ConfirmDialog'
import Icon from './Icon'

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
      setPos({
        x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        y: r.bottom + 8
      })
    }
  }, [open, anchorRef, width])

  if (!open || !pos) return null
  return (
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
    </>
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
      className={`flex items-center gap-1.5 whitespace-nowrap border px-2.5 py-1.5 text-[12px] tracking-[0.03em] transition-colors duration-100 ${
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
  const [openPanel, setOpenPanel] = useState<'format' | 'color' | 'sort' | 'date' | null>(null)
  const formatRef = useRef<HTMLDivElement>(null)
  const colorRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const [dupeOpen, setDupeOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ type: 'deleteSel' | 'emptyTrash' } | null>(null)
  const colorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    <div
      className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--bg-panel)] px-3"
      onScroll={() => setOpenPanel(null)}
    >
      {/* 导入按钮 */}
      <button className="btn-primary flex items-center gap-1.5 whitespace-nowrap" onClick={() => void importDialog()}>
        <Icon name="import" size={14} strokeWidth={2.2} />
        导入
      </button>

      {/* 搜索 */}
      <div className="relative w-56 min-w-[110px] shrink">
        <Icon
          name="search"
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
        />
        <input
          aria-label="搜索素材"
          className="field-input w-full pl-8"
          placeholder="搜索名称或注释…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

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
          <div className="grid grid-cols-2 gap-1.5">
            {EXT_GROUPS.map((g) => {
              const active = g.exts.some((e) => extFilters.includes(e))
              return (
                <button
                  key={g.label}
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
          <p className="section-title mb-2.5">色环取色（角度=色相，半径=饱和度）</p>
          <ColorWheel value={colorFilter?.hex} onChange={applyWheelColor} size={200} />
          <div className="mt-2.5 grid grid-cols-6 gap-1.5">
            {COLOR_WHEEL.map((c) => (
              <button
                key={c}
                aria-label={`筛选颜色 ${c}`}
                aria-pressed={colorFilter?.hex === c}
                className="h-6 w-6 rounded-full border-2 transition-transform duration-100 hover:scale-110"
                style={{
                  background: c,
                  borderColor: colorFilter?.hex === c ? '#fff' : 'rgba(255,255,255,0.15)'
                }}
                onClick={() =>
                  setColorFilter(colorFilter?.hex === c ? null : { hex: c, tolerance: 45 })
                }
              />
            ))}
          </div>
          {colorFilter && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-[var(--text-dim)]">
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
                onChange={(e) =>
                  setColorFilter({ hex: colorFilter.hex, tolerance: Number(e.target.value) })
                }
              />
            </div>
          )}
          <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--text-dim)]">
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
        未标注
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
        <Popover open={openPanel === 'date'} onClose={() => setOpenPanel(null)} width={150} anchorRef={dateRef}>
          {[
            { v: 0, label: '不限' },
            { v: 1, label: '今天' },
            { v: 7, label: '近 7 天' },
            { v: 30, label: '近 30 天' },
            { v: 90, label: '近 90 天' },
            { v: 365, label: '近一年' }
          ].map((o) => (
            <button
              key={o.v}
              role="menuitem"
              className={`block w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)] ${
                withinDays === o.v ? 'font-semibold text-[var(--accent-text)]' : ''
              }`}
              onClick={() => {
                setWithinDays(o.v)
                setOpenPanel(null)
              }}
            >
              {o.label}
            </button>
          ))}
        </Popover>
      </div>

      {/* 排序 */}
      <div className="relative" ref={sortRef}>
        <FilterButton
          label="排序方式"
          active={false}
          onClick={() => setOpenPanel(openPanel === 'sort' ? null : 'sort')}
        >
          排序: {sortOptions.find((o) => o.key === sortBy)?.label}
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

      <div className="flex-1" />

      <button
        className="btn-ghost flex items-center gap-1.5 whitespace-nowrap"
        title="扫描相似/重复图片"
        onClick={() => setDupeOpen(true)}
      >
        <Icon name="copy" size={13} />
        查重
      </button>

      {/* 一键 AI 智能处理（选中素材后可直接点，不用进右键菜单） */}
      {view.type !== 'trash' && selection.length > 0 && (
        <button
          className="btn-ghost flex items-center gap-1.5 whitespace-nowrap"
          title={`AI 智能处理所选 ${selection.length} 个素材（改名+打标签）`}
          onClick={() => void doAiProcess()}
        >
          <Icon name="sparkles" size={13} />
          AI 处理
          <span className="mono tnum text-[10px]">{selection.length}</span>
        </button>
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
          <span className="mono tnum text-[10px]">{selection.length}</span>
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

      {/* 布局切换 */}
      <div className="flex items-center border border-[var(--border)]" role="group" aria-label="布局切换">
        {(
          [
            { k: 'masonry', icon: 'masonry', label: '瀑布流' },
            { k: 'grid', icon: 'grid', label: '网格' },
            { k: 'list', icon: 'listRows', label: '列表' }
          ] as const
        ).map((o) => (
          <button
            key={o.k}
            aria-label={o.label}
            aria-pressed={layout === o.k}
            title={o.label}
            className={`flex h-7 w-7 items-center justify-center transition-colors duration-100 ${
              layout === o.k
                ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
            }`}
            onClick={() => setLayout(o.k)}
          >
            <Icon name={o.icon} size={13} />
          </button>
        ))}
      </div>

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
          className="w-24"
        />
      </div>

      {dupeOpen && <DupeModal onClose={() => setDupeOpen(false)} />}

      {confirm?.type === 'deleteSel' && (
        <ConfirmDialog
          title="永久删除所选素材？"
          message={`将永久删除 ${selection.length} 个素材及其文件，此操作无法撤销。`}
          confirmLabel="永久删除"
          onConfirm={() => useLibraryStore.getState().deleteSelection(true)}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.type === 'emptyTrash' && (
        <ConfirmDialog
          title="清空回收站？"
          message="回收站中的所有素材将被永久删除，此操作无法撤销。"
          confirmLabel="清空回收站"
          onConfirm={() => useLibraryStore.getState().emptyTrash()}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
