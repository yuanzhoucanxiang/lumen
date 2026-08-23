/**
 * 白板浮动置顶窗口（对标 PureRef：参考作画时贴在绘图软件旁边）。
 * 独立模块：index.ts（主窗生命周期）与 ipc.ts（白板删除联动）共用，避免循环依赖。
 * 窗口能力：标题条拖拽移动、最小化折叠为标题条窄条、一键归位到屏幕右上角；
 * 位置/尺寸/最小化态持久化到 config,重开保持与上次一致。
 */
import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'path'
import { loadConfig, saveConfig } from './library'

let floatingWindow: BrowserWindow | null = null
/** 浮动窗当前显示的白板 id（用于复用时切换白板、白板删除时联动关闭） */
let floatingBoardId: number | null = null

/** 折叠（最小化）状态：窗口高度收成仅标题条,保持置顶便于随时唤回 */
let floatingMinimized = false
/** 折叠前的窗口高度,展开时还原 */
let floatingRestoreHeight = 520
/** 标题条高度（渲染层 h-9=36px + 1px 底边框）,折叠后的窗口高度 */
const TITLE_BAR_HEIGHT = 37
/** 窗口最小尺寸（创建时固定;折叠需临时放宽 minHeight,否则 setBounds 被钳制） */
const MIN_W = 320
const MIN_H = 240

/** 窗口移动/缩放后的防抖保存定时器 */
let saveTimer: NodeJS.Timeout | null = null

interface FloatingWinState {
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
}

/** 从 config 读取上次浮动窗状态;无则 null */
function loadFloatingWindowState(): FloatingWinState | null {
  return loadConfig().floatingWindow ?? null
}

/** 把当前浮动窗状态写回 config（重开保持） */
function persistFloatingWindowState(): void {
  if (!floatingWindow || floatingWindow.isDestroyed()) return
  const b = floatingWindow.getBounds()
  const cfg = loadConfig()
  cfg.floatingWindow = {
    x: b.x,
    y: b.y,
    width: b.width,
    // 折叠时保存展开高度,展开时保存当前高度(恢复用)
    height: floatingMinimized ? floatingRestoreHeight : b.height,
    minimized: floatingMinimized
  }
  saveConfig(cfg)
}

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistFloatingWindowState()
  }, 400)
}

/** 保存的位置是否落在任一显示器工作区内(多屏插拔后防止窗口跑到屏外) */
function boundsOnScreen(b: Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    return cx >= wa.x && cx <= wa.x + wa.width && cy >= wa.y && cy <= wa.y + wa.height
  })
}

/** 打开白板浮动置顶窗口（已存在则切换到目标白板并聚焦;折叠态先展开） */
export function openFloatingBoard(boardId: number): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    // 复用已开的窗：折叠中先展开,否则切板后画布看不见
    if (floatingMinimized) restoreFloatingBoard()
    // 白板不同则通知渲染层切换（board:switch），避免用户以为浮动的是新白板
    if (floatingBoardId !== boardId) {
      floatingBoardId = boardId
      floatingWindow.webContents.send('board:switch', boardId)
    }
    floatingWindow.focus()
    return
  }
  // 新开窗:恢复上次位置/尺寸/最小化态
  const saved = loadFloatingWindowState()
  floatingMinimized = saved?.minimized ?? false
  floatingRestoreHeight = saved && saved.height > TITLE_BAR_HEIGHT ? saved.height : 520
  const width = saved?.width ?? 680
  const height = floatingMinimized ? TITLE_BAR_HEIGHT : floatingRestoreHeight
  const opts: Electron.BrowserWindowConstructorOptions = {
    width,
    height,
    minWidth: MIN_W,
    minHeight: floatingMinimized ? TITLE_BAR_HEIGHT : MIN_H,
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
  }
  if (saved && boundsOnScreen(saved)) {
    opts.x = saved.x
    opts.y = saved.y
  }
  floatingBoardId = boardId
  floatingWindow = new BrowserWindow(opts)
  // floating 层级：常驻普通窗口之上、全屏之下
  floatingWindow.setAlwaysOnTop(true, 'floating')
  floatingWindow.on('ready-to-show', () => floatingWindow?.show())
  floatingWindow.on('move', schedulePersist)
  floatingWindow.on('resize', schedulePersist)
  floatingWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    persistFloatingWindowState()
  })
  floatingWindow.on('closed', () => {
    floatingWindow = null
    floatingBoardId = null
    floatingMinimized = false
  })
  const query = { floating: '1', board: String(boardId), minimized: floatingMinimized ? '1' : '0' }
  if (process.env['ELECTRON_RENDERER_URL']) {
    const u = new URL(process.env['ELECTRON_RENDERER_URL'])
    u.searchParams.set('floating', '1')
    u.searchParams.set('board', String(boardId))
    u.searchParams.set('minimized', floatingMinimized ? '1' : '0')
    void floatingWindow.loadURL(u.toString())
  } else {
    void floatingWindow.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
}

export function closeFloatingBoard(): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.close()
}

/** 最小化：折叠为仅标题条高度的窄条（对标 PureRef）,仍置顶可拖拽,画布由渲染层卸载 */
export function minimizeFloatingBoard(): void {
  if (!floatingWindow || floatingWindow.isDestroyed() || floatingMinimized) return
  floatingMinimized = true
  const b = floatingWindow.getBounds()
  floatingRestoreHeight = Math.max(TITLE_BAR_HEIGHT, b.height)
  // 先放宽最小高度,否则 setBounds 会被 minHeight 钳制,收不到标题条高
  floatingWindow.setMinimumSize(MIN_W, TITLE_BAR_HEIGHT)
  floatingWindow.setBounds({ ...b, height: TITLE_BAR_HEIGHT })
  floatingWindow.webContents.send('board:minimized', true)
  schedulePersist()
}

/** 展开：从标题条窄条还原到折叠前大小 */
export function restoreFloatingBoard(): void {
  if (!floatingWindow || floatingWindow.isDestroyed() || !floatingMinimized) return
  floatingMinimized = false
  const b = floatingWindow.getBounds()
  floatingWindow.setMinimumSize(MIN_W, MIN_H)
  floatingWindow.setBounds({ ...b, height: floatingRestoreHeight })
  floatingWindow.webContents.send('board:minimized', false)
  schedulePersist()
}

/** 切换折叠/展开,返回新状态 */
export function toggleFloatingBoardMinimize(): boolean {
  if (floatingMinimized) restoreFloatingBoard()
  else minimizeFloatingBoard()
  return floatingMinimized
}

/** 归位：浮动窗贴回所在显示器工作区右上角（对标 PureRef 默认参考位） */
export function resetFloatingBoardPosition(): void {
  if (!floatingWindow || floatingWindow.isDestroyed()) return
  const wa = screen.getDisplayMatching(floatingWindow.getBounds()).workArea
  const [w, h] = floatingWindow.getSize()
  const margin = 8
  floatingWindow.setPosition(wa.x + wa.width - w - margin, wa.y + margin)
}

/** 指定白板被删除时联动关闭浮动窗（否则画布静默清空、无提示） */
export function closeFloatingBoardIfBoard(boardId: number): void {
  if (floatingWindow && !floatingWindow.isDestroyed() && floatingBoardId === boardId) {
    floatingWindow.close()
  }
}
