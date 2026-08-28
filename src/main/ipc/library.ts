import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron'
import { copyFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { addAndSwitchLibrary, getLibraryPath, loadConfig, removeLibrary, switchLibrary } from '../library'
import { backupDatabase, backupLibraryToZip, listAutoZipBackups, listDbBackups, restoreDatabase } from '../backup'
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
  // 立即备份数据库到 library.db.bak（启动时已自动备份一次,此为手动触发;await 热备完成,大库需数秒）
  ipcMain.handle('library:backupDb', async (): Promise<string> => backupDatabase())

  // 列出可恢复的数据库快照(library.db.bak 系列,最新在前)
  ipcMain.handle('library:listDbBackups', () => listDbBackups())

  // 列出自动全量 ZIP 备份(userData/backups,只读展示)
  ipcMain.handle('library:listAutoZips', () => listAutoZipBackups())

  // 从快照恢复数据库(closeDb → 覆盖 → 清 wal/shm → openDb;当前库先另存现场)
  ipcMain.handle('library:restoreDb', (_e, bakPath: string) => restoreDatabase(bakPath))

  // 在系统文件管理器中显示备份文件（仅限库目录/自动备份目录内，防展示任意路径）
  ipcMain.handle('library:revealBackup', (_e, p: string) => {
    const resolved = resolve(String(p ?? ''))
    const lower = resolved.toLowerCase()
    const lib = resolve(getLibraryPath()).toLowerCase()
    const backups = resolve(join(app.getPath('userData'), 'backups')).toLowerCase()
    if (!lower.startsWith(lib + sep) && !lower.startsWith(backups + sep)) return false
    shell.showItemInFolder(resolved)
    return true
  })

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
