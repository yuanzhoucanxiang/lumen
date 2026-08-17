import { BrowserWindow, ipcMain } from 'electron'
import { addTagToAssets, assignTagToGroup, createTag, createTagGroup, deleteTag, deleteTagGroup, listTagGroups, listTags, mergeTags, renameTag, renameTagGroup, setAssetTags, setTagColor, setTagExcluded, setTagPriority } from '../repository'

export function registerTagsIpc(getWindow: () => BrowserWindow | null): void {
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
}
