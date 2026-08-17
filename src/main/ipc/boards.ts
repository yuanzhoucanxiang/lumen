import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFileSync } from 'fs'
import { addBoardItem, bringBoardItemToFront, createBoard, deleteBoard, deleteBoardItem, listBoardItems, listBoards, renameBoard, updateBoardAppearance, updateBoardGuides, updateBoardItem, updateBoardItems } from '../repository'
import { exportBoardToFile, importBoardFromFile } from '../boardFile'
import { closeFloatingBoardIfBoard } from '../floatingBoard'
import type { BoardItem } from '../../shared/types'

export function registerBoardsIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 白板 ---------------- */
  ipcMain.handle('boards:list', () => listBoards())
  ipcMain.handle('boards:create', (_e, name: string) => createBoard(name))
  ipcMain.handle('boards:rename', (_e, id: number, name: string) => renameBoard(id, name))
  ipcMain.handle('boards:delete', (_e, id: number) => {
    deleteBoard(id)
    // 浮动窗正显示该白板时联动关闭（否则画布静默清空、标题回退）
    closeFloatingBoardIfBoard(id)
  })
  ipcMain.handle('board:items', (_e, boardId: number) => listBoardItems(boardId))
  ipcMain.handle(
    'board:addItem',
    (_e, boardId: number, item: {
      assetId?: string | null
      type: 'asset' | 'note' | 'shape'
      x: number
      y: number
      width: number
      height: number
      text?: string
      shape?: string
      opacity?: number
      noteFont?: string
      noteColor?: string
      noteFontSize?: number
    }) => addBoardItem(boardId, item)
  )
  ipcMain.handle('board:updateItem', (_e, id: string, patch: Partial<BoardItem>) => updateBoardItem(id, patch))
  ipcMain.handle('board:updateItems', (_e, items: { id: string; patch: Partial<BoardItem> }[]) => updateBoardItems(items))
  ipcMain.handle('board:deleteItem', (_e, id: string) => deleteBoardItem(id))
  ipcMain.handle('board:front', (_e, id: string, boardId: number) => bringBoardItemToFront(id, boardId))
  ipcMain.handle('board:setGuides', (_e, boardId: number, guidesJson: string) => updateBoardGuides(boardId, guidesJson))
  ipcMain.handle('board:setAppearance', (_e, boardId: number, appearanceJson: string) => updateBoardAppearance(boardId, appearanceJson))
  ipcMain.handle('board:exportSvg', async (_e, boardId: number, svg: string) => {
    const win = getWindow()
    if (!win) return null
    const board = listBoards().find((b) => b.id === boardId)
    const r = await dialog.showSaveDialog(win, {
      title: '导出白板为 SVG',
      defaultPath: `${(board?.name ?? '白板').replace(/[\\/:*?"<>|]/g, '_')}.svg`,
      filters: [{ name: 'SVG 矢量图', extensions: ['svg'] }]
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, svg, 'utf-8')
    return { target: r.filePath }
  })

  /* ---------------- 白板文件（.lumenboard） ---------------- */
  // 无对话框直写路径（供测试/脚本复用）；UI 走带对话框版本
  ipcMain.handle('board:exportToPath', (_e, boardId: number, targetPath: string) => exportBoardToFile(boardId, targetPath))
  ipcMain.handle('board:importFromPath', async (_e, filePath: string) => importBoardFromFile(filePath))
  ipcMain.handle('board:exportFile', async (_e, boardId: number) => {
    const win = getWindow()
    if (!win) return null
    const r = await dialog.showSaveDialog(win, {
      title: '导出白板为 .lumenboard',
      defaultPath: `lumenboard-${new Date().toISOString().slice(0, 10)}.lumenboard`,
      filters: [{ name: 'LUMEN 白板', extensions: ['lumenboard'] }]
    })
    if (r.canceled || !r.filePath) return null
    return exportBoardToFile(boardId, r.filePath)
  })
  ipcMain.handle('board:importFile', async () => {
    const win = getWindow()
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      title: '导入 LUMEN 白板',
      properties: ['openFile'],
      filters: [{ name: 'LUMEN 白板', extensions: ['lumenboard'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return importBoardFromFile(r.filePaths[0])
  })
}
