import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  addAndSwitchLibrary,
  getLibraryPath,
  loadConfig,
  removeLibrary,
  saveConfig,
  switchLibrary
} from './library'
import { importFiles } from './importer'
import { exportToFolder, exportToZip } from './exporter'
import { backupDatabase, backupLibraryToZip } from './backup'
import {
  addTagToAssets,
  addToFolder,
  assetPaths,
  assignTagToGroup,
  cleanTrashOlderThan,
  createFolder,
  createTag,
  createTagGroup,
  deleteAssets,
  deleteFolder,
  deleteTag,
  deleteTagGroup,
  emptyTrash,
  findDuplicates,
  findSimilar,
  isUnnamedName,
  libraryStats,
  listFolders,
  listTagGroups,
  listTags,
  queryAssets,
  removeFromFolder,
  renameFolder,
  renameTag,
  renameTagGroup,
  restoreAssets,
  setAssetTags,
  setTagColor,
  updateAsset,
  updateSmartFolder
} from './repository'
import { applyEdit, revertEdit } from './editor'
import { aiProcessBatch, testAiConnection } from './aiRename'
import type { AiProcessOptions, AiProcessResult, AiScope, AssetQuery, LibraryInfo } from '../shared/types'
import { syncWatchers } from './watcher'

export function registerIpc(getWindow: () => BrowserWindow | null): void {
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
      const count = backupLibraryToZip(r.filePath)
      return { count, target: r.filePath }
    }
  )

  /* ---------------- 导入 ---------------- */
  ipcMain.handle('import:dialog', async (): Promise<{ imported: number; skipped: number; failed: number }> => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '导入素材',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return { imported: 0, skipped: 0, failed: 0 }
    return importFiles(result.filePaths, { move: loadConfig().importMode === 'move' })
  })

  ipcMain.handle('import:paths', async (_e, paths: string[]) => {
    return importFiles(paths ?? [])
  })

  /* ---------------- 素材查询与编辑 ---------------- */
  ipcMain.handle('assets:query', (_e, q: AssetQuery) => queryAssets(q ?? {}))

  ipcMain.handle('asset:paths', (_e, id: string) => assetPaths(id))

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

  ipcMain.handle('trash:cleanOld', () => cleanTrashOlderThan(30))

  /* ---------------- 设置 ---------------- */
  // settings:get 返回 AI key 脱敏（只返回 hasKey + 末 4 位，完整 key 不进渲染进程）
  ipcMain.handle('settings:get', () => {
    const cfg = loadConfig()
    return {
      watchDirs: cfg.watchDirs,
      importMode: cfg.importMode,
      aiBaseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
      aiModel: cfg.aiModel ?? 'glm-4v',
      aiHasKey: !!cfg.aiApiKey,
      aiKeyTail: cfg.aiApiKey ? cfg.aiApiKey.slice(-4) : '',
      aiAutoOnImport: cfg.aiAutoOnImport ?? false
    }
  })

  ipcMain.handle(
    'settings:update',
    (
      _e,
      patch: {
        watchDirs?: string[]
        importMode?: 'copy' | 'move'
        aiBaseUrl?: string
        aiApiKey?: string
        aiModel?: string
        aiAutoOnImport?: boolean
      }
    ) => {
      const cfg = loadConfig()
      if (patch.watchDirs) cfg.watchDirs = patch.watchDirs
      if (patch.importMode) cfg.importMode = patch.importMode
      if (patch.aiBaseUrl !== undefined) cfg.aiBaseUrl = patch.aiBaseUrl
      if (patch.aiApiKey !== undefined) cfg.aiApiKey = patch.aiApiKey
      if (patch.aiModel !== undefined) cfg.aiModel = patch.aiModel
      if (patch.aiAutoOnImport !== undefined) cfg.aiAutoOnImport = patch.aiAutoOnImport
      saveConfig(cfg)
      syncWatchers((count) => getWindow()?.webContents.send('clip:imported', count))
      return {
        watchDirs: cfg.watchDirs,
        importMode: cfg.importMode,
        aiBaseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
        aiModel: cfg.aiModel ?? 'glm-4v',
        aiHasKey: !!cfg.aiApiKey,
        aiKeyTail: cfg.aiApiKey ? cfg.aiApiKey.slice(-4) : '',
        aiAutoOnImport: cfg.aiAutoOnImport ?? false
      }
    }
  )

  ipcMain.handle('settings:chooseWatchDir', async (): Promise<string | null> => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '选择要监控的文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  /* ---------------- AI 智能处理（改名+打标签）---------------- */
  // 批量处理：主进程读 key 发请求，key 不进渲染进程；进度通过 webContents.send 推送
  ipcMain.handle('ai:process', async (_e, ids: string[], options: AiProcessOptions): Promise<AiProcessResult> => {
    const cfg = loadConfig()
    if (!cfg.aiApiKey) throw new Error('未配置 AI API Key，请在设置页填写')
    return aiProcessBatch(
      ids,
      { baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4', apiKey: cfg.aiApiKey, model: cfg.aiModel ?? 'glm-4v' },
      options ?? { rename: true, tag: true },
      (done, total, failed) => getWindow()?.webContents.send('ai:progress', { done, total, failed })
    )
  })

  // 统计 AI 候选素材数（对话框显示"将处理 N 个素材"）
  ipcMain.handle('ai:countCandidates', (_e, scope: AiScope): number => {
    if (scope.type === 'selection') return scope.ids.length
    if (scope.type === 'all') {
      return queryAssets({ limit: 100000 }).length
    }
    if (scope.type === 'untagged') {
      return queryAssets({ untagged: true, limit: 100000 }).length
    }
    // unnamed：全部素材里过滤未命名
    const all = queryAssets({ limit: 100000 })
    return all.filter((a) => isUnnamedName(a.name)).length
  })

  // 展开范围为具体 id 列表（供 AI 处理用；未命名判定与 count 一致）
  ipcMain.handle('ai:resolveScope', (_e, scope: AiScope): string[] => {
    if (scope.type === 'selection') return scope.ids
    const all = queryAssets({ limit: 100000 })
    if (scope.type === 'untagged') {
      return queryAssets({ untagged: true, limit: 100000 }).map((a) => a.id)
    }
    if (scope.type === 'unnamed') {
      return all.filter((a) => isUnnamedName(a.name)).map((a) => a.id)
    }
    return all.map((a) => a.id)
  })

  // 测试连通性：用户在设置页填完 key 后点「测试连接」
  ipcMain.handle('ai:testKey', async (_e, cfg: { baseUrl: string; apiKey: string; model: string }) => {
    return testAiConnection(cfg)
  })

  /* ---------------- 标签 ---------------- */
  ipcMain.handle('tags:list', () => listTags())
  ipcMain.handle('tags:create', (_e, name: string, color?: string) => createTag(name, color))
  ipcMain.handle('tags:rename', (_e, id: number, name: string) => renameTag(id, name))
  ipcMain.handle('tags:setColor', (_e, id: number, color: string) => setTagColor(id, color))
  ipcMain.handle('tags:delete', (_e, id: number) => deleteTag(id))

  /* ---------------- 标签组 ---------------- */
  ipcMain.handle('tagGroups:list', () => listTagGroups())
  ipcMain.handle('tagGroups:create', (_e, name: string) => createTagGroup(name))
  ipcMain.handle('tagGroups:rename', (_e, id: number, name: string) => renameTagGroup(id, name))
  ipcMain.handle('tagGroups:delete', (_e, id: number) => deleteTagGroup(id))
  ipcMain.handle('tagGroups:assign', (_e, tagId: number, groupId: number | null) =>
    assignTagToGroup(tagId, groupId)
  )
  ipcMain.handle('asset:setTags', (_e, assetId: string, tagNames: string[]) =>
    setAssetTags(assetId, tagNames)
  )
  ipcMain.handle('assets:addTag', (_e, assetIds: string[], name: string) =>
    addTagToAssets(assetIds, name)
  )

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

  /* ---------------- 系统操作 ---------------- */
  ipcMain.handle('assets:export', async (_e, ids: string[], mode: 'folder' | 'zip') => {
    const win = getWindow()
    if (!win || ids.length === 0) return null
    if (mode === 'folder') {
      const r = await dialog.showOpenDialog(win, {
        title: `导出 ${ids.length} 个素材到文件夹`,
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || r.filePaths.length === 0) return null
      return { exported: exportToFolder(ids, r.filePaths[0]), target: r.filePaths[0] }
    }
    const r = await dialog.showSaveDialog(win, {
      title: `打包 ${ids.length} 个素材为 ZIP`,
      defaultPath: `lumen-export-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    })
    if (r.canceled || !r.filePath) return null
    return { exported: exportToZip(ids, r.filePath), target: r.filePath }
  })

  ipcMain.handle('shell:showItem', (_e, id: string) => {
    const paths = assetPaths(id)
    if (paths) shell.showItemInFolder(paths.original)
  })

  ipcMain.handle('asset:copyImage', (_e, id: string): boolean => {
    const paths = assetPaths(id)
    if (!paths) return false
    const img = nativeImage.createFromPath(paths.original)
    if (img.isEmpty()) return false
    clipboard.writeImage(img)
    return true
  })

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}

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
