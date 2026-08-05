import { app, BrowserWindow, net, protocol, shell, webUtils } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { ensureLibrary, loadConfig } from './library'
import { registerIpc, resolveAssetFile } from './ipc'
import { closeDb } from './db'
import { importFiles } from './importer'
import { startClipServer } from './clipServer'
import { syncWatchers } from './watcher'
import { cleanTrashOlderThan } from './repository'
import { initUpdater } from './updater'
import { ipcMain } from 'electron'

let mainWindow: BrowserWindow | null = null

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
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

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
  // 注册 asset: 协议，用于在渲染进程中安全加载库内文件
  protocol.handle('asset', (request) => {
    const url = new URL(request.url)
    const id = url.hostname
    const kind = (url.searchParams.get('t') === 'o' ? 'original' : 'thumbnail') as
      | 'original'
      | 'thumbnail'
    const file = resolveAssetFile(id, kind)
    if (!file) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // 初始化当前素材库
  ensureLibrary(loadConfig().current)

  registerIpc(() => mainWindow)

  // 拖拽文件导入：渲染进程传来 File 对象，转成本地路径
  ipcMain.handle('import:fileObjects', async (_e, files: File[]) => {
    const paths: string[] = []
    for (const f of files ?? []) {
      try {
        const p = webUtils.getPathForFile(f)
        if (p) paths.push(p)
      } catch {
        /* ignore */
      }
    }
    return importFiles(paths)
  })

  createWindow()

  // 自动更新（electron-updater，打包版生效）
  initUpdater(() => mainWindow)
  ipcMain.handle('app:version', () => app.getVersion())

  // 浏览器剪藏接收服务：导入成功后通知渲染进程刷新
  startClipServer((count) => {
    mainWindow?.webContents.send('clip:imported', count)
  })

  // 监控文件夹自动导入
  syncWatchers((count) => {
    mainWindow?.webContents.send('clip:imported', count)
  })

  // 回收站自动清理（30 天）
  try {
    cleanTrashOlderThan(30)
  } catch {
    /* ignore */
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => closeDb())
