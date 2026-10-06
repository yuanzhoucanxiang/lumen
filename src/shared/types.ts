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
  /** 导入来源：'' = 用户手动；agent/clip/watcher/startup/screenshot（里程碑 159） */
  source: string
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
  /** 用户排除标记：1=排除（AI 打标签时绝不使用） */
  excluded: number
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

/** 白板（无限画布） */
export interface Board {
  id: number
  name: string
  createdAt: number
  updatedAt: number
  /** 参考线 JSON：[{x?,y?,horizontal:boolean}],vertical=有 x,horizontal=有 y */
  guides: string
  /** 画布外观 JSON：{bg:'dark'|'gray'|'light'|'white'|'black'|'#rrggbb', grid:boolean, gridSize:number} */
  appearance: string
  /** 上次视口 JSON：{s:缩放, x:平移x, y:平移y}，''=未保存(首开用默认视口)。白板重开保持缩放与位置 */
  viewport: string
}

/** 形状元素规格（points 为元素内归一化坐标 0-1，渲染时乘 width/height） */
export interface ShapeSpec {
  /** pen=手绘折线, line=直线, arrow=箭头, rect=矩形, ellipse=椭圆 */
  kind: 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse'
  /** pen: [[x,y],...] 折线点; line/arrow: [[x,y],[x,y]] 两端点 */
  points: number[][]
  /** 描边颜色 hex */
  color: string
  /** 描边宽度（元素单位） */
  sw: number
  /** 填充色 hex（rect/ellipse 可选，默认无填充） */
  fill?: string
}

/** 白板元素（图片/视频/文字/形状） */
export interface BoardItem {
  id: string
  boardId: number
  /** 关联素材 id（note/shape 类型为 null） */
  assetId: string | null
  /** 'asset' = 图片/视频, 'note' = 文字, 'shape' = 矢量形状 */
  type: 'asset' | 'note' | 'shape'
  x: number
  y: number
  width: number
  /** 0 = 按素材宽高比自动计算 */
  height: number
  /** 层级（越大越上） */
  z: number
  /** note 类型的文字内容 */
  text: string
  /** note 字体（CSS font-family） */
  noteFont: string
  /** note 文字颜色（hex） */
  noteColor: string
  /** note 字号（画布坐标 px） */
  noteFontSize: number
  /** 元素透明度 0-100（100=不透明,对标 PureRef 参考图透明度对比） */
  opacity: number
  /** 水平翻转（镜像,对标 PureRef 画师对照检查形准） */
  flipX: boolean
  /** 垂直翻转 */
  flipY: boolean
  /** 锁定：不可拖动/缩放/删除,仍可选中以便解锁 */
  locked: boolean
  /** 所属组 id（'' = 未成组；同组元素一起选中与变换） */
  groupId: string
  /** shape 类型的规格 JSON（ShapeSpec） */
  shape: string | null
  createdAt: number
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

/* ---------------- 找图助手(对话式检索,里程碑 161) ---------------- */

/** 模型输出的结构化检索条件(与 queryAssets 能力对齐;字段全部可选) */
export interface AgentConditions {
  keyword?: string
  tags?: string[]
  shape?: 'landscape' | 'portrait' | 'square'
  withinDays?: number
  starMin?: number
  untagged?: boolean
  /** manual = 用户手动导入(source='') */
  source?: 'manual' | 'agent' | 'clip' | 'watcher' | 'screenshot' | 'startup'
  exts?: string[]
  minW?: number
  maxW?: number
  sortBy?: 'imported' | 'name' | 'size' | 'star'
  sortDesc?: boolean
}

/** 助手结果里的素材摘要(窄列,渲染层用 id 拼缩略图 URL) */
export interface AgentAssetBrief {
  id: string
  name: string
  ext: string
  width: number
  height: number
  star: number
  source: string
  tags: string[]
}

export interface AgentSearchResult {
  assets: AgentAssetBrief[]
  /** 命中总数(达计数上限时 truncated=true,total 为下限) */
  total: number
  truncated: boolean
  /** 实际生效的标签名(模型给的名字映射到库内标签后;没命中的被丢弃) */
  matchedTags: string[]
}

export interface AgentReply extends AgentSearchResult {
  /** 给用户看的自然语言回复 */
  reply: string
  conditions: AgentConditions | null
  /** 模型原始输出(渲染层作为下一轮 assistant 历史回传,保持多轮条件连续性) */
  raw: string
}

/** 多轮对话历史项(找图助手上下文) */
export interface AgentChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** 单文件导入明细（仅 detail 渠道填充，如 Agent /import） */
export interface ImportFileDetail {
  path: string
  name: string
  status: 'imported' | 'skipped' | 'failed'
  /** imported = 新素材 id；skipped = 命中的库内已有素材 id（tombstone/无命中时缺省） */
  id?: string
}

export interface ImportResult {
  imported: number
  skipped: number
  failed: number
  /** 失败文件的文件名列表（用于 UI 提示与日志） */
  failedFiles?: string[]
  /** 本次成功导入的素材 id(白板外部拖入需把新素材放到画布上) */
  importedIds?: string[]
  /** 本次跳过的重复文件命中的库内已有素材 id（Agent 渠道用于幂等补打标签/归档） */
  matchedIds?: string[]
  /** 逐文件明细（opts.detail = true 时填充） */
  files?: ImportFileDetail[]
  /** URL 抓图失败清单(含原因),仅 import:urls 返回 */
  failedUrls?: string[]
}

export interface AssetQuery {
  keyword?: string
  source?: string
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

/** 导出命名模板 */
export type ExportNaming = 'original' | 'tag_name' | 'tag_index' | 'name_index'

/** 导出选项 */
export interface ExportOptions {
  /** 命名模板 */
  naming: ExportNaming
  /** 按第一个标签分文件夹（无标签归入「未分类」） */
  groupByTag: boolean
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

/** 数据库快照备份信息（library.db.bak 系列，最新在前） */
export interface DbBackupInfo {
  path: string
  /** 文件修改时间（epoch ms） */
  mtimeMs: number
  sizeBytes: number
}

/** 自动全量 ZIP 备份信息（userData/backups，只读展示） */
export interface ZipBackupInfo {
  path: string
  mtimeMs: number
  sizeBytes: number
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

/** 白板元素可更新字段（主进程/预加载/渲染层共用签名,防止误传 id/boardId 等） */
export type BoardItemPatch = Partial<
  Pick<BoardItem, 'x' | 'y' | 'width' | 'height' | 'z' | 'text' | 'noteFont' | 'noteColor' | 'noteFontSize' | 'opacity' | 'shape' | 'flipX' | 'flipY' | 'locked' | 'groupId'>
>

/** 新建白板元素的入参（z 可显式指定：导入/撤销恢复要还原原层级，不给则自增到顶层） */
export interface NewBoardItem {
  assetId?: string | null
  type: 'asset' | 'note' | 'shape'
  x: number
  y: number
  width: number
  height: number
  text?: string
  shape?: string | null
  opacity?: number
  noteFont?: string
  noteColor?: string
  noteFontSize?: number
  flipX?: boolean
  flipY?: boolean
  locked?: boolean
  groupId?: string
  z?: number
}

/** 视频扩展名集合（主进程导出/故事板与渲染层缩略图 URL 共用,避免两处漂移） */
export const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'm4v']
