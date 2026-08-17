import { BrowserWindow, dialog, ipcMain } from 'electron'
import { copyFileSync } from 'fs'
import { addAndSwitchLibrary, getLibraryPath, loadConfig, removeLibrary, switchLibrary } from '../library'
import { backupDatabase, backupLibraryToZip } from '../backup'
import { logFilePath } from '../logger'
import { libraryStats } from '../repository'
import type { LibraryInfo } from '../../shared/types'

export function registerLibraryIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 库管理 ---------------- */
  ipcMain.handle('library:info', (): LibraryInfo => {
    return { path: getLibraryPath(), assetCount: libraryStats().total }
  })

  ipcMain.handle('library:stats', () => libraryStats())

  ipcMain.handle('library:list', () => loadConfig())

  ipcMain.handle('library:choose', async (): Promise<LibraryInfo | null> => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '选择素材库目录（新建或已有）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    addAndSwitchLibrary(result.filePaths[0])
    return { path: getLibraryPath(), assetCount: libraryStats().total }
  })

  ipcMain.handle('library:switch', (_e, path: string): LibraryInfo => {
    switchLibrary(path)
    return { path: getLibraryPath(), assetCount: libraryStats().total }
  })

  ipcMain.handle('library:remove', (_e, path: string) => removeLibrary(path))

  /* ---------------- 备份 ---------------- */
  // 立即备份数据库到 library.db.bak（启动时已自动备份一次,此为手动触发）
  ipcMain.handle('library:backupDb', (): string => backupDatabase())

  // 导出日志文件（排查问题用，保存 main.log 到用户选择的位置）
  ipcMain.handle('logs:export', async (): Promise<string | null> => {
    const win = getWindow()
    const src = logFilePath()
    const r = await dialog.showSaveDialog(win!, {
      title: '导出运行日志',
      defaultPath: `lumen-log-${new Date().toISOString().slice(0, 10)}.log`,
      filters: [{ name: '日志文件', extensions: ['log', 'txt'] }]
    })
    if (r.canceled || !r.filePath) return null
    copyFileSync(src, r.filePath)
    return r.filePath
  })

  // 导出整个库为 ZIP（含原图 + 缩略图 + db,用于完整灾难恢复）
  ipcMain.handle(
    'library:backupZip',
    async (): Promise<{ count: number; target: string } | null> => {
      const win = getWindow()
      const r = await dialog.showSaveDialog(win!, {
        title: '导出完整素材库为 ZIP',
        defaultPath: `lumen-backup-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
      })
      if (r.canceled || !r.filePath) return null
      const count = await backupLibraryToZip(r.filePath)
      return { count, target: r.filePath }
    }
  )
}
