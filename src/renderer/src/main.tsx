import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import FloatingBoard from './components/FloatingBoard'
import './index.css'

// 浮动置顶窗口入口：主进程以 ?floating=1&board=<id> 打开
const params = new URLSearchParams(window.location.search)
const isFloating = params.get('floating') === '1'
const floatingBoardId = Number(params.get('board') ?? '0')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isFloating && floatingBoardId > 0 ? <FloatingBoard boardId={floatingBoardId} /> : <App />}
  </React.StrictMode>
)
