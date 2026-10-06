import { app, BrowserWindow, protocol, shell } from 'electron'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname, join } from 'path'
import { Readable } from 'stream'
import { ensureLibrary, loadConfig } from './library'
import { registerIpc, resolveAssetFile } from './ipc'
import { closeDb } from './db'
import { startClipServer } from './clipServer'
import { syncWatchers, syncOnStartup } from './watcher'
import { cleanTrashOlderThan } from './repository'
import { autoBackupStartup } from './backup'
import { runStartupMaintenance } from './maintenance'
import { initUpdater } from './updater'
import { initLogger, logger } from './logger'
import { backupDatabase } from './backup'
import {
  closeFloatingBoard,
  minimizeFloatingBoard,
  openFloatingBoard,
  resetFloatingBoardPosition,
  restoreFloatingBoard,
  toggleFloatingBoardMinimize
} from './floatingBoard'
import { ipcMain } from 'electron'

// 无头 CI(xvfb):禁用 GPU 硬件加速,让重载/导入等场景在 headless Chromium 下更稳
if (process.env.LUMEN_HEADLESS === '1') {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
}

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

/** asset: 响应公共头。sandbox+禁脚本防库内 SVG（恶意 .lumenboard/导入文件）以文档方式打开时执行脚本；
 *  对 <img>/<video>/<audio> 子资源加载无影响（CSP 不作用于非文档子资源）。
 *  ACAO 必需：渲染层 fetch(asset://)（导出 SVG/PNG 嵌图）走 CORS 模式,无此头会 Failed to fetch
 *  （<img> 为 no-cors 不受影响——此前缺该头导致 SVG 导出嵌图静默降级为占位框） */
function ASSET_RESPONSE_HEADERS(mime: string, contentRange?: string, length?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    // 库内文件按 id 不可变（编辑过会换 URL 上的 e= 版本号），可安全缓存。
    // 白板/图库元素滚出视口会被卸载，没有这条每次滚回都要重走协议 + existsSync + 读盘解码
    'Cache-Control': 'max-age=86400, immutable'
  }
  if (contentRange) h['Content-Range'] = contentRange
  if (length) h['Content-Length'] = length
  return h
}

// 单实例锁:第二实例启动时聚焦已有窗口后自行退出。两个实例并发写同一素材库会互相
// 锁定/损坏(备份恢复曾因双开实例锁 wal 暴露),config.json 也无并发保护。
// LUMEN_ALLOW_MULTI=1 为测试/调试逃生门(itest 起 dev 时注入,不受已运行正式版影响)。
const gotSingleInstanceLock = app.requestSingleInstanceLock()
const allowMulti = process.env.LUMEN_ALLOW_MULTI === '1'
if (!gotSingleInstanceLock && !allowMulti) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

// asset: 协议必须声明为 privileged scheme（stream: true），否则 <video>/<audio> 无法播放该协议内容。
// corsEnabled: true 使渲染层 fetch(asset://) 可用——SVG/PNG 导出的嵌图依赖它;
// 缺失时 fetch 恒 Failed to fetch（<img> 为 no-cors 不受影响,故此前仅导出场景静默失败）。
// 必须在 app ready 之前调用。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
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
    // 仅放行 http(s)（与 shell:openExternal IPC 同一白名单）；file:///自定义协议处理器一律拒绝
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 导航防护：preload 带全部 IPC 面，只允许自身页面（dev server / file://）持有；
  // 页面发起的跨文档导航一律拦截，外链转交系统浏览器
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl ? url.startsWith(devUrl) : url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 第二实例已在上面 quit():跳过全部初始化,避免退出前创建窗口/连接库
  if (!gotSingleInstanceLock && !allowMulti) return

  // 日志系统优先初始化,后续所有业务均可记录错误
  initLogger()

  // 注册 asset: 协议，用于在渲染进程中安全加载库内文件。
  // 手动构造响应：视频/音频播放需要正确的 Content-Type 与 Range/206 支持（net.fetch(file://) 不具备），
  // 否则 <video>/<audio> 报 MEDIA_ERR_SRC_NOT_SUPPORTED。
  // 注意：protocol.handle 的 Response body 必须是 Web ReadableStream，Node stream 需用 Readable.toWeb 转换。
  protocol.handle('asset', async (request) => {
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
    // stat 异步化:图库滚动时每个缩略图请求都会走到这里,同步 IO 会累积阻塞主进程;
    // 文件在解析与 stat 之间消失(编辑回退/清理竞态)返回 404 而非抛未捕获异常
    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      logger.debug('[asset]', `404 (文件已消失) ${url.pathname}`)
      return new Response(null, { status: 404 })
    }
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
        headers: ASSET_RESPONSE_HEADERS(mime, `bytes ${start}-${end}/${size}`, String(end - start + 1))
      })
    }

    return new Response(Readable.toWeb(createReadStream(file)), {
      headers: ASSET_RESPONSE_HEADERS(mime, undefined, String(size))
    })
  })

  // 初始化当前素材库
  ensureLibrary(loadConfig().current)

  // 启动时自动备份数据库（滚一份 library.db.bak,成本极低）
  void backupDatabase().catch((e: unknown) => {
    logger.error('[backup]', `启动自动备份失败: ${(e as Error).message}`)
  })

  registerIpc(() => mainWindow)

  createWindow()

  // 自动更新（electron-updater，打包版生效）
  initUpdater(() => mainWindow)
  ipcMain.handle('app:version', () => app.getVersion())

  // 自动备份:延迟执行不拖慢启动(打包版默认;开发模式用 LUMEN_AUTO_BACKUP=1 强制,供测试)
  const autoBackupDelay = Number(process.env.LUMEN_AUTO_BACKUP_DELAY ?? 20000)
  setTimeout(() => {
    void autoBackupStartup().catch((e) => logger.warn('[backup]', `自动备份异常: ${(e as Error).message}`))
  }, autoBackupDelay)

  // 启动维护(孤儿清理 + dHash 回填):延迟执行不阻塞启动
  setTimeout(() => {
    void runStartupMaintenance().catch((e) => logger.warn('[maintenance]', `启动维护异常: ${(e as Error).message}`))
  }, autoBackupDelay + 3000)

  // 白板浮动置顶窗口
  ipcMain.handle('window:floatingOpen', (_e, boardId: number) => openFloatingBoard(boardId))
  ipcMain.handle('window:floatingClose', () => closeFloatingBoard())
  ipcMain.handle('window:floatingMinimize', () => minimizeFloatingBoard())
  ipcMain.handle('window:floatingRestore', () => restoreFloatingBoard())
  ipcMain.handle('window:floatingToggleMinimize', () => toggleFloatingBoardMinimize())
  ipcMain.handle('window:floatingResetPos', () => resetFloatingBoardPosition())

  // 本机接收服务(浏览器剪藏 /clip + AI Agent /import)：导入成功后通知渲染进程刷新,
  // 进度复用 import:progress 通道,后台任务事件走 agent:notify
  startClipServer(
    (count, source) => {
      mainWindow?.webContents.send('clip:imported', count, source)
    },
    (phase, done, total) => {
      mainWindow?.webContents.send('import:progress', { phase, done, total })
    },
    (event) => {
      mainWindow?.webContents.send('agent:notify', event)
    }
  )

  // 监控文件夹自动导入
  syncWatchers((count) => {
    mainWindow?.webContents.send('clip:imported', count, 'watcher')
  })

  // 启动增量同步：导入软件关闭期间监控目录新增的文件（类 Eagle 行为）
  void syncOnStartup((count) => {
    mainWindow?.webContents.send('clip:imported', count, 'startup')
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
