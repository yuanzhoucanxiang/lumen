import { useEffect, useMemo, useRef, useState } from 'react'
import { assetEditable, assetStoryboardUrl, assetThumbUrl, useLibraryStore, zoomToWidth } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import PixelArt from './PixelArt'
import ScrambleText from './ScrambleText'
import ConfirmDialog from './ConfirmDialog'
import ExportDialog from './ExportDialog'
import type { IconName } from './Icon'
import type { Asset } from '@shared/types'

const GAP = 14
const LABEL_H = 26
const LIST_ROW_H = 40
const HOVER_PREVIEW_DELAY = 420
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'm4v'])

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** 卡片/列表行通用的拖拽起点 */
function onAssetDragStart(e: React.DragEvent, a: Asset): void {
  const s = useLibraryStore.getState()
  const ids = s.selection.includes(a.id) ? s.selection : [a.id]
  e.dataTransfer.setData('application/x-eaglelike-assets', JSON.stringify(ids))
  e.dataTransfer.effectAllowed = 'copy'
}

const KIND_ICON: Record<string, IconName> = {
  video: 'film',
  audio: 'music',
  svg: 'shapes',
  psd: 'palette',
  ai: 'palette',
  ttf: 'type',
  otf: 'type',
  ttc: 'type',
  woff: 'type',
  woff2: 'type',
  other: 'file'
}

interface LayoutItem {
  a: Asset
  x: number
  y: number
  w: number
  h: number
}

