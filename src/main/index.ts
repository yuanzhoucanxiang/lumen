import { app, BrowserWindow, protocol, shell } from 'electron'
import { createReadStream, statSync } from 'fs'
import { extname, join } from 'path'
import { Readable } from 'stream'
import { ensureLibrary, loadConfig } from './library'
import { registerIpc, resolveAssetFile } from './ipc'
import { closeDb } from './db'
import { startClipServer } from './clipServer'
import { syncWatchers, syncOnStartup } from './watcher'
import { cleanTrashOlderThan } from './repository'
import { initUpdater } from './updater'
import { initLogger, logger } from './logger'
import { backupDatabase } from './backup'
import { closeFloatingBoard, openFloatingBoard } from './floatingBoard'
import { ipcMain } from 'electron'

/** asset: 协议响应的 MIME 映射（视频/音频播放依赖正确的 Content-Type） */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  tiff: 'image/tiff', tif: 'image/tiff', psd: 'image/vnd.adobe.photoshop',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  m4a: 'audio/mp4', aac: 'audio/aac', wma: 'audio/x-ms-wma',
  ttf: 'font/ttf', otf: 'font/otf', ttc: 'font/collection', woff: 'font/woff', woff2: 'font/woff2'
}

let mainWindow: BrowserWindow | null = null

// asset: 协议必须声明为 privileged scheme（stream: true），否则 <video>/<audio> 无法播放该协议内容。
// 必须在 app ready 之前调用。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    title: 'LUMEN',
    backgroundColor: '#1c1d21',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true, // 渲染进程沙箱:preload 仅用 contextBridge/ipcRenderer,沙箱兼容
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 主窗口关闭时联动关闭浮动白板窗（防止无主窗口的孤儿浮动窗）
  mainWindow.on('closed', () => {
    mainWindow = null
    closeFloatingBoard()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 日志系统优先初始化,后续所有业务均可记录错误
  initLogger()

  // 注册 asset: 协议，用于在渲染进程中安全加载库内文件。
  // 手动构造响应：视频/音频播放需要正确的 Content-Type 与 Range/206 支持（net.fetch(file://) 不具备），
  // 否则 <video>/<audio> 报 MEDIA_ERR_SRC_NOT_SUPPORTED。
  // 注意：protocol.handle 的 Response body 必须是 Web ReadableStream，Node stream 需用 Readable.toWeb 转换。
  protocol.handle('asset', (request) => {
    const url = new URL(request.url)
    const id = url.hostname
    const t = url.searchParams.get('t')
    const kind = (t === 'o' ? 'original' : t === 's' ? 'storyboard' : 'thumbnail') as
      | 'original'
      | 'thumbnail'
      | 'storyboard'
    const file = resolveAssetFile(id, kind)
    if (!file) {
      logger.debug('[asset]', `404 ${url.pathname}`)
      return new Response(null, { status: 404 })
    }

    const mime = MIME_BY_EXT[extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'
    const size = statSync(file).size
    const range = request.headers.get('Range')
    logger.debug('[asset]', `${url.searchParams.get('t')} ${id} range=${range ?? 'none'} mime=${mime} size=${size}`)

    if (range) {
      // Range: bytes=start-end —— 视频 seek 依赖 206 响应
      const m = range.match(/bytes=(\d+)-(\d*)/)
      const start = m ? Math.max(0, parseInt(m[1], 10)) : 0
      const end = m && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
      if (start > end || start >= size) return new Response(null, { status: 416 })
      return new Response(Readable.toWeb(createReadStream(file, { start, end })), {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }

    return new Response(Readable.toWeb(createReadStream(file)), {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes'
      }
    })
  })

  // 初始化当前素材库
  ensureLibrary(loadConfig().current)

  // 启动时自动备份数据库（滚一份 library.db.bak,成本极低）
  try {
    backupDatabase()
  } catch (e) {
    logger.error('[backup]', `启动自动备份失败: ${(e as Error).message}`)
  }

  registerIpc(() => mainWindow)

  createWindow()

  // 自动更新（electron-updater，打包版生效）
  initUpdater(() => mainWindow)
  ipcMain.handle('app:version', () => app.getVersion())

  // 白板浮动置顶窗口
  ipcMain.handle('window:floatingOpen', (_e, boardId: number) => openFloatingBoard(boardId))
  ipcMain.handle('window:floatingClose', () => closeFloatingBoard())

  // 浏览器剪藏接收服务：导入成功后通知渲染进程刷新
  startClipServer((count) => {
    mainWindow?.webContents.send('clip:imported', count)
  })

  // 监控文件夹自动导入
  syncWatchers((count) => {
    mainWindow?.webContents.send('clip:imported', count)
  })

  // 启动增量同步：导入软件关闭期间监控目录新增的文件（类 Eagle 行为）
  void syncOnStartup((count) => {
    mainWindow?.webContents.send('clip:imported', count)
  })

  // 回收站自动清理（30 天）
  try {
    cleanTrashOlderThan(30)
  } catch (e) {
    logger.warn('[trash]', `回收站清理失败: ${(e as Error).message}`)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => closeDb())
