/**
 * 白板画布外观（里程碑 251 从 BoardCanvas 抽出）：
 * 存于 `boards.appearance` 的 JSON，BoardCanvas（渲染）与 BoardPanel（外观抽屉）共用
 * 同一份默认值 / 预设色 / 解析逻辑。此前两处各写一份解析（加字段要改两遍），
 * 且 BoardPanel 为了取色值要从 BoardCanvas 导入（面板反向依赖画布）。
 * 解析语义：字段缺失或类型不对一律回退默认，未知 bg 交给 resolveBgColor 白名单兜底
 * （bg 可能来自可导入的 .lumenboard）。
 */

export interface BoardAppearance {
  /** 预设键（dark/gray/light/white/black）或 #hex */
  bg: string
  /** 点阵网格显示 */
  grid: boolean
  /** 点阵密度（px） */
  gridSize: number
  /** 智能吸附持久开关（里程碑 247）：Alt 仍是拖拽中的临时关闭 */
  snap: boolean
}

export const DEFAULT_BOARD_APPEARANCE: BoardAppearance = { bg: 'dark', grid: true, gridSize: 24, snap: true }

/** 画布外观预设（bg 键 → 颜色）。外观抽屉色板与画布/导出共用 */
export const APPEARANCE_PRESETS: Record<string, string> = {
  dark: '#191c20',
  gray: '#262a31',
  light: '#e8e8e8',
  white: '#ffffff',
  black: '#0c0d0f'
}

/** 画布背景白名单：仅预设键或 #hex，其余回退 dark */
export function resolveBgColor(bg: string): string {
  if (APPEARANCE_PRESETS[bg]) return APPEARANCE_PRESETS[bg]
  return /^#[0-9a-f]{3,8}$/i.test(bg) ? bg : APPEARANCE_PRESETS.dark
}

/** hex 颜色亮度（0-1），用于点阵颜色深浅自适应 */
export function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0.2
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** 解析 boards.appearance 的 JSON（空/损坏/字段类型不对均回退默认） */
export function parseBoardAppearance(raw: string | null | undefined): BoardAppearance {
  if (!raw) return DEFAULT_BOARD_APPEARANCE
  try {
    const p = JSON.parse(raw) as Record<string, unknown> | null
    if (!p || typeof p !== 'object') return DEFAULT_BOARD_APPEARANCE
    return {
      bg: typeof p.bg === 'string' && p.bg ? p.bg : DEFAULT_BOARD_APPEARANCE.bg,
      grid: p.grid !== false,
      gridSize: Number(p.gridSize) || DEFAULT_BOARD_APPEARANCE.gridSize,
      snap: p.snap !== false
    }
  } catch {
    return DEFAULT_BOARD_APPEARANCE
  }
}
