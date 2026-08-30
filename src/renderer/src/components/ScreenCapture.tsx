import { useEffect, useRef, useState } from 'react'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const MIN_SIZE = 4

/** 归一化拖拽为正矩形 */
function norm(d: { x0: number; y0: number; x1: number; y1: number }): Rect {
  return {
    x: Math.min(d.x0, d.x1),
    y: Math.min(d.y0, d.y1),
    width: Math.abs(d.x1 - d.x0),
    height: Math.abs(d.y1 - d.y0)
  }
}

/**
 * 区域截图覆层（主进程以 ?screenshot=1 打开的全屏无边框透明窗）：
 * 整屏图铺底 + 框选（松开即确认入库）+ 选区尺寸角标；Esc/右键取消。
 * 选区外压暗用 box-shadow 大扩散实现（比四块遮罩少一层 DOM 与同步）。
 */
export default function ScreenCapture() {
  const [img, setImg] = useState<string | null>(null)
  const [dpr, setDpr] = useState(1)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    window.api.screenshotOverlayReady()
    return window.api.onScreenshotData((d) => {
      setImg(d.dataUrl)
      setDpr(d.dpr)
    })
  }, [])

  const settle = () => {
    if (settledRef.current) return
    settledRef.current = true
    void window.api.screenshotCancel()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rect = drag ? norm(drag) : null

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none overflow-hidden"
      role="application"
      aria-label="区域截图：拖拽框选，松开确认；Esc 取消"
      onContextMenu={(e) => {
        e.preventDefault()
        settle()
      }}
      onPointerDown={(e) => {
        if (!img || drag || settledRef.current) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })
      }}
      onPointerMove={(e) => {
        if (drag) setDrag((d) => (d ? { ...d, x1: e.clientX, y1: e.clientY } : d))
      }}
      onPointerUp={() => {
        if (!drag || settledRef.current) return
        const r = norm(drag)
        setDrag(null)
        if (r.width < MIN_SIZE || r.height < MIN_SIZE) return
        settledRef.current = true
        // 主进程裁剪入库后自行关窗恢复主界面,覆层无需处理返回值
        void window.api.screenshotCommit(r, dpr).catch(() => undefined)
      }}
    >
      {img && <img src={img} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />}
      {rect && (
        <div
          data-screenshot-selection
          className="pointer-events-none absolute border-2 border-[var(--accent)]"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, boxShadow: '0 0 0 100000px rgba(0,0,0,0.35)' }}
        >
          <div className="absolute -top-7 left-0 rounded-sm bg-black/75 px-1.5 py-0.5 text-[11px] leading-4 text-white">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </div>
      )}
      {!img && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-white/70">正在捕获屏幕…</div>
      )}
    </div>
  )
}
