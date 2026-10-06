import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Asset, AssetQuery, AiApplyRequest, AiProcessOptions, AiProcessResult, AiScope, AiSearchProgress, AiSuggestionItem, AppSettings, Board, BoardItem, BoardItemPatch, DbBackupInfo, DupeGroup, ExportOptions, Folder, ImportResult, LibraryInfo, NewBoardItem, Tag, TagGroup, UpdateStatus, ZipBackupInfo } from '../shared/types'

const api = {
  /* 库管理 */
  getLibraryInfo: (): Promise<LibraryInfo> => ipcRenderer.invoke('library:info'),
  getLibraryStats: (): Promise<{ total: number; deleted: number; tombstones: number }> =>
    ipcRenderer.invoke('library:stats'),
  listLibraries: (): Promise<{ libraries: { name: string; path: string }[]; current: string }> =>
    ipcRenderer.invoke('library:list'),
  chooseLibrary: (): Promise<LibraryInfo | null> => ipcRenderer.invoke('library:choose'),
  switchLibrary: (path: string): Promise<LibraryInfo> =>
    ipcRenderer.invoke('library:switch', path),
  removeLibrary: (path: string): Promise<void> => ipcRenderer.invoke('library:remove', path),

  /* 备份 */
  backupDatabase: (): Promise<string> => ipcRenderer.invoke('library:backupDb'),
  exportLogs: (): Promise<string | null> => ipcRenderer.invoke('logs:export'),
  backupLibraryToZip: (): Promise<{ count: number; target: string } | null> =>
    ipcRenderer.invoke('library:backupZip'),
  listDbBackups: (): Promise<DbBackupInfo[]> => ipcRenderer.invoke('library:listDbBackups'),
  listAutoZipBackups: (): Promise<ZipBackupInfo[]> => ipcRenderer.invoke('library:listAutoZips'),
  restoreDatabase: (bakPath: string): Promise<{ restoredFrom: string; emergencyPath: string }> =>
    ipcRenderer.invoke('library:restoreDb', bakPath),
  revealBackup: (p: string): Promise<void> => ipcRenderer.invoke('library:revealBackup', p),

  /* 导入 */
  importViaDialog: (): Promise<ImportResult> => ipcRenderer.invoke('import:dialog'),
  /**
   * 拖拽导入:webUtils.getPathForFile 只在 preload/渲染进程可用(主进程为 undefined),
   * 故在 preload 把 File 转成本地路径后走 import:paths。返回含 importedIds 的 ImportResult。
   */
  importFileObjects: (files: File[]): Promise<ImportResult> =>
    ipcRenderer.invoke('import:paths', getFilePaths(files)),
  /** File[] -> 本地路径[](供渲染层自定义导入逻辑复用) */
  getFilePaths: (files: File[]): string[] => getFilePaths(files),
  /** 按本地路径导入（主进程 import:paths 通道的包装，供测试/脚本用） */
  importFromPaths: (paths: string[]): Promise<ImportResult> =>
    ipcRenderer.invoke('import:paths', paths),
  /** URL 粘贴抓图:主进程并发下载图片直链后走导入管线,来源写入 assets.url */
  importFromUrls: (urls: string[]): Promise<ImportResult> =>
    ipcRenderer.invoke('import:urls', urls),
  onImportProgress: (cb: (p: { phase: 'prepare' | 'commit'; done: number; total: number }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: { phase: 'prepare' | 'commit'; done: number; total: number }) => cb(p)
    ipcRenderer.on('import:progress', h)
    return () => ipcRenderer.removeListener('import:progress', h)
  },

  /* 素材 */
  queryAssets: (q: AssetQuery): Promise<Asset[]> => ipcRenderer.invoke('assets:query', q),
  getAsset: (id: string): Promise<Asset | null> => ipcRenderer.invoke('assets:get', id),
  /** Alt+拖拽导出:在 dragstart 内同步发 send 通道,主进程 startDrag 接管 OS 拖拽 */
  dragOutAssets: (ids: string[]): void => ipcRenderer.send('asset:dragOut', ids),
  updateAsset: (
    id: string,
    fields: Partial<Pick<Asset, 'name' | 'star' | 'comment' | 'url'>>
  ): Promise<void> => ipcRenderer.invoke('assets:update', id, fields),
  deleteAssets: (ids: string[], permanent?: boolean): Promise<void> =>
    ipcRenderer.invoke('assets:delete', ids, permanent),
  restoreAssets: (ids: string[]): Promise<void> => ipcRenderer.invoke('assets:restore', ids),
  emptyTrash: (): Promise<void> => ipcRenderer.invoke('trash:empty'),
  findDuplicates: (maxDistance?: number): Promise<DupeGroup[]> =>
    ipcRenderer.invoke('assets:findDupes', maxDistance),
  findSimilar: (id: string, maxDistance?: number): Promise<Asset[]> =>
    ipcRenderer.invoke('assets:findSimilar', id, maxDistance),
  applyEdit: (id: string, dataUrl: string): Promise<void> =>
    ipcRenderer.invoke('asset:applyEdit', id, dataUrl),
  revertEdit: (id: string): Promise<void> => ipcRenderer.invoke('asset:revertEdit', id),

  /* 设置 */
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),
  chooseWatchDir: (): Promise<string | null> => ipcRenderer.invoke('settings:chooseWatchDir'),

  /* AI 智能处理（改名+打标签） */
  aiProcess: (ids: string[], options?: AiProcessOptions): Promise<AiProcessResult> =>
    ipcRenderer.invoke('ai:process', ids, options),
  /** 阶段一：生成建议（不写 DB），供预览审核 */
  aiSuggest: (ids: string[], options: AiProcessOptions): Promise<{ items: AiSuggestionItem[]; failed: number; failedIds: string[] }> =>
    ipcRenderer.invoke('ai:suggest', ids, options),
  /** 阶段二：应用用户审核后的建议 */
  aiApply: (request: AiApplyRequest): Promise<AiProcessResult> =>
    ipcRenderer.invoke('ai:apply', request),
  aiCountCandidates: (scope: AiScope): Promise<number> =>
    ipcRenderer.invoke('ai:countCandidates', scope),
  aiResolveScope: (scope: AiScope): Promise<string[]> =>
    ipcRenderer.invoke('ai:resolveScope', scope),
  aiTestKey: (cfg: { baseUrl: string; apiKey: string; model: string }): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('ai:testKey', cfg),
  onAiProgress: (cb: (p: { done: number; total: number; failed: number }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: { done: number; total: number; failed: number }) => cb(p)
    ipcRenderer.on('ai:progress', h)
    return () => ipcRenderer.removeListener('ai:progress', h)
  },
  /** AI 智能搜索：自然语言找图，返回匹配素材（按相关性排序） */
  aiSearch: (query: string): Promise<Asset[]> => ipcRenderer.invoke('ai:search', query),
  onAiSearchProgress: (cb: (p: AiSearchProgress) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: AiSearchProgress) => cb(p)
    ipcRenderer.on('ai:searchProgress', h)
    return () => ipcRenderer.removeListener('ai:searchProgress', h)
  },

  /* 标签 */
  listTags: (): Promise<Tag[]> => ipcRenderer.invoke('tags:list'),
  createTag: (name: string, color?: string): Promise<Tag> =>
    ipcRenderer.invoke('tags:create', name, color),
  renameTag: (id: number, name: string): Promise<void> =>
    ipcRenderer.invoke('tags:rename', id, name),
  setTagColor: (id: number, color: string): Promise<void> =>
    ipcRenderer.invoke('tags:setColor', id, color),
  setTagPriority: (id: number, priority: number): Promise<void> =>
    ipcRenderer.invoke('tags:setPriority', id, priority),
  setTagExcluded: (id: number, excluded: number): Promise<void> =>
    ipcRenderer.invoke('tags:setExcluded', id, excluded),
  mergeTags: (sourceId: number, targetId: number): Promise<void> =>
    ipcRenderer.invoke('tags:merge', sourceId, targetId),
  deleteTag: (id: number): Promise<void> => ipcRenderer.invoke('tags:delete', id),
  setAssetTags: (assetId: string, tagNames: string[]): Promise<void> =>
    ipcRenderer.invoke('asset:setTags', assetId, tagNames),
  addTagToAssets: (assetIds: string[], name: string): Promise<void> =>
    ipcRenderer.invoke('assets:addTag', assetIds, name),

  /* 标签组 */
  listTagGroups: (): Promise<TagGroup[]> => ipcRenderer.invoke('tagGroups:list'),
  createTagGroup: (name: string): Promise<TagGroup> => ipcRenderer.invoke('tagGroups:create', name),
  renameTagGroup: (id: number, name: string): Promise<void> =>
    ipcRenderer.invoke('tagGroups:rename', id, name),
  deleteTagGroup: (id: number): Promise<void> => ipcRenderer.invoke('tagGroups:delete', id),
  assignTagToGroup: (tagId: number, groupId: number | null): Promise<void> =>
    ipcRenderer.invoke('tagGroups:assign', tagId, groupId),

  /* 文件夹 */
  listFolders: (): Promise<Folder[]> => ipcRenderer.invoke('folders:list'),
  createFolder: (name: string, parentId: number | null, isSmart?: number, conditions?: string): Promise<Folder> =>
    ipcRenderer.invoke('folders:create', name, parentId, isSmart, conditions),
  updateSmartFolder: (id: number, name: string, conditions: string): Promise<void> =>
    ipcRenderer.invoke('folders:updateSmart', id, name, conditions),
  renameFolder: (id: number, name: string): Promise<void> =>
    ipcRenderer.invoke('folders:rename', id, name),
  moveFolder: (id: number, targetParentId: number | null): Promise<void> =>
    ipcRenderer.invoke('folders:move', id, targetParentId),
  deleteFolder: (id: number): Promise<void> => ipcRenderer.invoke('folders:delete', id),
  addAssetsToFolder: (assetIds: string[], folderId: number): Promise<void> =>
    ipcRenderer.invoke('folders:addAssets', assetIds, folderId),
  removeAssetsFromFolder: (assetIds: string[], folderId: number): Promise<void> =>
    ipcRenderer.invoke('folders:removeAssets', assetIds, folderId),

  /* 白板 */
  listBoards: (): Promise<Board[]> => ipcRenderer.invoke('boards:list'),
  createBoard: (name: string): Promise<Board> => ipcRenderer.invoke('boards:create', name),
  renameBoard: (id: number, name: string): Promise<void> => ipcRenderer.invoke('boards:rename', id, name),
  deleteBoard: (id: number): Promise<void> => ipcRenderer.invoke('boards:delete', id),
  listBoardItems: (boardId: number): Promise<BoardItem[]> => ipcRenderer.invoke('board:items', boardId),
  addBoardItem: (boardId: number, item: NewBoardItem): Promise<BoardItem> =>
    ipcRenderer.invoke('board:addItem', boardId, item),
  /** 批量新建（撤销恢复/粘贴用，一次 IPC 一趟事务） */
  addBoardItems: (boardId: number, items: NewBoardItem[]): Promise<BoardItem[]> =>
    ipcRenderer.invoke('board:addItems', boardId, items),
  updateBoardItem: (id: string, patch: BoardItemPatch): Promise<void> =>
    ipcRenderer.invoke('board:updateItem', id, patch),
  updateBoardItems: (items: { id: string; patch: BoardItemPatch }[]): Promise<void> =>
    ipcRenderer.invoke('board:updateItems', items),
  deleteBoardItem: (id: string): Promise<void> => ipcRenderer.invoke('board:deleteItem', id),
  /** 批量删除（一次 IPC 一趟事务，取代循环里逐条 await） */
  deleteBoardItems: (ids: string[]): Promise<void> => ipcRenderer.invoke('board:deleteItems', ids),
  bringBoardItemToFront: (id: string, boardId: number): Promise<void> =>
    ipcRenderer.invoke('board:front', id, boardId),
  setBoardGuides: (boardId: number, guidesJson: string): Promise<void> =>
    ipcRenderer.invoke('board:setGuides', boardId, guidesJson),
  setBoardAppearance: (boardId: number, appearanceJson: string): Promise<void> =>
    ipcRenderer.invoke('board:setAppearance', boardId, appearanceJson),
  /** 保存白板视口(缩放+位置),重开保持;视图状态不触发列表重排 */
  setBoardViewport: (boardId: number, viewportJson: string): Promise<void> =>
    ipcRenderer.invoke('board:setViewport', boardId, viewportJson),
  exportBoardSvg: (boardId: number, svg: string): Promise<{ target: string } | null> =>
    ipcRenderer.invoke('board:exportSvg', boardId, svg),
  /** 白板导出 PNG:渲染层光栅化成 dataUrl 后由主进程落盘(save 对话框) */
  saveBoardPng: (boardId: number, dataUrl: string): Promise<{ target: string } | null> =>
    ipcRenderer.invoke('board:savePng', boardId, dataUrl),
  /** 测试通道(打包版禁用):免对话框写 PNG */
  saveBoardPngToPath: (dataUrl: string, targetPath: string): Promise<{ target: string }> =>
    ipcRenderer.invoke('board:savePngToPath', dataUrl, targetPath),

  /* 白板浮动置顶窗口 */
  openFloatingBoard: (boardId: number): Promise<void> =>
    ipcRenderer.invoke('window:floatingOpen', boardId),
  closeFloatingWindow: (): Promise<void> => ipcRenderer.invoke('window:floatingClose'),
  /** 最小化：折叠为仅标题条高度的窄条（对标 PureRef） */
  minimizeFloatingWindow: (): Promise<void> => ipcRenderer.invoke('window:floatingMinimize'),
  /** 展开：从标题条窄条还原到折叠前大小 */
  restoreFloatingWindow: (): Promise<void> => ipcRenderer.invoke('window:floatingRestore'),
  /** 切换折叠/展开,返回新状态 */
  toggleFloatingWindowMinimize: (): Promise<boolean> =>
    ipcRenderer.invoke('window:floatingToggleMinimize'),
  /** 归位：贴回所在显示器工作区右上角 */
  resetFloatingWindowPosition: (): Promise<void> => ipcRenderer.invoke('window:floatingResetPos'),

  /* 白板文件（.lumenboard）导入导出 */
  exportBoardToPath: (boardId: number, targetPath: string): Promise<{ count: number; target: string }> =>
    ipcRenderer.invoke('board:exportToPath', boardId, targetPath),
  importBoardFromPath: (filePath: string): Promise<{ boardId: number; name: string; imported: number }> =>
    ipcRenderer.invoke('board:importFromPath', filePath),
  exportBoardFile: (boardId: number): Promise<{ count: number; target: string } | null> =>
    ipcRenderer.invoke('board:exportFile', boardId),
  importBoardFile: (): Promise<{ boardId: number; name: string; imported: number } | null> =>
    ipcRenderer.invoke('board:importFile'),

  /* 系统操作 */
  showInFolder: (id: string): Promise<void> => ipcRenderer.invoke('shell:showItem', id),
  copyImage: (id: string): Promise<boolean> => ipcRenderer.invoke('asset:copyImage', id),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  exportAssets: (ids: string[], mode: 'folder' | 'zip', opts?: ExportOptions): Promise<{ exported: number; target: string } | null> =>
    ipcRenderer.invoke('assets:export', ids, mode, opts),

  /* Agent 技能 */
  installAgentSkill: (): Promise<{ installed: string[]; source: string }> =>
    ipcRenderer.invoke('agent:installSkill'),
  openAgentSkillFolder: (): Promise<string> => ipcRenderer.invoke('agent:openSkillFolder'),
  agentSkillStatus: (): Promise<{ installed: boolean; upToDate: boolean; dirs: string[] }> =>
    ipcRenderer.invoke('agent:skillStatus'),

  /* 区域截图 */
  /** 工具栏触发:隐藏主窗 → 捕获 → 打开全屏覆层(已开会话时返回 false) */
  screenshotStart: (): Promise<boolean> => ipcRenderer.invoke('screenshot:start'),
  /** 覆层渲染层就绪通知(主进程随后 send screenshot:data) */
  screenshotOverlayReady: (): void => ipcRenderer.send('screenshot:overlayReady'),
  onScreenshotData: (cb: (d: { dataUrl: string; dpr: number }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, d: { dataUrl: string; dpr: number }) => cb(d)
    ipcRenderer.on('screenshot:data', h)
    return () => ipcRenderer.removeListener('screenshot:data', h)
  },
  /** 框选确认:rect 为覆层视口内的逻辑像素,主进程按 dpr 换算物理像素裁剪入库。
   *  source 可选(测试直传整屏 dataUrl);缺省用当前会话捕获的整屏图 */
  screenshotCommit: (
    rect: { x: number; y: number; width: number; height: number },
    dpr?: number,
    source?: string
  ): Promise<ImportResult> => ipcRenderer.invoke('screenshot:commit', rect, dpr, source),
  screenshotCancel: (): Promise<void> => ipcRenderer.invoke('screenshot:cancel'),
  onScreenshotImported: (cb: (count: number) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, count: number) => cb(count)
    ipcRenderer.on('screenshot:imported', h)
    return () => ipcRenderer.removeListener('screenshot:imported', h)
  },

  /* URL 辅助 */
  thumbnailUrl: (id: string): string => `asset://${id}/file?t=t`,
  originalUrl: (id: string): string => `asset://${id}/file?t=o`,
  storyboardUrl: (id: string): string => `asset://${id}/file?t=s`,

  /* 导入通知（来源分流提示文案：剪藏/Agent/监控文件夹/启动同步） */
  onClipImported: (cb: (count: number, source?: 'clip' | 'agent' | 'watcher' | 'startup') => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, count: number, source?: 'clip' | 'agent' | 'watcher' | 'startup') => cb(count, source)
    ipcRenderer.on('clip:imported', h)
    return () => ipcRenderer.removeListener('clip:imported', h)
  },

  /* Agent 后台任务事件(autoTag 进度/完成/跳过) */
  onAgentNotify: (cb: (event: { type: string } & Record<string, unknown>) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, event: { type: string } & Record<string, unknown>) => cb(event)
    ipcRenderer.on('agent:notify', h)
    return () => ipcRenderer.removeListener('agent:notify', h)
  },

  /* 浮动白板窗：主进程复用窗口时通知切换白板 */
  onBoardSwitch: (cb: (boardId: number) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, boardId: number) => cb(boardId)
    ipcRenderer.on('board:switch', h)
    return () => ipcRenderer.removeListener('board:switch', h)
  },

  /* 浮动白板窗：主进程折叠/展开时同步状态（折叠后画布卸载） */
  onBoardMinimized: (cb: (minimized: boolean) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, minimized: boolean) => cb(minimized)
    ipcRenderer.on('board:minimized', h)
    return () => ipcRenderer.removeListener('board:minimized', h)
  },

  /* 自动更新 */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (s: UpdateStatus) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, s: UpdateStatus) => cb(s)
    ipcRenderer.on('update:event', h)
    return () => ipcRenderer.removeListener('update:event', h)
  }
}

export type ElectronApi = typeof api

/** File -> 本地路径(webUtils 仅 preload/渲染进程可用;合成 File 无真实路径返回 '') */
function getFilePaths(files: File[]): string[] {
  return (files ?? [])
    .map((f) => {
      try {
        return webUtils.getPathForFile(f) ?? ''
      } catch {
        return ''
      }
    })
    .filter(Boolean)
}

contextBridge.exposeInMainWorld('api', api)
