import React from 'react'

interface State {
  error: Error | null
}

/**
 * 错误边界：默认整页错误卡片（根节点用）；传入 fallback 则以局部占位降级
 * （面板级用，如 Inspector 崩溃不拖垮整个应用）。
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  State
> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[error-boundary]', `${error.stack ?? error.message}\n${info.componentStack ?? ''}`)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[var(--bg-base)] p-6 text-[var(--text-main)]">
        <div className="text-[14px] font-medium">界面出现异常，素材数据不受影响</div>
        <pre className="max-w-[80vw] overflow-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2 text-[11px] text-[var(--text-faint)]">
          {this.state.error.message}
        </pre>
        <button className="btn-primary" onClick={() => location.reload()}>
          重新加载
        </button>
      </div>
    )
  }
}
