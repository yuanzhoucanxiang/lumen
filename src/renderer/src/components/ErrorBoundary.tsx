import React from 'react'

interface State {
  error: Error | null
}

/**
 * 顶层错误边界：任何渲染期异常降级为错误卡片而非整窗白屏
 * （此前 Inspector 的 exif JSON.parse 曾因库数据损坏导致整窗崩溃）。
 * 点击「重新加载」整页重载即恢复（数据都在 SQLite，无丢失风险）。
 */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[error-boundary]', `${error.stack ?? error.message}\n${info.componentStack ?? ''}`)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
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
