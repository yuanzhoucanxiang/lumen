import { useEffect, useMemo, useRef, useState } from 'react'
import { assetEditable, useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import { useDialogFocus } from '../useDialogFocus'

interface ZoomState {
  s: number
  x: number
  y: number
}

const ZOOM_RESET: ZoomState = { s: 1, x: 0, y: 0 }

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export default function Preview() {
  const assets = useLibraryStore((s) => s.assets)
  const previewId = useLibraryStore((s) => s.previewId)
  const openPreview = useLibraryStore((s) => s.openPreview)
  const folders = useLibraryStore((s) => s.folders)
  const view = useLibraryStore((s) => s.view)

  const index = useMemo(() => assets.findIndex((a) => a.id === previewId), [assets, previewId])
  const asset = index >= 0 ? assets[index] : null
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, () => openPreview(null), { active: !!asset })

  /* 缩放/拖动状态（仅图片） */
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_RESET)
  const [panning, setPanning] = useState(false)
  /** 右侧素材信息面板（里程碑 197） */
  const [infoOpen, setInfoOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const panRef = useRef<{ startX: number; startY: number; zx: number; zy: number } | null>(null)

  useEffect(() => {
    setZoom(ZOOM_RESET)
    setPanning(false)
  }, [asset?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' && index > 0) openPreview(assets[index - 1].id)
      if (e.key === 'ArrowRight' && index < assets.length - 1) openPreview(assets[index + 1].id)
      // 图库分页后预览列表只是「已加载」那部分：走到末尾就续借下一页，←→ 不会断在页边界
      else if (e.key === 'ArrowRight' && useLibraryStore.getState().assetsHasMore)
        void useLibraryStore.getState().loadMoreAssets()
      else if (e.key === 'i' && !e.ctrlKey && !e.metaKey && !e.altKey) setInfoOpen((v) => !v)
      else if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) {
        setZoom((z) => ({ s: Math.min(8, z.s * 1.25), x: 0, y: 0 }))
      } else if (e.key === '-' && !e.ctrlKey && !e.metaKey) {
        setZoom((z) => ({ s: Math.max(1, z.s / 1.25), x: 0, y: 0 }))
      } else if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        setZoom(ZOOM_RESET)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, assets, openPreview])

  if (!asset) return null

  const folderName = view.type === 'folder' ? folders.find((f) => f.id === view.id)?.name ?? null : null
  let palette: number[][] = []
  try {
    palette = JSON.parse(asset.colors) as number[][]
  } catch {
    palette = []
  }

  const setStar = async (star: number) => {
    await window.api.updateAsset(asset.id, { star })
    useLibraryStore.getState().updateAssetLocal(asset.id, { star })
  }

  // 可浏览器直接解码的图片格式(排除视频:视频走 video 分支播放)
  // 注意不能用 assetThumbUrl 判断——视频的 assetThumbUrl 返回故事板 URL,会导致视频被当图片预览
  // heic/heif:Chromium 不解码,但加入后 onError 自动回退缩略图预览
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'tiff', 'tif', 'heic', 'heif'])
  const isImage = IMAGE_EXTS.has(asset.ext)
  const canEdit = assetEditable(asset)

  /** 以光标为中心缩放 */
  const onWheel = (e: React.WheelEvent) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const cx = e.clientX - (rect.left + rect.width / 2)
    const cy = e.clientY - (rect.top + rect.height / 2)
    setZoom((z) => {
      const ns = Math.min(8, Math.max(1, z.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18)))
      const k = ns / z.s
      return { s: ns, x: cx - (cx - z.x) * k, y: cy - (cy - z.y) * k }
    })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom.s <= 1) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    panRef.current = { startX: e.clientX, startY: e.clientY, zx: zoom.x, zy: zoom.y }
    setPanning(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current
    if (!p) return
    setZoom((z) => ({ ...z, x: p.zx + (e.clientX - p.startX), y: p.zy + (e.clientY - p.startY) }))
  }
  const onPointerUp = () => {
    panRef.current = null
    setPanning(false)
  }

  /** 100% 像素(1:1)：图片实际像素与屏幕像素一致；已是 1:1 时再点复位 */
  const toggleOneToOne = () => {
    const img = imgRef.current
    if (!img || !img.naturalWidth || !img.clientWidth) return
    const oneOne = img.naturalWidth / img.clientWidth
    const isOneOne = Math.abs(zoom.s - oneOne) / oneOne < 0.03
    if (isOneOne) {
      setZoom(ZOOM_RESET)
    } else {
      setZoom({ s: Math.min(8, oneOne), x: 0, y: 0 })
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${asset.name}`}
      className="anim-overlay fixed inset-0 z-[100] flex flex-col backdrop-blur-md"
      style={{ background: 'rgba(4, 6, 8, 0.88)' }}
      onClick={() => openPreview(null)}
    >
      {/* 顶栏 */}
      <div
        className="flex h-12 shrink-0 items-center justify-between px-4 text-[13px] text-white/85"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 truncate font-medium">{asset.name}</span>
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5" role="group" aria-label="评分">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-label={`评分 ${n} 星`}
                className={`text-sm transition-colors duration-100 ${
                  n <= asset.star ? 'text-[var(--amber)]' : 'text-white/25 hover:text-white/70'
                }`}
                onClick={() => void setStar(n === asset.star ? 0 : n)}
              >
                ★
              </button>
            ))}
          </div>
          <span className="tnum text-white/40">
            {index + 1} / {assets.length}
          </span>
          <button
            aria-label="显示/隐藏素材信息"
            aria-pressed={infoOpen}
            title="素材信息 (i)"
            className={`flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] tracking-[0.04em] transition-colors duration-100 hover:bg-white/10 ${
              infoOpen ? 'text-[var(--accent-text)]' : 'text-white/70'
            }`}
            onClick={() => setInfoOpen((v) => !v)}
          >
            <Icon name="eye" size={13} />
            信息
          </button>
          {canEdit && (
            <button
              className="flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-1.5 text-[12px] tracking-[0.04em] transition-colors duration-100 hover:bg-white/20"
              onClick={() => useLibraryStore.getState().openEditor(asset.id)}
            >
              <Icon name="pencil" size={13} />
              编辑
            </button>
          )}
          <button
            autoFocus
            data-autofocus="true"
            aria-label="关闭预览"
            className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] tracking-[0.04em] transition-colors duration-100 hover:bg-white/10"
            onClick={() => openPreview(null)}
          >
            <Icon name="close" size={13} />
            关闭
          </button>
        </div>
      </div>

      {/* 主图区 */}
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6"
        onWheel={isImage ? onWheel : undefined}
      >
        {isImage ? (
          <img
            ref={imgRef}
            src={`${window.api.originalUrl(asset.id)}&e=${asset.edited ?? 0}`}
            className="anim-fade max-h-full max-w-full border border-[var(--border-strong)] object-contain shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
            style={{
              transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`,
              cursor: zoom.s > 1 ? (panning ? 'grabbing' : 'grab') : 'default',
              transition: panning ? 'none' : 'transform 120ms ease-out'
            }}
            alt={asset.name}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setZoom(ZOOM_RESET)
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onError={(e) => {
              // PSD 等浏览器无法解码的格式：回退到缩略图
              const el = e.currentTarget
              if (!el.dataset.fbk) {
                el.dataset.fbk = '1'
                el.src = `${window.api.thumbnailUrl(asset.id)}&e=${asset.edited ?? 0}`
              }
            }}
          />
        ) : asset.ext === 'mp4' || asset.ext === 'webm' ? (
          <video
            src={`${window.api.originalUrl(asset.id)}&e=${asset.edited ?? 0}`}
            controls
            autoPlay
            muted
            playsInline
            className="max-h-full max-w-full rounded-sm shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          />
        ) : asset.ext === 'mp3' || asset.ext === 'wav' || asset.ext === 'ogg' ? (
          <audio src={`${window.api.originalUrl(asset.id)}&e=${asset.edited ?? 0}`} controls autoPlay onClick={(e) => e.stopPropagation()} />
        ) : (
          <div className="text-white/50">该格式暂不支持预览</div>
        )}

        {index > 0 && (
          <button
            aria-label="上一张"
            className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur-md transition-all duration-150 hover:scale-105 hover:bg-black/60"
            onClick={(e) => {
              e.stopPropagation()
              openPreview(assets[index - 1].id)
            }}
          >
            <Icon name="chevronLeft" size={18} />
          </button>
        )}
        {index < assets.length - 1 && (
          <button
            aria-label="下一张"
            className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur-md transition-all duration-150 hover:scale-105 hover:bg-black/60"
            onClick={(e) => {
              e.stopPropagation()
              openPreview(assets[index + 1].id)
            }}
          >
            <Icon name="chevronRight" size={18} />
          </button>
        )}

        {/* 缩放控制（里程碑 197）：− / 百分比 / + / 适应 / 1:1 */}
        {isImage && (
          <div
            className="absolute bottom-3 z-10 flex items-center gap-1"
            style={{ right: infoOpen ? 292 : 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              aria-label="缩小"
              title="缩小 (-)"
              className="rounded-sm border border-white/20 bg-black/60 px-1.5 py-1 text-[11px] text-white/70 transition-colors hover:text-white disabled:opacity-30"
              disabled={zoom.s <= 1}
              onClick={() => setZoom((z) => ({ s: Math.max(1, z.s / 1.25), x: 0, y: 0 }))}
            >
              −
            </button>
            <span className="mono min-w-[48px] bg-black/60 px-1.5 py-1 text-center text-[11px] tnum tracking-[0.06em] text-white/70">
              {Math.round(zoom.s * 100)}%
            </span>
            <button
              aria-label="放大"
              title="放大 (+)"
              className="rounded-sm border border-white/20 bg-black/60 px-1.5 py-1 text-[11px] text-white/70 transition-colors hover:text-white disabled:opacity-30"
              disabled={zoom.s >= 8}
              onClick={() => setZoom((z) => ({ s: Math.min(8, z.s * 1.25), x: 0, y: 0 }))}
            >
              +
            </button>
            <button
              aria-label="适应窗口"
              title="适应窗口 (0)"
              className="rounded-sm border border-white/20 bg-black/60 px-1.5 py-1 text-[11px] text-white/70 transition-colors hover:text-white"
              onClick={() => setZoom(ZOOM_RESET)}
            >
              适应
            </button>
            <button
              aria-label="100% 像素显示"
              title="100% 像素（1:1）"
              className={`rounded-sm border px-1.5 py-1 text-[11px] transition-colors duration-100 ${
                zoom.s > 1.01
                  ? 'border-[var(--accent)] bg-black/60 text-[var(--accent)]'
                  : 'border-white/20 bg-black/60 text-white/70 hover:text-white'
              }`}
              onClick={() => toggleOneToOne()}
            >
              1:1
            </button>
          </div>
        )}
      </div>

      {infoOpen && (
        <aside
          aria-label="素材信息"
          className="absolute bottom-9 right-0 top-12 z-20 w-[280px] overflow-y-auto border-l border-[var(--border)] bg-black/75 p-4 backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="mono text-[10px] tracking-[0.16em] text-[var(--accent-text)]">ASSET INFO</span>
            <button
              aria-label="关闭素材信息"
              className="flex h-5 w-5 items-center justify-center text-white/50 transition-colors hover:text-white"
              onClick={() => setInfoOpen(false)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
          <p className="mb-3 break-all text-[13px] font-medium leading-snug text-white/90">{asset.name}</p>
          <dl className="space-y-2 text-[11px]">
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-white/40">格式</dt>
              <dd className="mono text-right uppercase text-white/75">.{asset.ext}</dd>
            </div>
            {asset.width > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-white/40">尺寸</dt>
                <dd className="mono tnum text-right text-white/75">
                  {asset.width} × {asset.height}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-white/40">大小</dt>
              <dd className="mono tnum text-right text-white/75">{fmtSize(asset.size)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-white/40">导入时间</dt>
              <dd className="text-right text-white/75">{new Date(asset.importedAt).toLocaleString('zh-CN')}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-white/40">所在文件夹</dt>
              <dd className="truncate text-right text-white/75" title={folderName ?? undefined}>
                {folderName ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-white/40">编辑状态</dt>
              <dd className="text-right text-white/75">{asset.edited === 1 ? '已编辑（原图保留）' : '原图'}</dd>
            </div>
          </dl>

          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="mb-1.5 text-[10px] tracking-[0.12em] text-white/35">标签</p>
            {asset.tagNames.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {asset.tagNames.map((t) => (
                  <span key={t} className="border border-white/15 px-1.5 py-0.5 text-[11px] text-white/70">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-white/35">—</p>
            )}
          </div>

          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="mb-1.5 text-[10px] tracking-[0.12em] text-white/35">备注</p>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/70">{asset.comment || '—'}</p>
          </div>

          {palette.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="mb-1.5 text-[10px] tracking-[0.12em] text-white/35">主色调</p>
              <div className="flex flex-wrap gap-1">
                {palette.slice(0, 10).map((c, i) => (
                  <span
                    key={i}
                    className="h-5 w-5 border border-white/15"
                    style={{ background: `rgb(${c[0]}, ${c[1]}, ${c[2]})` }}
                    title={`rgb(${c[0]}, ${c[1]}, ${c[2]})`}
                  />
                ))}
              </div>
            </div>
          )}
        </aside>
      )}

      {/* 底部信息 */}
      <div
        className="flex h-9 min-w-0 shrink-0 items-center justify-center gap-4 text-[11px] tracking-wide text-white/45"
        style={infoOpen ? { paddingRight: 280 } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="uppercase">.{asset.ext}</span>
        {asset.width > 0 && (
          <span className="tnum shrink-0">
            {asset.width} × {asset.height}
          </span>
        )}
        {asset.tagNames.length > 0 && (
          <span className="min-w-0 max-w-[45%] truncate" title={asset.tagNames.join('、')}>
            {asset.tagNames.slice(0, 3).join('、')}
            {asset.tagNames.length > 3 ? ` +${asset.tagNames.length - 3}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
