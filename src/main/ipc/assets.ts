import { BrowserWindow, ipcMain, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { assetPaths, deleteAssets, emptyTrash, findDuplicates, findSimilar, getAssetById, queryAssets, restoreAssets, updateAsset } from '../repository'
import { applyEdit, revertEdit } from '../editor'
import { logger } from '../logger'
import type { AssetQuery } from '../../shared/types'

/** 1x1 透明 PNG:startDrag 的 icon 必需且不可为空,缩略图缺失时兜底 */
const FALLBACK_ICON_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

export function registerAssetsIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- 素材查询与编辑 ---------------- */
  ipcMain.handle('assets:query', (_e, q: AssetQuery) => queryAssets(q ?? {}))

  ipcMain.handle('assets:get', (_e, id: string) => getAssetById(id))

  // Alt+拖拽 = 把真实文件拖出到资源管理器/其他程序(对标 Eagle 拖拽导出)。
  // startDrag 必须在 dragstart 手势存续期间同步调用,故走 send 而非 invoke。
  ipcMain.on('asset:dragOut', (e, ids: unknown) => {
    try {
      const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, 32) : []
      const paths: string[] = []
      let thumbForIcon = ''
      for (const id of list) {
        const p = assetPaths(id)
        if (!p || !existsSync(p.original)) continue
        paths.push(p.original)
        if (!thumbForIcon && existsSync(p.thumbnail)) thumbForIcon = p.thumbnail
      }
      if (paths.length === 0) return
      const icon = nativeImage.createFromPath(thumbForIcon)
      e.sender.startDrag({
        file: paths[0],
        files: paths.slice(1),
        icon: icon.isEmpty() ? nativeImage.createFromBuffer(FALLBACK_ICON_PNG) : icon
      })
    } catch (err) {
      logger.warn('[assets]', `拖拽导出失败: ${(err as Error).message}`)
    }
  })

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
