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
  /** 1 = 已编辑（存在 {id}.edited.{ext}，原图保留） */
  edited: number
  /** EXIF 元数据 JSON 字符串（相机型号/拍摄时间/光圈/快门/ISO/焦距） */
  exif: string
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
  /** 用户标记的优先级：1=优先（AI 打标签时优先选用），0=普通 */
  priority: number
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
  /** 失败文件的文件名列表（用于 UI 提示与日志） */
  failedFiles?: string[]
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
  /** AI 配置（aiApiKey 脱敏：只返回 hasKey + 末 4 位，不返回完整 key） */
  aiBaseUrl?: string
  aiApiKey?: string
  aiModel?: string
  aiHasKey?: boolean
  aiKeyTail?: string
  /** 导入后自动执行 AI 处理 */
  aiAutoOnImport?: boolean
}

/** AI 处理进度（主进程推送） */
export interface AiProgress {
  done: number
  total: number
  failed: number
}

/** AI 搜索进度（主进程推送，phase 为中文阶段描述） */
export interface AiSearchProgress {
  phase: string
  done: number
  total: number
}

/** AI 处理选项 */
export interface AiProcessOptions {
  /** 是否改名 */
  rename: boolean
  /** 是否打标签 */
  tag: boolean
  /** 标签数量上限 */
  maxTags?: number
  /** 标签归组名（默认 'AI 标签'） */
  tagGroupName?: string
}

/** AI 处理范围（筛选候选素材） */
export type AiScope =
  | { type: 'selection'; ids: string[] }
  | { type: 'all' }
  | { type: 'untagged' }
  | { type: 'unnamed' }

/** AI 处理单条结果明细（供结果列表展示/撤销） */
export interface AiProcessItem {
  id: string
  oldName: string
  newName: string
  addedTags: string[]
}

/** AI 批量处理结果 */
export interface AiProcessResult {
  processed: number
  failed: number
  failedIds: string[]
  items?: AiProcessItem[]
}

/** AI 标签分类 */
export type AiTagCategory = 'scene' | 'style' | 'subject' | 'color' | 'other'

/** AI 建议的单个标签（含分类，预览阶段可删减） */
export interface AiTagSuggestion {
  name: string
  category: AiTagCategory
}

/** AI 建议单条（预览阶段可编辑：改名、删标签、取消勾选） */
export interface AiSuggestionItem {
  id: string
  oldName: string
  /** AI 建议新名（用户可改；空 = 不改名） */
  suggestedName: string
  /** AI 建议标签（已清洗归并；用户可删减） */
  tags: AiTagSuggestion[]
}

/** 应用请求：用户审核后提交的（可能已修改的）建议 */
export interface AiApplyRequest {
  items: AiSuggestionItem[]
  options: AiProcessOptions
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
