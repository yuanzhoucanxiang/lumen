import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import FloatingBoard from './components/FloatingBoard'
import ScreenCapture from './components/ScreenCapture'
import ErrorBoundary from './components/ErrorBoundary'
import { initializeTheme } from './theme'
import './index.css'
import './pixel-theme.css'
import './cyber-theme.css'

// 在 React 首次绘制前应用持久化主题，避免启动时先闪过错误主题。
initializeTheme()

// 浮动置顶窗口入口：主进程以 ?floating=1&board=<id> 打开
// 区域截图覆层入口：主进程以 ?screenshot=1 打开（全屏透明无边框窗）
const params = new URLSearchParams(window.location.search)
const isFloating = params.get('floating') === '1'
const floatingBoardId = Number(params.get('board') ?? '0')
const isScreenshot = params.get('screenshot') === '1'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isFloating && floatingBoardId > 0 ? <FloatingBoard boardId={floatingBoardId} /> : isScreenshot ? <ScreenCapture /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
)
