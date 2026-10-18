import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'ghost' | 'danger' | 'quiet'
type Size = 'sm' | 'md'

/**
 * 通用按钮原语（里程碑 199）：把主操作/幽灵/危险/安静四种语义收敛到一处。
 * 轮廓与颜色仍由主题 CSS（btn-primary/btn-ghost/btn-danger）提供，组件只管语义与尺寸。
 */
export default function Button({
  variant = 'ghost',
  size = 'sm',
  icon,
  children,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}) {
  const variantClass =
    variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'quiet' ? '' : 'btn-ghost'
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-100 disabled:opacity-40',
        variantClass,
        size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]',
        variant === 'quiet' && 'text-[var(--text-dim)] hover:text-[var(--text-main)]',
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
