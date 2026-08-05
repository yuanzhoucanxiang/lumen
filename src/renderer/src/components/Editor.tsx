import { useCallback, useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import type { IconName } from './Icon'

const PEN_COLORS = ['#ff5252', '#ffb300', '#ffee58', '#69f0ae', '#40c4ff', '#e040fb', '#ffffff', '#212121']

type Tool = 'pen' | 'crop' | 'rect' | 'arrow' | 'text'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const ASPECTS = [
  { v: 0, label: '自由' },
  { v: 1, label: '1:1' },
  { v: 4 / 3, label: '4:3' },
  { v: 16 / 9, label: '16:9' },
  { v: 3 / 4, label: '3:4' },
  { v: 9 / 16, label: '9:16' }
]

const TOOLS: { key: Tool; icon: IconName; label: string }[] = [
  { key: 'pen', icon: 'pencil', label: '画笔' },
  { key: 'rect', icon: 'rect', label: '矩形' },
  { key: 'arrow', icon: 'arrowRight', label: '箭头' },
  { key: 'text', icon: 'type', label: '文字' },
  { key: 'crop', icon: 'crop', label: '裁剪' }
]

/** 在画布上绘制形状（原始坐标系） */
function drawShape(
  ctx: CanvasRenderingContext2D,
  type: 'rect' | 'arrow',
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number
): void {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (type === 'rect') {
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
  } else {
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    // 箭头
    const angle = Math.atan2(y1 - y0, x1 - x0)
    const headLen = Math.max(width * 4, 12)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 - headLen * Math.cos(angle - 0.45), y1 - headLen * Math.sin(angle - 0.45))
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 - headLen * Math.cos(angle + 0.45), y1 - headLen * Math.sin(angle + 0.45))
    ctx.stroke()
  }
}

