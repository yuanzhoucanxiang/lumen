/**
 * 全局快捷键派发（里程碑 251 从 App.tsx 抽出）。
 * 只负责"按键 → 库操作"的路由：白板/输入框让位、预览开关、评分、方向键导航等。
 * 具体操作逻辑在 store / galleryNav 里，这里保持薄；App 只挂这个 hook。
 */
import { useEffect } from 'react'
import { useLibraryStore } from './stores/libraryStore'
import { loadShortcuts, matchesShortcut } from './shortcuts'
import { galleryNavMove } from './galleryNav'

/** 图库方向的按键（网格感知移动 + Shift 扩选） */
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

export function useGlobalShortcuts(): void {
  useEffect(() => {
    let sc = loadShortcuts()
    const onShortcutsChanged = (): void => {
      sc = loadShortcuts()
    }
    window.addEventListener('lumen:shortcuts', onShortcutsChanged)

    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const s = useLibraryStore.getState()
      // 白板全屏或焦点在画布内时素材库不可见/不活跃：
      // 库级快捷键(删除/撤销/全选/评分/方向键)让位给画布
      // (否则白板里按 Delete/Ctrl+A 会连带操作素材库选中项)
      const boardActive =
        s.boardViewMode === 'board' ||
        (typeof target.closest === 'function' && !!target.closest('[data-board-frame]'))
      if (boardActive) return

      if (e.key === 'Delete') {
        if (inInput) return
        void s.deleteSelection(s.view.type === 'trash')
      } else if (e.key === 'Escape') {
        s.openPreview(null)
        s.openEditor(null)
        s.setSelection([])
        // 助手面板无更上层浮层时一并收起(预览/编辑器打开时先让 Esc 关它们)
        if (!s.previewId && !s.editorId) s.closeAgentPanel()
      } else if (matchesShortcut(e, sc.undoDelete)) {
        if (inInput) return
        e.preventDefault()
        void s.undoLast()
      } else if (matchesShortcut(e, sc.selectAll)) {
        if (inInput) return
        e.preventDefault()
        // 图库分页后 assets 只是已加载部分，全选要走 store（会把剩余页取完）
        void s.selectAllAssets()
      } else if (matchesShortcut(e, sc.preview)) {
        if (inInput) return
        e.preventDefault()
        // Eagle 式开关:再按一次关闭(此前只能 Esc)
        if (s.previewId) s.openPreview(null)
        else if (s.selection.length === 1) s.openPreview(s.selection[0])
      } else if (matchesShortcut(e, sc.screenshot)) {
        e.preventDefault()
        void window.api.screenshotStart().catch(() => useLibraryStore.getState().showToast('截图启动失败'))
      } else if (matchesShortcut(e, sc.focusSearch)) {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索素材"], input[aria-label="AI 智能搜索"]')
        if (input) {
          input.focus()
          input.select()
        }
      } else if (matchesShortcut(e, sc.toggleAssistant)) {
        // 助手面板开关(允许在输入框内触发——它是全局面板而非图库操作)
        e.preventDefault()
        useLibraryStore.getState().toggleAgentPanel()
      } else if (matchesShortcut(e, sc.toggleInspector)) {
        e.preventDefault()
        useLibraryStore.getState().toggleInspector()
      } else if (/^[0-5]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (inInput) return
        const star = Number(e.key)
        // 预览打开时 0 是缩放复位(Preview 内部处理),不当作清星
        if (star === 0 && s.previewId) return
        // 单张/多张同一路径(多选批量打星 + 一次反馈),见 store.rateAssets
        void s.rateAssets(s.selection, star)
      } else if (ARROW_KEYS.has(e.key)) {
        if (inInput) return
        const list = s.assets
        if (list.length === 0) return
        e.preventDefault()
        s.setSelection(galleryNavMove(e.key, s.selection, list, e.shiftKey))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('lumen:shortcuts', onShortcutsChanged)
    }
  }, [])
}
