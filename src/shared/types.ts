/** 素材条目 */
export interface Asset {
  id: string
  name: string
  ext: string
  /** 相对库根目录的存储目录，如 assets/AB/{id} */
  relDir: string
  size: number
  width: number
  height: number
  /** 主色调，格式 [r,g,b] */
  colors: string // JSON string of number[][]
  star: number
  comment: string
  url: string
  createdAt: number
  importedAt: number
  deletedAt: number | null
  tagIds: number[]
  tagNames: string[]
}

export interface Tag {
  id: number
  name: string
  color: string
  count: number
  /** 所属标签组，null = 未分组 */
  groupId: number | null
}

export interface TagGroup {
  id: number
  name: string
}

export interface Folder {
  id: number
  name: string
  parentId: number | null
  icon: string
  count: number
  /** 1 = 智能文件夹 */
  isSmart: number
  /** 智能文件夹条件 JSON */
  conditions: string
}

/** 智能文件夹筛选条件 */
export interface SmartConditions {
  keyword?: string
  tagIds?: number[]
  exts?: string[]
  color?: string
  colorTolerance?: number
  starMin?: number
  minW?: number
  maxW?: number
  minSizeKB?: number
  maxSizeKB?: number
  withinDays?: number
  untagged?: boolean
  /** 构图：横图 / 竖图 / 方形 */
  shape?: 'landscape' | 'portrait' | 'square'
  colorCountMax?: number
}

export type AssetKind = 'image' | 'video' | 'audio' | 'other'

export interface ImportResult {
  imported: number
  skipped: number
  failed: number
}

export interface AssetQuery {
  keyword?: string
  tagIds?: number[]
  folderId?: number | null
  color?: string // hex，如 #FF0000
  colorTolerance?: number // 0-100
  exts?: string[]
  deleted?: boolean
  starMin?: number
  minW?: number
  maxW?: number
  minSizeKB?: number
  maxSizeKB?: number
  withinDays?: number
  /** true = 只显示未打任何标签的素材 */
  untagged?: boolean
  /** 构图筛选：横图 / 竖图 / 方形 */
  shape?: 'landscape' | 'portrait' | 'square'
  colorCountMax?: number
  sortBy?: 'imported' | 'name' | 'size' | 'star'
  sortDesc?: boolean
  limit?: number
  offset?: number
}

export interface DupeGroup {
  hash: string
  assets: { id: string; name: string; ext: string; size: number }[]
}

export interface AppSettings {
  watchDirs: string[]
  importMode: 'copy' | 'move'
}

export interface LibraryInfo {
  path: string
  assetCount: number
}

/** 自动更新状态机（主进程推送，渲染进程渲染提示） */
export interface UpdateStatus {
  state: 'idle' | 'dev' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
  /** 新版本更新内容（release notes） */
  notes?: string
}
