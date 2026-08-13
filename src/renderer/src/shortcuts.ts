/**
 * 快捷键自定义：localStorage 持久化，仅渲染层（快捷键是纯 UI 行为）。
 * 支持动作：预览/全选/撤销删除。设置页可重新绑定，改动后派发 'lumen:shortcuts' 事件供 App 重读。
 */

export interface ShortcutDef {
  id: 'preview' | 'selectAll' | 'undoDelete'
  label: string
  defaultKeys: string
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'preview', label: '打开/关闭预览', defaultKeys: 'Space' },
  { id: 'selectAll', label: '全选素材', defaultKeys: 'Ctrl+A' },
  { id: 'undoDelete', label: '撤销删除', defaultKeys: 'Ctrl+Z' }
]

const STORE_KEY = 'lumen.shortcuts'

/** 读取快捷键映射（缺省回退默认值） */
export function loadShortcuts(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const d of SHORTCUT_DEFS) map[d.id] = d.defaultKeys
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, string>
      for (const d of SHORTCUT_DEFS) {
        if (typeof saved[d.id] === 'string' && saved[d.id]) map[d.id] = saved[d.id]
      }
    }
  } catch {
    /* 损坏的回退默认 */
  }
  return map
}

/** 保存单个动作的快捷键并通知 App 重读 */
export function saveShortcut(id: string, keys: string): void {
  const map = loadShortcuts()
  map[id] = keys
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map))
  } catch {
    /* localStorage 不可用时静默(快捷键仅本次会话生效) */
  }
  window.dispatchEvent(new Event('lumen:shortcuts'))
}

/** 按键事件 -> 快捷键字符串（'Ctrl+A' / 'Space' / 'Shift+Ctrl+S'） */
export function eventToKeys(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  parts.push(key)
  return parts.join('+')
}

/** 判断按键事件是否匹配某快捷键字符串（Ctrl 绑定在 macOS 上同时匹配 Cmd，与旧版行为一致） */
export function matchesShortcut(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.split('+')
  const key = parts[parts.length - 1]
  const wantCtrl = parts.includes('Ctrl')
  const wantShift = parts.includes('Shift')
  const wantAlt = parts.includes('Alt')
  const eKey = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  return (
    (wantCtrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey) &&
    e.shiftKey === wantShift &&
    e.altKey === wantAlt &&
    eKey === key
  )
}
