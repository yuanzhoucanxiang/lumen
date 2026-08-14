import type { ReactNode } from 'react'

/**
 * 线性 SVG 图标库（24×24 viewBox，stroke=currentColor）
 * 统一 1.8px 线宽、圆角端点，替代 Emoji，保证全平台渲染一致。
 */

const PATHS = {
  /* 全部素材：四格 */
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  masonry: (
    <>
      <rect x="3.5" y="3.5" width="7" height="10" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="6" rx="1" />
      <rect x="3.5" y="16.5" width="7" height="4" rx="1" />
      <rect x="13.5" y="12.5" width="7" height="8" rx="1" />
    </>
  ),
  listRows: <path d="M4 6h16M4 12h16M4 18h16" />,
  star: (
    <path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6-5.1-2.8-5.1 2.8 1.1-5.6-4.2-3.9 5.7-.7z" />
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v2" />
      <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  folder: (
    <path d="M3.5 7a2 2 0 0 1 2-2h3.6l2 2.3h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  ),
  sparkles: (
    <>
      <path d="M11 5l1.5 3.8L16.5 10.5l-4 1.7L11 16l-1.5-3.8-4-1.7 4-1.7z" />
      <path d="M18 14.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" />
    </>
  ),
  tag: (
    <>
      <path d="M20 12.5l-7.5 7.5a1.5 1.5 0 0 1-2.1 0L3 12.6V4.5A1.5 1.5 0 0 1 4.5 3h8.1z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  library: (
    <>
      <path d="M5 4v16" />
      <path d="M9.5 4v16" />
      <path d="m13.5 5 4.6 15" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.12 3V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  import: (
    <>
      <path d="M12 3.5V15m0 0 4.2-4.2M12 15 7.8 10.8" />
      <path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  filter: <path d="M4 5.5h16l-6.2 7.2v5l-3.6 1.8v-7z" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.6 3.6a2.1 2.1 0 0 1 3 3L8 18.2l-4.2 1.2L5 15.2z" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 18.5 5-5 3 3 3.5-3.5 4 4" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  shapes: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <circle cx="16.5" cy="7" r="3.5" />
      <path d="M12 13.5 17.5 21h-11z" />
    </>
  ),
  palette: (
    <>
      <path d="M12 21.5a9.5 9.5 0 1 1 9.5-9.5c0 2.6-1.6 4-3.6 4h-2.4a2.2 2.2 0 0 0-1.6 3.7c.5.6.4 1.8-.9 1.8z" />
      <circle cx="7.6" cy="10.2" r="1.1" />
      <circle cx="11" cy="6.8" r="1.1" />
      <circle cx="15.4" cy="7.4" r="1.1" />
    </>
  ),
  check: <path d="M20 6.5 9.5 17 4 11.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
    </>
  ),
  pin: (
    <>
      <path d="M9 4h6l-1 7 3 2.5v2H7v-2l3-2.5z" />
      <path d="M12 15.5V20" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 14 4 9.5 8.5 5" />
      <path d="M4 9.5h10a5.5 5.5 0 0 1 0 11h-3.5" />
    </>
  ),
  rotate: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
    </>
  ),
  save: (
    <>
      <path d="M18.5 21h-13a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10.5l4.5 4.5V19a2 2 0 0 1-2 2z" />
      <path d="M16.5 21v-7.5h-9V21" />
      <path d="M8 3v4.5h7V3" />
    </>
  ),
  crop: (
    <>
      <path d="M6.5 2.5v13a2 2 0 0 0 2 2h13" />
      <path d="M2.5 6.5h13a2 2 0 0 1 2 2v13" />
    </>
  ),
  type: (
    <>
      <path d="M4.5 7V4.5h15V7" />
      <path d="M12 4.5V20" />
      <path d="M9 20h6" />
    </>
  ),
  arrowRight: <path d="M4.5 12h15m-6-6.5 6 6.5-6 6.5" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  external: (
    <>
      <path d="M17.5 13.5V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h5.5" />
      <path d="M14.5 3.5h6v6" />
      <path d="M10.5 13.5 20.5 3.5" />
    </>
  ),
  arrowUp: <path d="M12 19V5m-6.5 6L12 4.5 18.5 11" />,
  arrowDown: <path d="M12 5v14m-6.5-6 6 6.5 6-6.5" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  )
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export default function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.8
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  )
}
