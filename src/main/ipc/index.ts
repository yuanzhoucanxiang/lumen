/**
 * IPC 注册按领域拆分(ipc/library|import|assets|settings|ai|tags|folders|boards|system)后的聚合出口。
 * src/main/index.ts 的 `import { registerIpc, resolveAssetFile } from './ipc'` 零改动。
 */
import type { BrowserWindow } from 'electron'
import { registerLibraryIpc } from './library'
import { registerImportIpc } from './import'
import { registerAssetsIpc } from './assets'
import { registerSettingsIpc } from './settings'
import { registerAiIpc } from './ai'
import { registerTagsIpc } from './tags'
import { registerFoldersIpc } from './folders'
import { registerBoardsIpc } from './boards'
import { registerSystemIpc } from './system'

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  registerLibraryIpc(getWindow)
  registerImportIpc(getWindow)
  registerAssetsIpc(getWindow)
  registerSettingsIpc(getWindow)
  registerAiIpc(getWindow)
  registerTagsIpc(getWindow)
  registerFoldersIpc(getWindow)
  registerBoardsIpc(getWindow)
  registerSystemIpc(getWindow)
}

export { resolveAssetFile } from './assets'
