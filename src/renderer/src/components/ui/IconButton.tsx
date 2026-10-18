import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

/**
 * 图标按钮原语：强制可访问名称；命中区默认 28px，active 使用主题强调色。
 */
export default function IconButton({
  label,
  active = false,
  size = 'md',
  children,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  active?: boolean
  size?: 'sm' | 'md'
  children: ReactNode
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={props.title ?? label}
      aria-pressed={active || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-colors duration-100 disabled:opacity-40',
        size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
        active
          ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
          : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