export default function Editor() {
  const editorId = useLibraryStore((s) => s.editorId)
  const assets = useLibraryStore((s) => s.assets)
  const openEditor = useLibraryStore((s) => s.openEditor)
  const asset = assets.find((a) => a.id === editorId)

  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLCanvasElement>(null)
  const workRef = useRef<HTMLCanvasElement | null>(null) // 原始分辨率画布
  const originalRef = useRef<HTMLImageElement | null>(null)
  const undoStack = useRef<HTMLCanvasElement[]>([])
  const scaleRef = useRef(1)
  const dragRef = useRef<{ startX: number; startY: number; drawing: boolean }>({
    startX: 0,
    startY: 0,
    drawing: false
  })

  const [tool, setTool] = useState<Tool>('pen')
  const [penColor, setPenColor] = useState('#ff5252')
  const [penWidth, setPenWidth] = useState(6)
  const [cropRect, setCropRect] = useState<Rect | null>(null)
  const [aspect, setAspect] = useState(0)
  const [shapePreview, setShapePreview] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [canUndo, setCanUndo] = useState(false)

  /** 把工作画布渲染到显示画布，并叠加裁剪框/形状预览 */
  const drawView = useCallback(() => {
    const view = viewRef.current
    const work = workRef.current
    if (!view || !work) return
    const ctx = view.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, view.width, view.height)
    ctx.drawImage(work, 0, 0, view.width, view.height)

    if (shapePreview) {
      drawShape(
        ctx,
        tool === 'arrow' ? 'arrow' : 'rect',
        shapePreview.x0,
        shapePreview.y0,
        shapePreview.x1,
        shapePreview.y1,
        penColor,
        penWidth
      )
    }

    if (cropRect && cropRect.w > 2 && cropRect.h > 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, view.width, cropRect.y)
      ctx.fillRect(0, cropRect.y, cropRect.x, cropRect.h)
      ctx.fillRect(cropRect.x + cropRect.w, cropRect.y, view.width - cropRect.x - cropRect.w, cropRect.h)
      ctx.fillRect(0, cropRect.y + cropRect.h, view.width, view.height - cropRect.y - cropRect.h)
      ctx.strokeStyle = '#4da9e9'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h)
      ctx.setLineDash([])
    }
  }, [cropRect, shapePreview, tool, penColor, penWidth])

  /** 加载原图并初始化画布 */
  useEffect(() => {
    if (!asset) return
    setReady(false)
    setCropRect(null)
    setShapePreview(null)
    setTextInput(null)
    undoStack.current = []
    setCanUndo(false)
    const img = new Image()
    img.onload = () => {
      const container = containerRef.current
      if (!container) return
      const maxW = container.clientWidth - 32
      const maxH = container.clientHeight - 32
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
      scaleRef.current = scale

      const work = document.createElement('canvas')
      work.width = img.naturalWidth
      work.height = img.naturalHeight
      work.getContext('2d')!.drawImage(img, 0, 0)
      workRef.current = work
      originalRef.current = img

      const view = viewRef.current!
      view.width = Math.max(1, Math.round(img.naturalWidth * scale))
      view.height = Math.max(1, Math.round(img.naturalHeight * scale))
      setReady(true)
      requestAnimationFrame(drawView)
    }
    img.src = `${window.api.originalUrl(asset.id)}&e=${asset.edited ?? 0}`
  }, [asset?.id, asset?.edited])

  useEffect(() => {
    if (ready) drawView()
  }, [ready, drawView])

  const pushUndo = () => {
    const work = workRef.current
    if (!work) return
    const snap = document.createElement('canvas')
    snap.width = work.width
    snap.height = work.height
    snap.getContext('2d')!.drawImage(work, 0, 0)
    undoStack.current.push(snap)
    if (undoStack.current.length > 15) undoStack.current.shift()
    setCanUndo(true)
  }

  const undo = () => {
    const snap = undoStack.current.pop()
    const work = workRef.current
    if (!snap || !work) return
    work.width = snap.width
    work.height = snap.height
    work.getContext('2d')!.drawImage(snap, 0, 0)
    setCropRect(null)
    setCanUndo(undoStack.current.length > 0)
    drawView()
  }

  const reset = () => {
    const img = originalRef.current
    const work = workRef.current
    if (!img || !work) return
    pushUndo()
    work.width = img.naturalWidth
    work.height = img.naturalHeight
    work.getContext('2d')!.drawImage(img, 0, 0)
    setCropRect(null)
    drawView()
  }

  const toViewPos = (e: React.PointerEvent) => {
    const rect = viewRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const commitText = () => {
    if (!textInput) return
    const work = workRef.current
    const text = textInput.value.trim()
    if (work && text) {
      pushUndo()
      const s = scaleRef.current
      const ctx = work.getContext('2d')!
      const fontSize = Math.round((penWidth * 5) / s)
      ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`
      ctx.fillStyle = penColor
      ctx.textBaseline = 'top'
      // 描边提升可读性
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = Math.max(2, fontSize / 14)
      ctx.strokeText(text, textInput.x / s, textInput.y / s)
      ctx.fillText(text, textInput.x / s, textInput.y / s)
    }
    setTextInput(null)
    drawView()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ready) return
    if (textInput) commitText()
    const { x, y } = toViewPos(e)

    if (tool === 'text') {
      setTextInput({ x, y, value: '' })
      return
    }

    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: x, startY: y, drawing: true }

    if (tool === 'pen') {
      pushUndo()
      const ctx = workRef.current!.getContext('2d')!
      const s = scaleRef.current
      ctx.strokeStyle = penColor
      ctx.lineWidth = penWidth / s
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(x / s, y / s)
      ctx.lineTo(x / s + 0.01, y / s + 0.01)
      ctx.stroke()
      drawView()
    } else if (tool === 'rect' || tool === 'arrow') {
      pushUndo()
      setShapePreview({ x0: x, y0: y, x1: x, y1: y })
    } else {
      setCropRect({ x, y, w: 0, h: 0 })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.drawing) return
    const { x, y } = toViewPos(e)
    if (tool === 'pen') {
      const ctx = workRef.current!.getContext('2d')!
      const s = scaleRef.current
      ctx.lineTo(x / s, y / s)
      ctx.stroke()
      drawView()
    } else if (tool === 'rect' || tool === 'arrow') {
      setShapePreview((p) => (p ? { ...p, x1: x, y1: y } : null))
    } else {
      const { startX, startY } = dragRef.current
      let w = Math.abs(x - startX)
      let h = Math.abs(y - startY)
      if (aspect > 0) h = w / aspect
      setCropRect({
        x: x < startX ? startX - w : startX,
        y: y < startY ? startY - h : startY,
        w,
        h
      })
    }
  }

  const onPointerUp = () => {
    if (dragRef.current.drawing && (tool === 'rect' || tool === 'arrow') && shapePreview) {
      const s = scaleRef.current
      const ctx = workRef.current!.getContext('2d')!
      drawShape(
        ctx,
        tool === 'arrow' ? 'arrow' : 'rect',
        shapePreview.x0 / s,
        shapePreview.y0 / s,
        shapePreview.x1 / s,
        shapePreview.y1 / s,
        penColor,
        penWidth / s
      )
      setShapePreview(null)
      requestAnimationFrame(drawView)
    }
    dragRef.current.drawing = false
  }

  const applyCrop = () => {
    const work = workRef.current
    if (!work || !cropRect || cropRect.w < 4 || cropRect.h < 4) return
    const s = scaleRef.current
    const sx = Math.round(cropRect.x / s)
    const sy = Math.round(cropRect.y / s)
    const sw = Math.round(cropRect.w / s)
    const sh = Math.round(cropRect.h / s)
    pushUndo()
    const next = document.createElement('canvas')
    next.width = sw
    next.height = sh
    next.getContext('2d')!.drawImage(work, sx, sy, sw, sh, 0, 0, sw, sh)
    workRef.current = next
    const container = containerRef.current
    if (container) {
      const scale = Math.min((container.clientWidth - 32) / sw, (container.clientHeight - 32) / sh, 1)
      scaleRef.current = scale
      const view = viewRef.current!
      view.width = Math.round(sw * scale)
      view.height = Math.round(sh * scale)
    }
    setCropRect(null)
    requestAnimationFrame(drawView)
  }

  const save = async () => {
    if (!asset || !workRef.current || saving) return
    if (textInput) commitText()
    setSaving(true)
    try {
      const mime = ['jpg', 'jpeg', 'webp'].includes(asset.ext) ? 'image/jpeg' : 'image/png'
      const blob = await new Promise<Blob | null>((resolve) =>
        workRef.current!.toBlob(resolve, mime, 0.92)
      )
      if (!blob) throw new Error('导出失败')
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result as string)
        fr.onerror = reject
        fr.readAsDataURL(blob)
      })
      await window.api.applyEdit(asset.id, dataUrl)
      useLibraryStore.getState().showToast('已保存编辑')
      await useLibraryStore.getState().refreshAssets()
      openEditor(null)
    } catch {
      useLibraryStore.getState().showToast('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!asset) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`编辑 ${asset.name}`}
      className="anim-overlay fixed inset-0 z-[120] flex flex-col"
      style={{ background: '#0a0c0f' }}
    >
      {/* 工具栏 */}
      <div
        className="flex h-12 shrink-0 items-center gap-1.5 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3"
      >
        <span className="mr-1.5 max-w-40 truncate text-[13px] text-[var(--text-dim)]">{asset.name}</span>
        {TOOLS.map((t) => (
          <button
            key={t.key}
            aria-pressed={tool === t.key}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] transition-colors duration-100 ${
              tool === t.key
                ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]'
                : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
            }`}
            onClick={() => setTool(t.key)}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
          </button>
        ))}

        {tool !== 'crop' && (
          <>
            <div className="mx-1.5 h-5 w-px bg-[var(--border)]" />
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`颜色 ${c}`}
                aria-pressed={penColor === c}
                className="h-5 w-5 rounded-full border-2 transition-transform duration-100 hover:scale-110"
                style={{
                  background: c,
                  borderColor: penColor === c ? '#fff' : 'rgba(255,255,255,0.2)'
                }}
                onClick={() => setPenColor(c)}
              />
            ))}
            <input
              aria-label="自定义颜色"
              type="color"
              value={penColor}
              onChange={(e) => setPenColor(e.target.value)}
              className="ml-1 h-6 w-8 cursor-pointer"
            />
            <div className="ml-2 flex items-center gap-1.5 text-[11px] text-[var(--text-dim)]">
              <label htmlFor="pen-width">粗细</label>
              <input
                id="pen-width"
                type="range"
                min={2}
                max={30}
                value={penWidth}
                onChange={(e) => setPenWidth(Number(e.target.value))}
                className="w-20"
              />
            </div>
          </>
        )}

        {tool === 'crop' && (
          <>
            <div className="mx-1.5 h-5 w-px bg-[var(--border)]" />
            {ASPECTS.map((a) => (
              <button
                key={a.label}
                aria-pressed={aspect === a.v}
                className={`rounded-md px-2 py-1 text-[11px] transition-colors duration-100 ${
                  aspect === a.v
                    ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                    : 'bg-[var(--bg-hover)] hover:bg-[var(--bg-active)]'
                }`}
                onClick={() => setAspect(a.v)}
              >
                {a.label}
              </button>
            ))}
            {cropRect && cropRect.w > 4 && (
              <button
                className="flex items-center gap-1 rounded-sm bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--on-accent)] transition-colors duration-100 hover:bg-[var(--accent-hover)]"
                onClick={applyCrop}
              >
                <Icon name="check" size={12} strokeWidth={2.6} />
                应用裁剪
              </button>
            )}
          </>
        )}

        <div className="flex-1" />
        <button
          className="btn-ghost flex items-center gap-1.5 disabled:opacity-40"
          disabled={!canUndo}
          onClick={undo}
        >
          <Icon name="undo" size={13} />
          撤销
        </button>
        <button className="btn-ghost flex items-center gap-1.5" onClick={reset}>
          <Icon name="rotate" size={13} />
          还原
        </button>
        <button className="btn-ghost" onClick={() => openEditor(null)}>
          取消
        </button>
        <button
          className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
          disabled={saving}
          onClick={() => void save()}
        >
          <Icon name="save" size={13} strokeWidth={2} />
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {/* 画布区域 */}
      <div ref={containerRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {/* canvas 必须始终挂载：img.onload 中要通过 viewRef 设置画布尺寸 */}
        <canvas
          ref={viewRef}
          className={`${tool === 'text' ? 'cursor-text' : 'cursor-crosshair'} ${ready ? '' : 'invisible'}`}
          style={{ boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        {!ready && <div className="absolute text-[var(--text-faint)]">加载中…</div>}
        {/* 文字输入浮层 */}
        {textInput && (
          <input
            autoFocus
            aria-label="输入标注文字"
            className="field-input absolute z-10 min-w-40 border-[var(--accent)] text-[14px]"
            style={{ left: textInput.x + 16, top: textInput.y, color: penColor }}
            placeholder="输入文字后回车…"
            value={textInput.value}
            onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitText()
              if (e.key === 'Escape') setTextInput(null)
            }}
            onBlur={commitText}
          />
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center justify-center text-[11px] text-[var(--text-faint)]">
        {tool === 'pen' && '在图片上拖动即可绘制批注'}
        {tool === 'rect' && '拖动绘制矩形框'}
        {tool === 'arrow' && '拖动绘制箭头'}
        {tool === 'text' && '点击画布输入文字，回车确认'}
        {tool === 'crop' && '拖动框选裁剪区域，然后点击「应用裁剪」'}
      </div>
    </div>
  )
}
