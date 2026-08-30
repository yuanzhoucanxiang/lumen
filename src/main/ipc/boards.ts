import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { writeFileSync } from 'fs'
import { addBoardItem, bringBoardItemToFront, createBoard, deleteBoard, deleteBoardItem, listBoardItems, listBoards, renameBoard, updateBoardAppearance, updateBoardGuides, updateBoardItem, updateBoardItems, updateBoardViewport } from '../repository'
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
  ipcMain.handle('board:setViewport', (_e, boardId: number, viewportJson: string) => updateBoardViewport(boardId, viewportJson))
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

  // 渲染层把画布 SVG 光栅化成 PNG 后交主进程落盘(save 对话框在主进程)
  ipcMain.handle('board:savePng', async (_e, boardId: number, dataUrl: string) => {
    const win = getWindow()
    if (!win) return null
    const m = typeof dataUrl === 'string' ? dataUrl.match(/^data:image\/png;base64,(.+)$/s) : null
    if (!m) throw new Error('invalid png dataUrl')
    const buf = Buffer.from(m[1], 'base64')
    if (buf.length > 100 * 1024 * 1024) throw new Error('PNG 超过 100MB 上限')
    const board = listBoards().find((b) => b.id === boardId)
    const r = await dialog.showSaveDialog(win, {
      title: '导出白板为 PNG',
      defaultPath: `${(board?.name ?? '白板').replace(/[\\/:*?"<>|]/g, '_')}.png`,
      filters: [{ name: 'PNG 位图', extensions: ['png'] }]
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, buf)
    return { target: r.filePath }
  })

  // 测试通道(打包版禁用,同 board:exportToPath):免对话框写 PNG,供 itest 断言渲染产物
  ipcMain.handle('board:savePngToPath', (_e, dataUrl: string, targetPath: string) => {
    if (app.isPackaged && process.env.LUMEN_ALLOW_MULTI !== '1') {
      throw new Error('board:savePngToPath 仅开发/测试环境可用')
    }
    const m = typeof dataUrl === 'string' ? dataUrl.match(/^data:image\/png;base64,(.+)$/s) : null
    if (!m) throw new Error('invalid png dataUrl')
    writeFileSync(targetPath, Buffer.from(m[1], 'base64'))
    return { target: targetPath }
  })

  /* ---------------- 白板文件（.lumenboard） ---------------- */
  // 无对话框直写路径（供测试/脚本复用；UI 走带对话框版本）。打包版禁用：
  // 渲染层失陷时可借它向任意可写路径覆盖 ZIP（审计 M4/L2 收口）
  ipcMain.handle('board:exportToPath', (_e, boardId: number, targetPath: string) => {
    if (app.isPackaged && process.env.LUMEN_ALLOW_MULTI !== '1') {
      throw new Error('board:exportToPath 仅开发/测试环境可用')
    }
    return exportBoardToFile(boardId, targetPath)
  })
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
