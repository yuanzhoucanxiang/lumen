import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * 弹窗焦点管理（里程碑 194c）：
 * - 打开时把焦点移入弹窗（优先 [autofocus]），关闭时还给打开前的元素；
 * - Tab / Shift+Tab 在弹窗内循环，不逃到遮罩后的图库；
 * - Esc 只由最上层弹窗处理（嵌套确认框不会连带关掉底层设置页）。
 *
 * 不改变现有弹窗 DOM 结构：调用方把 ref 挂到 role="dialog" 元素即可。
 * 已在组件内自行处理 Esc 的弹窗可传 closeOnEscape:false，但仍参与焦点陷阱与栈顺序。
 */
let dialogSeq = 0
const dialogStack: number[] = []
/** 焦点刚进入弹窗前的元素（读取 FocusEvent.relatedTarget；解决 autoFocus 抢在 effect 之前的问题） */
let focusBeforeDialog: HTMLElement | null = null

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target as HTMLElement | null
      const related = (event as FocusEvent).relatedTarget as HTMLElement | null
      const targetDialog = target?.closest?.('[role="dialog"]') ?? null
      const relatedDialog = related?.closest?.('[role="dialog"]') ?? null
      // 只有“从弹窗外进入某个弹窗”才记录；弹窗内部移动不覆盖
      if (targetDialog && targetDialog !== relatedDialog) {
        focusBeforeDialog = related && related.isConnected ? related : null
      }
    },
    true
  )
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0
}

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { active?: boolean; closeOnEscape?: boolean } = {}
): void {
  const { active = true, closeOnEscape = true } = options
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const closeOnEscapeRef = useRef(closeOnEscape)
  closeOnEscapeRef.current = closeOnEscape

  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return

    const id = ++dialogSeq
    dialogStack.push(id)
    const activeNow = document.activeElement as HTMLElement | null
    const previous = el.contains(activeNow) ? focusBeforeDialog : activeNow

    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    const focusables = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible)
    const explicit = el.querySelector<HTMLElement>('[data-autofocus], [autofocus]')
    const initial = explicit ?? el
    if (explicit || !el.contains(document.activeElement)) initial.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent): void => {
      // 只有最上层弹窗响应键盘；嵌套时底层不会同时关闭
      if (dialogStack[dialogStack.length - 1] !== id) return

      if (e.key === 'Escape' && closeOnEscapeRef.current) {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const list = focusables()
      if (list.length === 0) {
        e.preventDefault()
        el.focus({ preventScroll: true })
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const activeEl = document.activeElement as HTMLElement | null

      if (!activeEl || !el.contains(activeEl)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (activeEl === el) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (e.shiftKey && activeEl === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const index = dialogStack.indexOf(id)
      if (index >= 0) dialogStack.splice(index, 1)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [active, ref])
}
