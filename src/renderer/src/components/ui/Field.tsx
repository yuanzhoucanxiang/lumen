import type { ReactNode } from 'react'

/**
 * 表单字段原语（里程碑 199）：标题 / 说明 / 错误三件套，输入控件由调用方传入。
 * 统一标签字号与错误色，避免每个弹窗各写一套。
 */
export default function Field({
  label,
  htmlFor,
  hint,
  error,
  children
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[11px] font-medium text-[var(--text-dim)]">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-[var(--danger)]">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-[var(--text-faint)]">{hint}</p>
      ) : null}
    </div>
  )
}