interface ItemProps {
  item: LayoutItem
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

/** 列表模式行 */
function ListRow({ item, selected, onClick, onDoubleClick, onContextMenu }: ItemProps) {
  const { a } = item
  const thumb = assetThumbUrl(a)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={a.name}
      aria-pressed={selected}
      className={`group absolute flex cursor-pointer items-center gap-2.5 border-b border-[var(--border)] px-2 transition-colors duration-100 focus-visible:outline-1 focus-visible:outline-[var(--ring)] ${
        selected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-hover)]'
      }`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
      draggable
      onDragStart={(e) => onAssetDragStart(e, a)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDoubleClick()
        if (e.key === ' ') {
          e.preventDefault()
          onClick(e as unknown as React.MouseEvent)
        }
      }}
    >
      {selected && (
        <span aria-hidden="true" className="absolute left-0 top-0 h-full w-[2px] bg-[var(--accent)]" />
      )}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden bg-[#0d0f12]">
        {thumb ? (
          <img src={thumb} loading="lazy" draggable={false} className="h-full w-full object-cover" alt="" />
        ) : (
          <Icon name={KIND_ICON[a.ext] ?? KIND_ICON.other} size={14} className="text-[var(--text-faint)]" />
        )}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[12px] ${selected ? 'text-[var(--accent-text)]' : ''}`}>
        {a.name}
      </span>
      <span className="w-14 shrink-0 text-[11px] text-[var(--amber)]">
        {a.star > 0 ? '★'.repeat(a.star) : ''}
      </span>
      <span className="mono w-12 shrink-0 text-[10px] uppercase text-[var(--text-faint)]">.{a.ext}</span>
      {a.width > 0 && (
        <span className="mono tnum w-20 shrink-0 text-[11px] text-[var(--text-faint)]">
          {a.width} × {a.height}
        </span>
      )}
      <span className="mono tnum w-16 shrink-0 text-right text-[11px] text-[var(--text-faint)]">
        {fmtSize(a.size)}
      </span>
    </div>
  )
}

function AssetCard({
  item,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onHoverStart,
  onHoverEnd
}: {
  item: LayoutItem
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onHoverStart: (a: Asset, el: HTMLElement) => void
  onHoverEnd: () => void
}) {
  const { a } = item
  const [thumbErr, setThumbErr] = useState(false)
  const [thumbFallback, setThumbFallback] = useState(false)
  // 视频：优先故事板封面，故事板缺失(短视频)时回退到首帧缩略图；再失败才显示图标
  const thumb = thumbErr
    ? ''
    : thumbFallback
      ? `${window.api.thumbnailUrl(a.id)}&e=${a.edited ?? 0}`
      : assetThumbUrl(a)
  const imgH = item.h - LABEL_H
  const setStar = async (star: number) => {
    await window.api.updateAsset(a.id, { star })
    useLibraryStore.getState().updateAssetLocal(a.id, { star })
  }
  // 发送到白板（照抄 MOTZ send-chip）：已发送显示 ✓,点击提示已在并选中画布元素
  const boardSent = useLibraryStore((s) => s.boardItems.some((i) => i.assetId === a.id))
  const sendToBoard = async () => {
    const st = useLibraryStore.getState()
    if (st.activeBoardId == null) {
      st.showToast('请先新建白板（白板面板右侧 + 号）')
      return
    }
    const ids = st.selection.includes(a.id) && st.selection.length > 1 ? st.selection : [a.id]
    const existingIds = await st.sendAssetsToBoard(ids)
    st.showToast(
      existingIds.length > 0
        ? ids.length > 1
          ? '选中的素材已在当前白板中'
          : '这个素材已在当前白板中'
        : ids.length > 1
          ? `已发送 ${ids.length} 张到当前白板`
          : '已发送到当前白板'
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={a.name}
      aria-pressed={selected}
      className="group absolute cursor-pointer focus-visible:outline-1 focus-visible:outline-[var(--ring)]"
      style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
      draggable
      onDragStart={(e) => onAssetDragStart(e, a)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={(e) => onHoverStart(a, e.currentTarget)}
      onMouseLeave={onHoverEnd}
      onDragStartCapture={onHoverEnd}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDoubleClick()
        if (e.key === ' ') {
          e.preventDefault()
          onClick(e as unknown as React.MouseEvent)
        }
      }}
    >
      <div
        className={`relative flex h-full flex-col border bg-[var(--bg-panel)] transition-colors duration-150 ${
          selected
            ? 'border-[var(--accent)]'
            : 'border-[var(--border)] group-hover:border-[var(--border-strong)]'
        }`}
      >
        {selected && <span aria-hidden="true" className="ticks" />}

        {/* 图像区 */}
        <div className="scanlines relative flex items-center justify-center overflow-hidden bg-[#0d0f12]" style={{ height: imgH }}>
          {thumb ? (
            <img
              src={thumb}
              loading="lazy"
              draggable={false}
              className="glitch-once h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
              alt={a.name}
              onError={() => {
                // 视频故事板不存在(短视频)时回退到首帧缩略图
                if (VIDEO_EXTS.has(a.ext) && !thumbFallback) setThumbFallback(true)
                else setThumbErr(true)
              }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-[var(--text-faint)]">
              <Icon name={KIND_ICON[a.ext] ?? KIND_ICON.other} size={32} strokeWidth={1.4} />
              <span className="mono text-[9px] uppercase tracking-[0.2em]">.{a.ext}</span>
            </div>
          )}

          {/* 发送到白板（照抄 MOTZ send-chip,右下角,避开右上选中角标与底部星级栏） */}
          <button
            aria-label={boardSent ? `${a.name} 已在当前白板` : `发送 ${a.name} 到白板`}
            title={boardSent ? '已在当前白板' : '发送到当前白板'}
            className={`absolute bottom-1.5 right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-sm border transition-colors duration-100 ${
              boardSent
                ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]'
                : 'border-white/25 bg-black/50 text-white/70 opacity-0 hover:border-[var(--accent)] hover:text-[var(--accent)] group-hover:opacity-100'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              void sendToBoard()
            }}
          >
            <Icon name={boardSent ? 'check' : 'import'} size={10} strokeWidth={2.5} />
          </button>

          {/* 选中角标：青色方块 */}
          {selected && (
            <span
              aria-hidden="true"
              className="pixel-corners-sm absolute right-1.5 top-1.5 flex h-[18px] w-[18px] items-center justify-center bg-[var(--accent)] text-[var(--on-accent)]"
            >
              <Icon name="check" size={11} strokeWidth={3} />
            </span>
          )}

