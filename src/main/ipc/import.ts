import { BrowserWindow, dialog, ipcMain } from 'electron'
import { importFiles } from '../importer'
import { loadConfig } from '../library'

export function registerImportIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 导入 ---------------- */
  // 导入进度推送（阶段 A 逐文件 + 阶段 B 提交后一次），渲染层 onImportProgress 消费
  const sendImportProgress = (phase: 'prepare' | 'commit', done: number, total: number): void => {
    getWindow()?.webContents.send('import:progress', { phase, done, total })
  }

  ipcMain.handle('import:dialog', async (): Promise<{ imported: number; skipped: number; failed: number }> => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '导入素材',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return { imported: 0, skipped: 0, failed: 0 }
    return importFiles(result.filePaths, { move: loadConfig().importMode === 'move', onProgress: sendImportProgress })
  })

  ipcMain.handle('import:paths', async (_e, paths: string[]) => {
    return importFiles(paths ?? [], { onProgress: sendImportProgress })
  })
}
