import { cn } from './cn'
import Icon from '../Icon'
import type { IconName } from '../Icon'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconName
  title?: string
}

/**
 * 分段控件原语（里程碑 199）：布局切换、模式切换等互斥选项。
 * 输出 role=group + aria-pressed，保持既有测试与读屏契约。
 */
export default function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className
}: {
  label: string
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex items-center border border-[var(--border)]', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={value === option.value}
          title={option.title ?? option.label}
          className={cn(
            'flex h-7 w-7 items-center justify-center transition-colors duration-100',
            value === option.value
              ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
              : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
          )}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <Icon name={option.icon} size={13} /> : option.label}
        </button>
      ))}
    </div>
  )
}