          {/* 星级快捷操作 */}
          <div
            className={`absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-0.5 bg-black/70 px-1.5 py-[3px] transition-opacity duration-150 ${
              a.star > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-label={`评分 ${n} 星`}
                className={`text-[10px] leading-none transition-colors duration-100 ${
                  n <= a.star ? 'text-[var(--amber)]' : 'text-white/25 hover:text-white/80'
                }`}
                onClick={() => void setStar(n === a.star ? 0 : n)}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        {/* 名称行 */}
        <div
          className={`mono flex items-center justify-center truncate px-1.5 text-[11px] tracking-[0.04em] transition-colors duration-150 ${
            selected ? 'text-[var(--accent-text)]' : 'text-[var(--text-dim)] group-hover:text-[var(--text-main)]'
          }`}
          style={{ height: LABEL_H }}
          title={a.name}
        >
          {a.name}
        </div>
      </div>
    </div>
  )
}

export default function Gallery() {
  const assets = useLibraryStore((s) => s.assets)
  const loading = useLibraryStore((s) => s.loading)
  const zoom = useLibraryStore((s) => s.zoom)
  const selection = useLibraryStore((s) => s.selection)
  const toggleSelect = useLibraryStore((s) => s.toggleSelect)
  const selectRange = useLibraryStore((s) => s.selectRange)
  const setSelection = useLibraryStore((s) => s.setSelection)
  const openPreview = useLibraryStore((s) => s.openPreview)
  const layoutMode = useLibraryStore((s) => s.layout)
  const similarTo = useLibraryStore((s) => s.similarTo)
  const setSimilarTo = useLibraryStore((s) => s.setSimilarTo)
  const aiSearch = useLibraryStore((s) => s.aiSearch)
  const clearAiSearch = useLibraryStore((s) => s.clearAiSearch)
  const view = useLibraryStore((s) => s.view)
  const folders = useLibraryStore((s) => s.folders)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  /** 导出对话框的素材范围 */
  const [exportIds, setExportIds] = useState<string[] | null>(null)
  const [hoverPv, setHoverPv] = useState<{ a: Asset; x: number; y: number } | null>(null)
  const [revertId, setRevertId] = useState<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 悬停放大预览：延迟触发，贴近卡片右侧（空间不足换左侧） */
  const startHover = (a: Asset, el: HTMLElement) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    const rect = el.getBoundingClientRect()
    hoverTimer.current = setTimeout(() => {
      const W = 288
      const H = 320
      let x = rect.right + 12
      if (x + W > window.innerWidth - 8) x = Math.max(8, rect.left - W - 12)
      const y = Math.max(8, Math.min(rect.top + rect.height / 2 - H / 2, window.innerHeight - H - 8))
      setHoverPv({ a, x, y })
    }, HOVER_PREVIEW_DELAY)
  }
  const endHover = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    setHoverPv(null)
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)

  // 监听容器尺寸（依赖 assets.length：空态分支不挂载容器，加载完成后需重新绑定）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setContainerW(el.clientWidth - 32) // 左右 padding
      setViewportH(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [assets.length === 0])

  // 布局计算：列表（整行）/ 网格（等高格）/ 瀑布流（最短列优先）
  const layout = useMemo<LayoutItem[]>(() => {
    if (containerW <= 0 || assets.length === 0) return []
    const targetW = zoomToWidth(zoom)

    if (layoutMode === 'list') {
      return assets.map((a, i) => ({ a, x: 0, y: i * LIST_ROW_H, w: containerW, h: LIST_ROW_H }))
    }

    const cols = Math.max(1, Math.floor((containerW + GAP) / (targetW + GAP)))
    const colW = (containerW - GAP * (cols - 1)) / cols

    if (layoutMode === 'grid') {
      const cellH = colW + LABEL_H
      return assets.map((a, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        return { a, x: col * (colW + GAP), y: row * (cellH + GAP), w: colW, h: cellH }
      })
    }

    const colHeights = new Array<number>(cols).fill(0)
    const items: LayoutItem[] = []
    for (const a of assets) {
      const ratio = a.width > 0 && a.height > 0 ? a.width / a.height : 1
      let imgH = colW / ratio
      imgH = Math.min(Math.max(imgH, colW * 0.35), colW * 1.8)
      const h = imgH + LABEL_H
      // 找最短列
      let col = 0
      for (let i = 1; i < cols; i++) {
        if (colHeights[i] < colHeights[col]) col = i
      }
      items.push({
        a,
        x: col * (colW + GAP),
        y: colHeights[col],
        w: colW,
        h
      })
      colHeights[col] += h + GAP
    }
    return items
  }, [assets, containerW, zoom, layoutMode])

  const totalH = useMemo(() => {
    let max = 0
    for (const it of layout) max = Math.max(max, it.y + it.h)
    return max
  }, [layout])

  // 虚拟滚动：只渲染视口附近的项
  const visible = useMemo(() => {
    const top = scrollTop - 600
    const bottom = scrollTop + viewportH + 600
    return layout.filter((it) => it.y + it.h > top && it.y < bottom)
  }, [layout, scrollTop, viewportH])

  const contextAsset = useMemo(
    () => (menu ? assets.find((a) => a.id === menu.id) : null),
    [menu, assets]
  )
  const normalFolders = folders.filter((f) => !f.isSmart)

  const doDelete = async () => {
    const s = useLibraryStore.getState()
    const ids = selection.includes(menu!.id) ? selection : [menu!.id]
    s.setSelection(ids)
    await s.deleteSelection(view.type === 'trash')
    setMenu(null)
  }

  const doAddToFolder = async (folderId: number) => {
    const s = useLibraryStore.getState()
    const ids = selection.includes(menu!.id) ? selection : [menu!.id]
    await window.api.addAssetsToFolder(ids, folderId)
    await s.refreshFolders()
    if (view.type === 'folder' && view.id === folderId) await s.refreshAssets()
    setMenu(null)
  }

  /** 打开导出对话框（以选中/右键目标为范围） */
  const doExport = () => {
    const s = useLibraryStore.getState()
    const ids = selection.includes(menu!.id) ? selection : [menu!.id]
    setMenu(null)
    setExportIds(ids)
  }

  const doAiProcess = async () => {
    const s = useLibraryStore.getState()
    const ids = selection.includes(menu!.id) ? selection : [menu!.id]
    setMenu(null)
    // 打开 AI 处理对话框（以当前选中/右键目标为默认范围）
    s.setSelection(ids)
    s.openAiDialog()
  }

  if (assets.length === 0) {
    return (
      <div className="anim-fade flex flex-1 flex-col items-center justify-center gap-4 text-[var(--text-dim)]">
        <PixelArt
          pixel={7}
          map={[
            '................',
            '.11111111111111.',
            '.1............1.',
            '.1.33.........1.',
            '.1.33.........1.',
            '.1.....2......1.',
            '.1......222...1.',
            '.1..1...2222..1.',
            '.1.111..22222.1.',
            '.11111111111111.',
            '................'
          ]}
          palette={{
            '1': 'rgba(158,188,208,0.4)',
            '2': 'var(--accent)',
            '3': 'var(--amber)'
          }}
        />
        <ScrambleText
          className="mono text-[11px] uppercase tracking-[0.24em] text-[var(--text-faint)]"
          text={loading ? 'LOADING…' : 'NO ASSETS'}
        />
        <p className="text-[12px] text-[var(--text-faint)]">
          拖拽文件到窗口、Ctrl+V 粘贴图片，或点击左上角「导入」按钮
        </p>
      </div>
    )
  }

  // 容器已挂载但尺寸尚未测量时不渲染错位内容
  if (containerW <= 0) {
    return <div ref={containerRef} className="modal-scroll flex-1 overflow-y-auto p-4" />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 以图搜图横幅 */}
      {similarTo && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-4 text-[12px]">
          <Icon name="search" size={12} className="text-[var(--accent-text)]" />
          <span className="text-[var(--text-dim)]">相似搜索：</span>
          <span className="max-w-56 truncate font-medium text-[var(--accent-text)]">{similarTo.name}</span>
          <span className="mono text-[11px] text-[var(--text-faint)]">{assets.length} 个结果</span>
          <button
            className="ml-auto flex items-center gap-1 text-[var(--text-dim)] transition-colors duration-100 hover:text-[var(--text-main)]"
            onClick={() => setSimilarTo(null)}
          >
            <Icon name="close" size={11} />
            退出
          </button>
        </div>
      )}

      {/* AI 智能搜索横幅 */}
      {aiSearch && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-4 text-[12px]">
          <Icon name="sparkles" size={12} className="text-[var(--accent)]" />
          <span className="text-[var(--text-dim)]">AI 搜索：</span>
          <span className="max-w-56 truncate font-medium text-[var(--accent-text)]">{aiSearch.query}</span>
          <span className="mono text-[11px] text-[var(--text-faint)]">{assets.length} 个结果</span>
          <button
            className="ml-auto flex items-center gap-1 text-[var(--text-dim)] transition-colors duration-100 hover:text-[var(--text-main)]"
            onClick={clearAiSearch}
          >
            <Icon name="close" size={11} />
            退出
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="modal-scroll flex-1 overflow-y-auto p-4"
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop)
        endHover()
      }}
      onClick={() => {
        setSelection([])
        setMenu(null)
        endHover()
      }}
    >
      <div className="relative" style={{ height: totalH }}>
        {visible.map((item) => {
          const handlers = {
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation()
              if (e.shiftKey) selectRange(item.a.id)
              else toggleSelect(item.a.id, e.ctrlKey || e.metaKey)
              setMenu(null)
              endHover()
            },
            onDoubleClick: () => openPreview(item.a.id),
            onContextMenu: (e: React.MouseEvent) => {
              e.preventDefault()
              e.stopPropagation()
              endHover()
              if (!selection.includes(item.a.id)) setSelection([item.a.id])
              setMenu({
                x: Math.min(e.clientX, window.innerWidth - 220),
                y: Math.min(e.clientY, window.innerHeight - 340),
                id: item.a.id
              })
            }
          }
          return layoutMode === 'list' ? (
            <ListRow key={item.a.id} item={item} selected={selection.includes(item.a.id)} {...handlers} />
          ) : (
            <AssetCard
              key={item.a.id}
              item={item}
              selected={selection.includes(item.a.id)}
              {...handlers}
              onHoverStart={startHover}
              onHoverEnd={endHover}
            />
          )
        })}
      </div>

      {/* 悬停放大预览（Eagle 式，不拦截鼠标；GIF/视频/音频自动播放） */}
      {hoverPv && (
        <div
          aria-hidden="true"
          className="anim-fade pointer-events-none fixed z-[180] w-72 border border-[var(--border-strong)] bg-[var(--bg-raised)] shadow-[var(--shadow-menu)]"
          style={{ left: hoverPv.x, top: hoverPv.y }}
        >
          <div className="flex max-h-60 items-center justify-center overflow-hidden bg-[#0d0f12]">
            {hoverPv.a.ext === 'gif' ? (
              <img
                src={`${window.api.originalUrl(hoverPv.a.id)}&e=${hoverPv.a.edited ?? 0}`}
                className="max-h-60 w-full object-contain"
                alt=""
              />
            ) : ['mp4', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'm4v'].includes(hoverPv.a.ext) ? (
              <img
                src={assetStoryboardUrl(hoverPv.a)}
                className="max-h-60 w-full object-contain"
                alt=""
                onError={(e) => {
                  // 故事板不存在时回退到视频首帧播放
                  const el = e.currentTarget
                  if (!el.dataset.fbk) {
                    el.dataset.fbk = '1'
                    el.style.display = 'none'
                    const v = document.createElement('video')
                    v.src = `${window.api.originalUrl(hoverPv.a.id)}&e=${hoverPv.a.edited ?? 0}`
                    v.className = 'max-h-60 w-full'
                    v.muted = true
                    v.autoplay = true
                    v.loop = true
                    v.playsInline = true
                    el.parentElement?.appendChild(v)
                  }
                }}
              />
            ) : ['mp3', 'wav', 'ogg', 'flac'].includes(hoverPv.a.ext) ? (
              <div className="flex h-32 w-full flex-col items-center justify-center gap-3 px-4">
                <Icon name="music" size={32} strokeWidth={1.4} className="text-[var(--text-faint)]" />
                <audio src={`${window.api.originalUrl(hoverPv.a.id)}&e=${hoverPv.a.edited ?? 0}`} autoPlay controls className="h-7 w-full" />
              </div>
            ) : assetThumbUrl(hoverPv.a) ? (
              <img
                src={assetThumbUrl(hoverPv.a)}
                className="max-h-60 w-full object-contain"
                alt=""
              />
            ) : (
              <div className="flex h-32 items-center text-[var(--text-faint)]">
                <Icon name={KIND_ICON[hoverPv.a.ext] ?? KIND_ICON.other} size={40} strokeWidth={1.3} />
              </div>
            )}
          </div>
          <div className="border-t border-[var(--border)] px-3 py-2">
            <div className="truncate text-[12px]">{hoverPv.a.name}</div>
            <div className="mono mt-0.5 flex items-center justify-between text-[11px] text-[var(--text-faint)]">
              <span className="uppercase">.{hoverPv.a.ext}</span>
              {hoverPv.a.width > 0 && (
                <span className="tnum">
                  {hoverPv.a.width} × {hoverPv.a.height}
                </span>
              )}
              <span className="tnum">{fmtSize(hoverPv.a.size)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {menu && contextAsset && (
        <div
          role="menu"
          className="anim-menu menu fixed z-[300] w-52 py-1"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
            onClick={() => {
              openPreview(menu.id)
              setMenu(null)
            }}
          >
            预览
          </button>
          {assetEditable(contextAsset) && (
            <button
              role="menuitem"
              className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
              onClick={() => {
                useLibraryStore.getState().openEditor(menu.id)
                setMenu(null)
              }}
            >
              批注 / 裁剪
            </button>
          )}
          {contextAsset.edited === 1 && (
            <button
              role="menuitem"
              className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-red-400"
              onClick={() => {
                setRevertId(menu.id)
                setMenu(null)
              }}
            >
              恢复原图
            </button>
          )}
          <button
            role="menuitem"
            className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
            onClick={async () => {
              await window.api.showInFolder(menu.id)
              setMenu(null)
            }}
          >
            在资源管理器中显示
          </button>
          {assetThumbUrl(contextAsset) && (
            <button
              role="menuitem"
              className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
              onClick={async () => {
                await window.api.copyImage(menu.id)
                useLibraryStore.getState().showToast('已复制图片到剪贴板')
                setMenu(null)
              }}
            >
              复制图片
            </button>
          )}
          <button
            role="menuitem"
            className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
            onClick={() => doExport()}
          >
            导出…
          </button>
          <button
            role="menuitem"
            className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
            onClick={() => void doAiProcess()}
          >
            AI 智能处理（改名+打标签）…
          </button>
          {assetThumbUrl(contextAsset) && (
            <button
              role="menuitem"
              className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setSimilarTo({ id: contextAsset.id, name: contextAsset.name })
                setMenu(null)
              }}
            >
              搜索相似图片
            </button>
          )}
          {normalFolders.length > 0 && (
            <div className="relative group/fld">
              <button
                role="menuitem"
                className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
              >
                添加到文件夹 ▸
              </button>
              <div className="menu absolute left-full top-0 hidden w-44 py-1 group-hover/fld:block">
                {normalFolders.map((f) => (
                  <button
                    key={f.id}
                    className="block w-full cursor-pointer truncate px-3 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                    onClick={() => void doAddToFolder(f.id)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {view.type === 'folder' && (
            <button
              role="menuitem"
              className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
              onClick={async () => {
                const ids = selection.includes(menu.id) ? selection : [menu.id]
                await window.api.removeAssetsFromFolder(ids, view.id)
                await useLibraryStore.getState().refreshAssets()
                setMenu(null)
              }}
            >
              从文件夹移除
            </button>
          )}
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            role="menuitem"
            className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] text-[var(--danger)] hover:bg-[var(--bg-hover)]"
            onClick={() => void doDelete()}
          >
            {view.type === 'trash' ? '永久删除' : '移到回收站'}
          </button>
          {view.type === 'trash' && (
            <button
              role="menuitem"
              className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
              onClick={async () => {
                const ids = selection.includes(menu.id) ? selection : [menu.id]
                await window.api.restoreAssets(ids)
                await useLibraryStore.getState().refreshAll()
                setMenu(null)
              }}
            >
              恢复
            </button>
          )}
        </div>
      )}
      {revertId && (
        <ConfirmDialog
          title="恢复原图"
          message="将丢弃当前编辑结果，恢复为原始图片。此操作不可撤销。"
          confirmLabel="恢复原图"
          danger
          onConfirm={async () => {
            try {
              await window.api.revertEdit(revertId)
              useLibraryStore.getState().showToast('已恢复原图')
              await useLibraryStore.getState().refreshAssets()
            } catch {
              useLibraryStore.getState().showToast('恢复失败，请查看日志')
            }
            setRevertId(null)
          }}
          onClose={() => setRevertId(null)}
        />
      )}
      {exportIds !== null && (
        <ExportDialog ids={exportIds} onClose={() => setExportIds(null)} />
      )}
      </div>
    </div>
  )
}
