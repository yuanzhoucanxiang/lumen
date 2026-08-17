import { BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { assetPaths, deleteAssets, emptyTrash, findDuplicates, findSimilar, getAssetById, queryAssets, restoreAssets, updateAsset } from '../repository'
import { applyEdit, revertEdit } from '../editor'
import type { AssetQuery } from '../../shared/types'

export function registerAssetsIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 素材查询与编辑 ---------------- */
  ipcMain.handle('assets:query', (_e, q: AssetQuery) => queryAssets(q ?? {}))

  ipcMain.handle('assets:get', (_e, id: string) => getAssetById(id))

  ipcMain.handle('asset:applyEdit', async (_e, id: string, dataUrl: string) => {
    await applyEdit(id, dataUrl)
  })

  ipcMain.handle('asset:revertEdit', async (_e, id: string) => {
    await revertEdit(id)
  })

  ipcMain.handle('assets:update', (_e, id: string, fields) => updateAsset(id, fields))

  ipcMain.handle('assets:delete', (_e, ids: string[], permanent = false) => deleteAssets(ids, permanent))

  ipcMain.handle('assets:restore', (_e, ids: string[]) => restoreAssets(ids))

  ipcMain.handle('trash:empty', () => emptyTrash())

  ipcMain.handle('assets:findDupes', async (_e, maxDistance?: number) => findDuplicates(maxDistance))

  ipcMain.handle('assets:findSimilar', async (_e, id: string, maxDistance?: number) =>
    findSimilar(id, maxDistance ?? 10)
  )
}


/** 供协议处理：解析 asset: URL 对应的真实文件路径 */
/** 供协议处理：解析 asset: URL 对应的真实文件路径 */
export function resolveAssetFile(id: string, kind: 'thumbnail' | 'original' | 'storyboard'): string | null {
  const paths = assetPaths(id)
  if (!paths) return null
  if (kind === 'thumbnail') {
    return existsSync(paths.thumbnail) ? paths.thumbnail : null
  }
  if (kind === 'storyboard') {
    const sb = join(paths.dir, 'storyboard.jpg')
    return existsSync(sb) ? sb : null
  }
  return existsSync(paths.original) ? paths.original : null
}
