import { useEffect, useMemo, useRef, useState } from 'react'
import { assetEditable, assetThumbUrl, useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'

interface ZoomState {
  s: number
  x: number
  y: number
}

const ZOOM_RESET: ZoomState = { s: 1, x: 0, y: 0 }

export default function Preview() {
  const assets = useLibraryStore((s) => s.assets)
  const previewId = useLibraryStore((s) => s.previewId)
  const openPreview = useLibraryStore((s) => s.openPreview)

  const index = useMemo(() => assets.findIndex((a) => a.id === previewId), [assets, previewId])
  const asset = index >= 0 ? assets[index] : null

  /* 缩放/拖动状态（仅图片） */
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_RESET)
  const [panning, setPanning] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{ startX: number; startY: number; zx: number; zy: number } | null>(null)

  useEffect(() => {
    setZoom(ZOOM_RESET)
    setPanning(false)
  }, [asset?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' && index > 0) openPreview(assets[index - 1].id)
      if (e.key === 'ArrowRight' && index < assets.length - 1) openPreview(assets[index + 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, assets, openPreview])

  if (!asset) return null

  const setStar = async (star: number) => {
    await window.api.updateAsset(asset.id, { star })
    useLibraryStore.getState().updateAssetLocal(asset.id, { star })
  }

  const isImage = assetThumbUrl(asset)
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

  return (
    <div
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
            src={window.api.originalUrl(asset.id)}
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
                el.src = window.api.thumbnailUrl(asset.id)
              }
            }}
          />
        ) : asset.ext === 'mp4' || asset.ext === 'webm' ? (
          <video
            src={window.api.originalUrl(asset.id)}
            controls
            autoPlay
            className="max-h-full max-w-full rounded-sm shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          />
        ) : asset.ext === 'mp3' || asset.ext === 'wav' || asset.ext === 'ogg' ? (
          <audio src={window.api.originalUrl(asset.id)} controls autoPlay onClick={(e) => e.stopPropagation()} />
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

        {/* 缩放指示 */}
        {zoom.s > 1 && (
          <div className="mono absolute bottom-3 right-3 bg-black/60 px-2 py-1 text-[10px] tracking-[0.1em] text-white/70">
            {Math.round(zoom.s * 100)}% · 双击复位
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div
        className="flex h-9 shrink-0 items-center justify-center gap-4 text-[11px] tracking-wide text-white/45"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="uppercase">.{asset.ext}</span>
        {asset.width > 0 && (
          <span className="tnum">
            {asset.width} × {asset.height}
          </span>
        )}
        {asset.tagNames.length > 0 && <span>{asset.tagNames.join('、')}</span>}
      </div>
    </div>
  )
}
