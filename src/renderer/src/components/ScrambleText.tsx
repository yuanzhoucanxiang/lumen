import { useEffect, useState } from 'react'

/** 故障字符池：信号干扰感 */
const GLYPHS = '!<>-_/[]{}=+*^?#$01'

/**
 * 文本解码（scramble）效果：字符从乱码逐位收敛为最终文本。
 * text 变化时重新播放一次。
 */
export default function ScrambleText({
  text,
  className,
  speed = 28
}: {
  text: string
  className?: string
  /** 每帧毫秒数 */
  speed?: number
}) {
  const [out, setOut] = useState(text)

  useEffect(() => {
    let frame = 0
    const total = Math.max(10, text.length * 2)
    const id = setInterval(() => {
      frame++
      const settled = Math.floor((frame / total) * text.length)
      let s = ''
      for (let i = 0; i < text.length; i++) {
        s +=
          i < settled || text[i] === ' '
            ? text[i]
            : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
      setOut(s)
      if (frame >= total) {
        setOut(text)
        clearInterval(id)
      }
    }, speed)
    return () => clearInterval(id)
  }, [text, speed])

  return (
    <span aria-label={text} className={className}>
      {out}
    </span>
  )
}
