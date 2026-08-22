import { useSyncExternalStore } from 'react'

export type ThemeId = 'silver-gelatin' | 'pixel-glitch' | 'cyber-glitch'

export interface ThemeDefinition {
  id: ThemeId
  name: string
  code: string
  description: string
  standard?: boolean
}

export const DEFAULT_THEME: ThemeId = 'silver-gelatin'
export const THEME_STORAGE_KEY = 'lumen.theme'

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'silver-gelatin',
    name: '银盐鸦影',
    code: 'RA–01',
    description: '石墨工作台、银灰相纸与暗房安全灯；安静、克制，突出素材本身。',
    standard: true
  },
  {
    id: 'pixel-glitch',
    name: '像素故障',
    code: 'PX–03.1',
    description: '复古科幻终端美学与伪档案系统；继承原布局，以索引层级、点阵反馈和克制状态色建立身份。'
  },
  {
    id: 'cyber-glitch',
    name: '信号故障',
    code: 'PX–02R',
    description: '海军黑信号台、磷光青通道与洋红校验位；锐利、主动，以短促离散故障反馈强化数字工作流。'
  }
] as const

const listeners = new Set<() => void>()

function isThemeId(value: string | null): value is ThemeId {
  return value === 'silver-gelatin' || value === 'pixel-glitch' || value === 'cyber-glitch'
}

export function loadTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeId(saved) ? saved : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

let currentTheme: ThemeId = loadTheme()

function commitTheme(theme: ThemeId): void {
  currentTheme = theme
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = 'dark'
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'silver-gelatin' ? '#090907' : theme === 'cyber-glitch' ? '#070a0f' : '#060807'
  )
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* 渲染层存储不可用时仅保持本次会话主题。 */
  }
  listeners.forEach((listener) => listener())
}

export function applyTheme(theme: ThemeId): void {
  if (theme === currentTheme && document.documentElement.dataset.theme === theme) return
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> }
  }
  if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    doc.startViewTransition(() => commitTheme(theme))
  } else {
    commitTheme(theme)
  }
}

export function initializeTheme(): ThemeId {
  const theme = loadTheme()
  commitTheme(theme)
  return theme
}

export function getTheme(): ThemeId {
  return currentTheme
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getTheme,
    () => DEFAULT_THEME
  )
}
