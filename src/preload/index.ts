import { contextBridge, ipcRenderer } from 'electron'
import type { Asset, AssetQuery, AiProcessOptions, AiProcessResult, AiScope, AppSettings, DupeGroup, Folder, ImportResult, LibraryInfo, Tag, TagGroup, UpdateStatus } from '../shared/types'

const api = {
  /* 库管理 */
  getLibraryInfo: (): Promise<LibraryInfo> => ipcRenderer.invoke('library:info'),
  getLibraryStats: (): Promise<{ total: number; deleted: number }> =>
    ipcRenderer.invoke('library:stats'),
  listLibraries: (): Promise<{ libraries: { name: string; path: string }[]; current: string }> =>
    ipcRenderer.invoke('library:list'),
  chooseLibrary: (): Promise<LibraryInfo | null> => ipcRenderer.invoke('library:choose'),
  switchLibrary: (path: string): Promise<LibraryInfo> =>
    ipcRenderer.invoke('library:switch', path),
  removeLibrary: (path: string): Promise<void> => ipcRenderer.invoke('library:remove', path),

  /* 备份 */
  backupDatabase: (): Promise<string> => ipcRenderer.invoke('library:backupDb'),
  backupLibraryToZip: (): Promise<{ count: number; target: string } | null> =>
    ipcRenderer.invoke('library:backupZip'),

  /* 导入 */
  importViaDialog: (): Promise<ImportResult> => ipcRenderer.invoke('import:dialog'),
  importFileObjects: (files: File[]): Promise<ImportResult> =>
    ipcRenderer.invoke('import:fileObjects', files),

  /* 素材 */
  queryAssets: (q: AssetQuery): Promise<Asset[]> => ipcRenderer.invoke('assets:query', q),
  getAsset: (id: string): Promise<Asset | null> => ipcRenderer.invoke('assets:get', id),
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
  aiCountCandidates: (scope: AiScope): Promise<number> =>
    ipcRenderer.invoke('ai:countCandidates', scope),
  aiResolveScope: (scope: AiScope): Promise<string[]> =>
    ipcRenderer.invoke('ai:resolveScope', scope),
  aiTestKey: (cfg: { baseUrl: string; apiKey: string; model: string }): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('ai:testKey', cfg),
  onAiProgress: (cb: (p: { done: number; total: number; failed: number }) => void): void => {
    ipcRenderer.on('ai:progress', (_e, p) => cb(p))
  },

  /* 标签 */
  listTags: (): Promise<Tag[]> => ipcRenderer.invoke('tags:list'),
  createTag: (name: string, color?: string): Promise<Tag> =>
    ipcRenderer.invoke('tags:create', name, color),
  renameTag: (id: number, name: string): Promise<void> =>
    ipcRenderer.invoke('tags:rename', id, name),
  setTagColor: (id: number, color: string): Promise<void> =>
    ipcRenderer.invoke('tags:setColor', id, color),
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
  deleteFolder: (id: number): Promise<void> => ipcRenderer.invoke('folders:delete', id),
  addAssetsToFolder: (assetIds: string[], folderId: number): Promise<void> =>
    ipcRenderer.invoke('folders:addAssets', assetIds, folderId),
  removeAssetsFromFolder: (assetIds: string[], folderId: number): Promise<void> =>
    ipcRenderer.invoke('folders:removeAssets', assetIds, folderId),

  /* 系统操作 */
  showInFolder: (id: string): Promise<void> => ipcRenderer.invoke('shell:showItem', id),
  copyImage: (id: string): Promise<boolean> => ipcRenderer.invoke('asset:copyImage', id),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  exportAssets: (ids: string[], mode: 'folder' | 'zip'): Promise<{ exported: number; target: string } | null> =>
    ipcRenderer.invoke('assets:export', ids, mode),

  /* URL 辅助 */
  thumbnailUrl: (id: string): string => `asset://${id}/file?t=t`,
  originalUrl: (id: string): string => `asset://${id}/file?t=o`,
  storyboardUrl: (id: string): string => `asset://${id}/file?t=s`,

  /* 剪藏通知 */
  onClipImported: (cb: (count: number) => void): void => {
    ipcRenderer.on('clip:imported', (_e, count: number) => cb(count))
  },

  /* 自动更新 */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (s: UpdateStatus) => void): void => {
    ipcRenderer.on('update:event', (_e, s: UpdateStatus) => cb(s))
  }
}

export type ElectronApi = typeof api

contextBridge.exposeInMainWorld('api', api)
