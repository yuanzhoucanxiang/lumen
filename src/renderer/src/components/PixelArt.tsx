import { useMemo } from 'react'

/**
 * 像素画渲染：把字符点阵图转成单个 div 的 box-shadow 像素群。
 * map 中每个字符对应 palette 里的一个颜色，'.' 为透明。
 */
export default function PixelArt({
  map,
  palette,
  pixel = 6,
  className
}: {
  map: string[]
  palette: Record<string, string>
  pixel?: number
  className?: string
}) {
  const { shadow, w, h } = useMemo(() => {
    const parts: string[] = []
    let w = 0
    for (let y = 0; y < map.length; y++) {
      const row = map[y]
      w = Math.max(w, row.length)
      for (let x = 0; x < row.length; x++) {
        const c = palette[row[x]]
        if (c) parts.push(`${x * pixel}px ${y * pixel}px 0 0 ${c}`)
      }
    }
    return { shadow: parts.join(','), w, h: map.length }
  }, [map, palette, pixel])

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{ width: w * pixel, height: h * pixel, position: 'relative' }}
    >
      <div style={{ position: 'absolute', width: pixel, height: pixel, boxShadow: shadow }} />
    </div>
  )
}
