import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { copyFileSync, existsSync, writeFileSync } from 'fs'
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
import { logFilePath } from './logger'
import { backupDatabase, backupLibraryToZip } from './backup'
import { closeFloatingBoardIfBoard } from './floatingBoard'
import {
  addTagToAssets,
  addToFolder,
  assetPaths,
  assignTagToGroup,
  createFolder,  createTag,
  createTagGroup,
  deleteAssets,
  deleteFolder,
  deleteTag,
  deleteTagGroup,
  emptyTrash,
  findDuplicates,
  findSimilar,
  getAssetById,
  isUnnamedName,
  libraryStats,
  listFolders,
  listTagGroups,
  listTags,
  queryAssets,
  removeFromFolder,
  renameFolder,
  listBoards,
  createBoard,
  renameBoard,
  deleteBoard,
  listBoardItems,
  addBoardItem,
  updateBoardItem,
  updateBoardItems,
  deleteBoardItem,
  bringBoardItemToFront,
  updateBoardGuides,
  updateBoardAppearance,
  renameTag,
  renameTagGroup,
  restoreAssets,
  setAssetTags,
  setTagColor,
  setTagPriority,
  setTagExcluded,
  mergeTags,
  updateAsset,
  updateSmartFolder
} from './repository'
import { applyEdit, revertEdit } from './editor'
import { exportBoardToFile, importBoardFromFile } from './boardFile'
import { aiProcessBatch, aiSuggestBatch, aiApplySuggestions, testAiConnection } from './aiRename'
import { aiSearch } from './aiSearch'
import type {
  AiApplyRequest,
  AiProcessOptions,
  AiProcessResult,
  AiScope,
  AssetQuery,
  BoardItem,
  ExportOptions,
  LibraryInfo
} from '../shared/types'
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

  // 阶段一：只生成建议（不写 DB），供预览审核模式用
  ipcMain.handle('ai:suggest', async (_e, ids: string[], options: AiProcessOptions) => {
    const cfg = loadConfig()
    if (!cfg.aiApiKey) throw new Error('未配置 AI API Key，请在设置页填写')
    return aiSuggestBatch(
      ids,
      { baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4', apiKey: cfg.aiApiKey, model: cfg.aiModel ?? 'glm-4v' },
      options ?? { rename: true, tag: true },
      (done, total, failed) => getWindow()?.webContents.send('ai:progress', { done, total, failed })
    )
  })

  // 阶段二：应用用户审核后的建议（改名 + 打标签 + 分类归组）
  ipcMain.handle('ai:apply', (_e, request: AiApplyRequest): Promise<AiProcessResult> => {
    return aiApplySuggestions(request.items, request.options)
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

  // AI 智能搜索：自然语言找图（语义扩展 -> SQL 候选 -> 视觉精排）
  ipcMain.handle('ai:search', async (_e, query: string) => {
    const cfg = loadConfig()
    if (!cfg.aiApiKey) throw new Error('未配置 AI API Key，请在设置页填写')
    if (!query?.trim()) return []
    return aiSearch(
      query,
      { baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4', apiKey: cfg.aiApiKey, model: cfg.aiModel ?? 'glm-4v' },
      (phase, done, total) => getWindow()?.webContents.send('ai:searchProgress', { phase, done, total })
    )
  })

  /* ---------------- 标签 ---------------- */
  ipcMain.handle('tags:list', () => listTags())
  ipcMain.handle('tags:create', (_e, name: string, color?: string) => createTag(name, color))
  ipcMain.handle('tags:rename', (_e, id: number, name: string) => renameTag(id, name))
  ipcMain.handle('tags:setColor', (_e, id: number, color: string) => setTagColor(id, color))
  ipcMain.handle('tags:setPriority', (_e, id: number, priority: number) => setTagPriority(id, priority))
  ipcMain.handle('tags:setExcluded', (_e, id: number, excluded: number) => setTagExcluded(id, excluded))
  ipcMain.handle('tags:merge', (_e, sourceId: number, targetId: number) => mergeTags(sourceId, targetId))
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

  /* ---------------- 系统操作 ---------------- */
  ipcMain.handle('assets:export', async (_e, ids: string[], mode: 'folder' | 'zip', opts: ExportOptions | undefined) => {
    const win = getWindow()
    if (!win || ids.length === 0) return null
    const options: ExportOptions = opts ?? { naming: 'original', groupByTag: false }
    if (mode === 'folder') {
      const r = await dialog.showOpenDialog(win, {
        title: `导出 ${ids.length} 个素材到文件夹`,
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || r.filePaths.length === 0) return null
      return { exported: exportToFolder(ids, r.filePaths[0], options), target: r.filePaths[0] }
    }
    const r = await dialog.showSaveDialog(win, {
      title: `打包 ${ids.length} 个素材为 ZIP`,
      defaultPath: `lumen-export-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    })
    if (r.canceled || !r.filePath) return null
    return { exported: await exportToZip(ids, r.filePath, options), target: r.filePath }
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
