/**
 * 白板浮动置顶窗口（对标 PureRef：参考作画时贴在绘图软件旁边）。
 * 独立模块：index.ts（主窗生命周期）与 ipc.ts（白板删除联动）共用，避免循环依赖。
 */
import { BrowserWindow } from 'electron'
import { join } from 'path'

let floatingWindow: BrowserWindow | null = null
/** 浮动窗当前显示的白板 id（用于复用时切换白板、白板删除时联动关闭） */
let floatingBoardId: number | null = null

/** 打开白板浮动置顶窗口（已存在则切换到目标白板并聚焦） */
export function openFloatingBoard(boardId: number): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    // 复用已开的窗：白板不同则通知渲染层切换（board:switch），避免用户以为浮动的是新白板
    if (floatingBoardId !== boardId) {
      floatingBoardId = boardId
      floatingWindow.webContents.send('board:switch', boardId)
    }
    floatingWindow.focus()
    return
  }
  floatingBoardId = boardId
  floatingWindow = new BrowserWindow({
    width: 680,
    height: 520,
    minWidth: 320,
    minHeight: 240,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'LUMEN 白板',
    backgroundColor: '#1c1d21',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  // floating 层级：常驻普通窗口之上、全屏之下
  floatingWindow.setAlwaysOnTop(true, 'floating')
  floatingWindow.on('ready-to-show', () => floatingWindow?.show())
  floatingWindow.on('closed', () => {
    floatingWindow = null
    floatingBoardId = null
  })
  const query = { floating: '1', board: String(boardId) }
  if (process.env['ELECTRON_RENDERER_URL']) {
    const u = new URL(process.env['ELECTRON_RENDERER_URL'])
    u.searchParams.set('floating', '1')
    u.searchParams.set('board', String(boardId))
    void floatingWindow.loadURL(u.toString())
  } else {
    void floatingWindow.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
}

export function closeFloatingBoard(): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.close()
}

/** 指定白板被删除时联动关闭浮动窗（否则画布静默清空、无提示） */
export function closeFloatingBoardIfBoard(boardId: number): void {
  if (floatingWindow && !floatingWindow.isDestroyed() && floatingBoardId === boardId) {
    floatingWindow.close()
  }
}
