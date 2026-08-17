import { BrowserWindow, ipcMain } from 'electron'
import { addToFolder, createFolder, deleteFolder, listFolders, removeFromFolder, renameFolder, updateSmartFolder } from '../repository'

export function registerFoldersIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 文件夹 ---------------- */
  ipcMain.handle('folders:list', () => listFolders())
  ipcMain.handle('folders:create', (_e, name: string, parentId: number | null, isSmart?: number, conditions?: string) =>
    createFolder(name, parentId ?? null, isSmart ?? 0, conditions ?? '{}')
  )
  ipcMain.handle('folders:updateSmart', (_e, id: number, name: string, conditions: string) =>
    updateSmartFolder(id, name, conditions)
  )
  ipcMain.handle('folders:rename', (_e, id: number, name: string) => renameFolder(id, name))
  ipcMain.handle('folders:delete', (_e, id: number) => deleteFolder(id))
  ipcMain.handle('folders:addAssets', (_e, assetIds: string[], folderId: number) =>
    addToFolder(assetIds, folderId)
  )
  ipcMain.handle('folders:removeAssets', (_e, assetIds: string[], folderId: number) =>
    removeFromFolder(assetIds, folderId)
  )
}
