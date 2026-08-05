import { useCallback, useEffect, useRef, useState } from 'react'

/** HSL -> RGB（h:0-360, s/l:0-1） */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return [h, s, l]
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/**
 * 色环选择器：角度=色相，半径=饱和度，下方滑块=明度
 */
export default function ColorWheel({
  value,
  onChange,
  size = 180
}: {
  value?: string
  onChange: (hex: string) => void
  size?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef(false)
  const [lightness, setLightness] = useState(() => {
    if (value) return Math.round(rgbToHsl(...hexToRgb(value))[2] * 100)
    return 50
  })

  const radius = size / 2

  // 绘制色环
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(size, size)
    const l = lightness / 100
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - radius
        const dy = y - radius
        const dist = Math.sqrt(dx * dx + dy * dy)
        const i = (y * size + x) * 4
        if (dist <= radius) {
          let hue = (Math.atan2(dy, dx) * 180) / Math.PI
          if (hue < 0) hue += 360
          const sat = Math.min(dist / radius, 1)
          const [r, g, b] = hslToRgb(hue, sat, l)
          img.data[i] = r
          img.data[i + 1] = g
          img.data[i + 2] = b
          img.data[i + 3] = dist > radius - 1.5 ? Math.max(0, Math.round(255 * (radius - dist) / 1.5)) : 255
        }
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [lightness, size, radius])

  const pick = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = clientX - rect.left - radius
      const y = clientY - rect.top - radius
      const dist = Math.sqrt(x * x + y * y)
      let hue = (Math.atan2(y, x) * 180) / Math.PI
      if (hue < 0) hue += 360
      const sat = Math.min(dist / radius, 1)
      const [r, g, b] = hslToRgb(hue, sat, lightness / 100)
      onChange(rgbToHex(r, g, b))
    },
    [lightness, onChange, radius]
  )

  // 当前选中位置标记
  const marker = (() => {
    if (!value) return null
    const [h, s] = rgbToHsl(...hexToRgb(value))
    const angle = (h * Math.PI) / 180
    const r = s * radius
    return { x: radius + r * Math.cos(angle), y: radius + r * Math.sin(angle) }
  })()

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          className="cursor-crosshair"
          onPointerDown={(e) => {
            draggingRef.current = true
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            pick(e.clientX, e.clientY)
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) pick(e.clientX, e.clientY)
          }}
          onPointerUp={() => {
            draggingRef.current = false
          }}
        />
        {marker && (
          <div
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: marker.x, top: marker.y, background: value }}
          />
        )}
      </div>
      <div className="flex w-full items-center gap-2">
        <span className="text-[11px] text-[var(--text-dim)]">明度</span>
        <input
          type="range"
          min={10}
          max={90}
          value={lightness}
          className="flex-1"
          onChange={(e) => setLightness(Number(e.target.value))}
        />
      </div>
    </div>
  )
}
