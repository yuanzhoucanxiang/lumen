import { create } from 'zustand'
import type { Asset, Board, BoardItem, Folder, Tag, TagGroup } from '@shared/types'

export type ViewType =
  | { type: 'all' }
  | { type: 'starred' }
  | { type: 'trash' }
  | { type: 'folder'; id: number }
  | { type: 'tag'; id: number }

/** 白板布局模式：split=素材库+白板分屏, board=白板全屏 */
export type BoardViewMode = 'split' | 'board'

export type SortBy = 'imported' | 'name' | 'size' | 'star'

export type LayoutMode = 'masonry' | 'grid' | 'list'

interface LibraryState {
  assets: Asset[]
  loading: boolean
  tags: Tag[]
  tagGroups: TagGroup[]
  folders: Folder[]
  boards: Board[]
  /** 当前白板的元素（activeBoardId 非空时有效） */
  boardItems: BoardItem[]
  /** 当前打开的白板 id（null = 未打开） */
  activeBoardId: number | null
  /** 白板布局模式 */
  boardViewMode: BoardViewMode
  /** 白板面板宽度（split 模式） */
  boardViewWidth: number
  stats: { total: number; deleted: number; tombstones: number }

  view: ViewType
  keyword: string
  extFilters: string[]
  colorFilter: { hex: string; tolerance: number } | null
  colorCountMax: number // 0 = 不限
  starMin: number
  /** true = 只看未打标签的素材 */
  untagged: boolean
  /** 导入时间档（天），0 = 不限 */
  withinDays: number
  sortBy: SortBy
  sortDesc: boolean
  zoom: number // 1-6，控制缩略图尺寸
  layout: LayoutMode // 图库布局：瀑布流/网格/列表

  selection: string[]
  /** 非 Shift 点击时的锚点素材（Shift 范围多选起点） */
  anchorId: string | null
  previewId: string | null
  editorId: string | null
  toast: string | null
  /** 以图搜图模式：非空时图库显示与该图相似的素材 */
  similarTo: { id: string; name: string } | null
  /** AI 智能搜索模式：非空时图库显示 AI 搜索结果（与相似搜索互斥） */
  aiSearch: { query: string } | null
  /** 进行中的 AI 搜索查询词（防竞态：搜索期间切视图/退出则丢弃过期结果） */
  aiSearchPending: string | null
  history: { type: 'delete'; ids: string[] }[]

  setView: (v: ViewType) => void
  setKeyword: (k: string) => void
  toggleExtFilter: (ext: string) => void
  setColorFilter: (c: { hex: string; tolerance: number } | null) => void
  setColorCountMax: (n: number) => void
  setStarMin: (n: number) => void
  toggleUntagged: () => void
  setWithinDays: (n: number) => void
  setSort: (sortBy: SortBy, sortDesc: boolean) => void
  setZoom: (z: number) => void
  setLayout: (l: LayoutMode) => void

  refreshAssets: () => Promise<void>
  refreshTags: () => Promise<void>
  refreshTagGroups: () => Promise<void>
  refreshFolders: () => Promise<void>
  refreshBoards: () => Promise<void>
  /** 加载指定白板的元素 */
  refreshBoardItems: (boardId: number) => Promise<void>
  /** 打开/切换白板（设置 activeBoardId + 加载元素） */
  openBoard: (boardId: number) => void
  setActiveBoardId: (boardId: number | null) => void
  setBoardViewMode: (m: BoardViewMode) => void
  setBoardViewWidth: (w: number) => void
  /** 发送素材到当前白板（照抄 MOTZ：3 列错开摆放,返回已存在的 id） */
  sendAssetsToBoard: (ids: string[]) => Promise<string[]>
  refreshStats: () => Promise<void>
  refreshAll: () => Promise<void>

  importDialog: () => Promise<void>
  importFiles: (files: File[]) => Promise<void>
  updateAssetLocal: (id: string, patch: Partial<Asset>) => void
  deleteSelection: (permanent?: boolean) => Promise<void>
  restoreSelection: () => Promise<void>
  emptyTrash: () => Promise<void>

  setSelection: (ids: string[]) => void
  toggleSelect: (id: string, multi: boolean) => void
  /** Windows 式 Shift 范围多选：选中锚点到目标之间的连续素材 */
  selectRange: (id: string) => void
  setSimilarTo: (v: { id: string; name: string } | null) => void
  /** 设置 AI 搜索结果（直接写入 assets，不清会保持）；pending 被清（用户已退出/切视图）时丢弃过期结果 */
  setAiSearchResults: (query: string, assets: Asset[]) => void
  clearAiSearch: () => void
  setAiSearchPending: (q: string | null) => void
  openPreview: (id: string | null) => void
  openEditor: (id: string | null) => void
  /** AI 处理对话框开关 */
  aiDialogOpen: boolean
  openAiDialog: () => void
  closeAiDialog: () => void
  showToast: (msg: string) => void
  undoLast: () => Promise<void>
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

/** 导入后自动 AI 处理：若设置页开启了「导入后自动 AI」且有 key，对新导入的素材跑 AI */
async function autoAiAfterImport(importedCount: number): Promise<void> {
  if (importedCount <= 0) return
  const settings = await window.api.getSettings()
  if (!settings.aiAutoOnImport || !settings.aiHasKey) return
  // 新导入的素材按 imported_at 排序在最前面，取前 importedCount 条
  const fresh = await window.api.queryAssets({ sortBy: 'imported', sortDesc: true, limit: importedCount })
  if (fresh.length === 0) return
  try {
    const r = await window.api.aiProcess(
      fresh.map((a) => a.id),
      { rename: true, tag: true, maxTags: 5, tagGroupName: 'AI 标签' }
    )
    useLibraryStore.getState().showToast(
      r.failed > 0
        ? `AI 自动处理：${r.processed} 张成功，${r.failed} 张失败`
        : `AI 自动处理：${r.processed} 张（改名+打标签）`
    )
    await useLibraryStore.getState().refreshAll()
  } catch (e) {
    useLibraryStore.getState().showToast(`AI 自动处理失败：${(e as Error).message}`)
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  assets: [],
  loading: false,
  tags: [],
  tagGroups: [],
  folders: [],
  boards: [],
  boardItems: [],
  activeBoardId: null,
  boardViewMode: 'split',
  boardViewWidth: Number(localStorage.getItem('lumen.board.width')) || 480,
  stats: { total: 0, deleted: 0, tombstones: 0 },

  view: { type: 'all' },
  keyword: '',
  extFilters: [],
  colorFilter: null,
  colorCountMax: 0,
  starMin: 0,
  untagged: false,
  withinDays: 0,
  sortBy: 'imported',
  sortDesc: true,
  zoom: 3,
  layout: 'masonry',

  selection: [],
  anchorId: null,
  previewId: null,
  editorId: null,
  aiDialogOpen: false,
  toast: null,
  similarTo: null,
  aiSearch: null,
  aiSearchPending: null,
  history: [],

  setView: (view) => {
    set({ view, selection: [], previewId: null, similarTo: null, aiSearch: null, aiSearchPending: null })
    void get().refreshAssets()
  },
  /** 打开/切换白板（画布常驻,切换当前白板） */
  openBoard: (boardId) => {
    set({ activeBoardId: boardId, selection: [], previewId: null, similarTo: null, aiSearch: null, aiSearchPending: null })
    void get().refreshBoardItems(boardId)
  },
  setActiveBoardId: (boardId) => {
    set({ activeBoardId: boardId })
    if (boardId != null) void get().refreshBoardItems(boardId)
  },
  setBoardViewMode: (boardViewMode) => {
    set({ boardViewMode })
    if (boardViewMode === 'board' || boardViewMode === 'split') {
      const ab = get().activeBoardId
      if (ab != null) void get().refreshBoardItems(ab)
    }
  },
  setBoardViewWidth: (boardViewWidth) => {
    try {
      localStorage.setItem('lumen.board.width', String(boardViewWidth))
    } catch {
      /* 忽略 */
    }
    set({ boardViewWidth })
  },
  /** 发送素材到当前白板（照抄 MOTZ sendAssetsToBoard：3 列错开 + 按宽高比定尺寸） */
  sendAssetsToBoard: async (ids) => {
    const s = get()
    if (s.activeBoardId == null) return []
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
    if (uniqueIds.length === 0) return []
    const existing = new Set(s.boardItems.filter((i) => i.assetId).map((i) => i.assetId))
    const newIds = uniqueIds.filter((id) => !existing.has(id))
    const existingIds = uniqueIds.filter((id) => existing.has(id))
    if (newIds.length > 0) {
      const originX = 96 + ((s.boardItems.length * 42) % 260)
      const originY = 90 + ((s.boardItems.length * 34) % 180)
      let cursorX = originX
      let cursorY = originY
      let rowHeight = 0
      for (let i = 0; i < newIds.length; i++) {
        if (i > 0 && i % 3 === 0) {
          cursorX = originX
          cursorY += rowHeight
          rowHeight = 0
        }
        const asset = s.assets.find((a) => a.id === newIds[i])
        const maxW = 280
        let w = 240
        let h = 0
        if (asset && asset.width > 0 && asset.height > 0) {
          w = Math.min(maxW, asset.width)
          h = w * (asset.height / Math.max(1, asset.width))
        }
        await window.api.addBoardItem(s.activeBoardId, {
          assetId: newIds[i],
          type: 'asset',
          x: Math.round(cursorX),
          y: Math.round(cursorY),
          width: Math.round(w),
          height: Math.round(h)
        })
        cursorX += w
        rowHeight = Math.max(rowHeight, h || w * 0.75)
      }
      await s.refreshBoardItems(s.activeBoardId)
    }
    return existingIds
  },
  setKeyword: (keyword) => {
    set({ keyword })
    void get().refreshAssets()
  },
  toggleExtFilter: (ext) => {
    const cur = get().extFilters
    set({ extFilters: cur.includes(ext) ? cur.filter((e) => e !== ext) : [...cur, ext] })
    void get().refreshAssets()
  },
  setColorFilter: (colorFilter) => {
    set({ colorFilter })
    void get().refreshAssets()
  },
  setColorCountMax: (colorCountMax) => {
    set({ colorCountMax })
    void get().refreshAssets()
  },
  setStarMin: (starMin) => {
    set({ starMin })
    void get().refreshAssets()
  },
  toggleUntagged: () => {
    set({ untagged: !get().untagged })
    void get().refreshAssets()
  },
  setWithinDays: (withinDays) => {
    set({ withinDays })
    void get().refreshAssets()
  },
  setSort: (sortBy, sortDesc) => {
    set({ sortBy, sortDesc })
    void get().refreshAssets()
  },
  setZoom: (zoom) => set({ zoom }),
  setLayout: (layout) => set({ layout }),

  refreshAssets: async () => {
    const s = get()
    set({ loading: true })
    try {
      // AI 搜索模式：结果已直接写入 assets，任何筛选/刷新都不覆盖（退出搜索才恢复）
      if (s.aiSearch) {
        set({ loading: false })
        return
      }
      // 以图搜图模式：走相似度查询，忽略常规筛选
      if (s.similarTo) {
        const assets = await window.api.findSimilar(s.similarTo.id)
        set({ assets, loading: false })
        return
      }
      const view = s.view
      let folders = s.folders
      // 智能文件夹视图：按保存的条件查询
      let smartQuery: Record<string, unknown> | null = null
      if (view.type === 'folder') {
        let folder = folders.find((f) => f.id === view.id)
        if (!folder) {
          folders = await window.api.listFolders()
          set({ folders })
          folder = folders.find((f) => f.id === view.id)
        }
        if (folder?.isSmart) {
          try {
            smartQuery = JSON.parse(folder.conditions)
          } catch {
            smartQuery = {}
          }
        }
      }
      const assets = await window.api.queryAssets({
        keyword: s.keyword || undefined,
        exts: s.extFilters.length > 0 ? s.extFilters : undefined,
        color: s.colorFilter?.hex,
        colorTolerance: s.colorFilter?.tolerance,
        colorCountMax: s.colorCountMax || undefined,
        starMin: s.starMin || undefined,
        untagged: s.untagged || undefined,
        withinDays: s.withinDays || undefined,
        sortBy: s.sortBy,
        sortDesc: s.sortDesc,
        deleted: view.type === 'trash',
        folderId: view.type === 'folder' && !smartQuery ? view.id : undefined,
        tagIds: view.type === 'tag' ? [view.id] : undefined,
        ...(smartQuery ?? {})
      })
      let result = assets
      if (view.type === 'starred') result = assets.filter((a) => a.star > 0)
      set({ assets: result, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  refreshTags: async () => set({ tags: await window.api.listTags() }),
  refreshTagGroups: async () => set({ tagGroups: await window.api.listTagGroups() }),
  refreshFolders: async () => set({ folders: await window.api.listFolders() }),
  refreshBoards: async () => set({ boards: await window.api.listBoards() }),
  refreshBoardItems: async (boardId) => set({ boardItems: await window.api.listBoardItems(boardId) }),
  refreshStats: async () => set({ stats: await window.api.getLibraryStats() }),

  refreshAll: async () => {
    const s = get()
    await Promise.all([
      s.refreshAssets(),
      s.refreshTags(),
      s.refreshTagGroups(),
      s.refreshFolders(),
      s.refreshBoards(),
      s.refreshStats()
    ])
  },

  importDialog: async () => {
    const r = await window.api.importViaDialog()
    const msg =
      r.failed > 0
        ? `导入完成：新增 ${r.imported}，跳过 ${r.skipped}，⚠ 失败 ${r.failed}`
        : `导入完成：新增 ${r.imported}，跳过 ${r.skipped}`
    get().showToast(msg)
    await get().refreshAll()
    await autoAiAfterImport(r.imported)
  },

  importFiles: async (files) => {
    if (files.length === 0) return
    const r = await window.api.importFileObjects(files)
    const msg =
      r.failed > 0
        ? `导入完成：新增 ${r.imported}，跳过 ${r.skipped}，⚠ 失败 ${r.failed}`
        : `导入完成：新增 ${r.imported}，跳过 ${r.skipped}`
    get().showToast(msg)
    await get().refreshAll()
    await autoAiAfterImport(r.imported)
  },

  updateAssetLocal: (id, patch) =>
    set({ assets: get().assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),

  deleteSelection: async (permanent = false) => {
    const ids = get().selection
    if (ids.length === 0) return
    if (!permanent) {
      set({ history: [...get().history.slice(-19), { type: 'delete', ids }] })
    }
    await window.api.deleteAssets(ids, permanent)
    set({ selection: [], previewId: null })
    await get().refreshAll()
  },

  undoLast: async () => {
    const h = get().history
    if (h.length === 0) return
    const last = h[h.length - 1]
    set({ history: h.slice(0, -1) })
    if (last.type === 'delete') {
      await window.api.restoreAssets(last.ids)
      get().showToast(`已撤销删除，恢复 ${last.ids.length} 个素材`)
      await get().refreshAll()
    }
  },

  restoreSelection: async () => {
    const ids = get().selection
    if (ids.length === 0) return
    await window.api.restoreAssets(ids)
    set({ selection: [] })
    await get().refreshAll()
  },

  emptyTrash: async () => {
    await window.api.emptyTrash()
    set({ selection: [] })
    await get().refreshAll()
  },

  setSelection: (selection) => set({ selection }),
  setSimilarTo: (similarTo) => {
    set({ similarTo, selection: [], previewId: null, aiSearch: null, aiSearchPending: null })
    void get().refreshAssets()
  },
  /** AI 搜索结果直接写入 assets（与相似搜索互斥）；pending 已失效时丢弃（防竞态） */
  setAiSearchResults: (query, assets) => {
    const s = get()
    if (s.aiSearchPending !== query) return // 搜索期间用户已退出/切视图，丢弃过期结果
    set({ aiSearch: { query }, assets, similarTo: null, selection: [], previewId: null, loading: false, aiSearchPending: null })
  },
  setAiSearchPending: (q) => set({ aiSearchPending: q }),
  clearAiSearch: () => {
    set({ aiSearch: null, aiSearchPending: null })
    void get().refreshAssets()
  },
  toggleSelect: (id, multi) => {
    const cur = get().selection
    if (multi) {
      set({ selection: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
    } else {
      set({
        selection: cur.length === 1 && cur[0] === id ? [] : [id],
        anchorId: id
      })
    }
  },
  selectRange: (id) => {
    const list = get().assets
    const anchor = get().anchorId
    const ai = list.findIndex((a) => a.id === anchor)
    const bi = list.findIndex((a) => a.id === id)
    // 无有效锚点：退化为单选并以其为锚
    if (ai === -1 || bi === -1) {
      set({ selection: [id], anchorId: id })
      return
    }
    const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai]
    set({ selection: list.slice(lo, hi + 1).map((a) => a.id) })
  },
  openPreview: (previewId) => set({ previewId }),
  openEditor: (editorId) => set({ editorId }),
  openAiDialog: () => set({ aiDialogOpen: true }),
  closeAiDialog: () => set({ aiDialogOpen: false }),

  showToast: (msg) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: msg })
    toastTimer = setTimeout(() => set({ toast: null }), 3000)
  }
}))

/** 缩略图目标宽度（px） */
export function zoomToWidth(zoom: number): number {
  const steps = [96, 128, 176, 232, 300, 380]
  return steps[Math.min(Math.max(zoom, 1), 6) - 1]
}

/** 视频扩展名集合 */
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'm4v']

/**
 * 素材缩略图 URL。
 * 视频：优先返回故事板四宫格 URL（onError 回退到首帧缩略图，见卡片组件）；
 * 其余可出缩略图格式：返回 thumbnail.jpg。
 * edited 戳用于编辑/恢复后强制刷新浏览器缓存的图片。
 */
export function assetThumbUrl(a: { id: string; ext: string; edited?: number }): string {
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'tiff', 'tif', 'psd',
    'heic', 'heif', 'ai',
    'ttf', 'otf', 'ttc', 'woff', 'woff2']
  if (VIDEO_EXTS.includes(a.ext)) {
    // 视频封面 = 故事板四宫格（无故事板的短视频由 onError 回退到首帧缩略图）
    return `${window.api.storyboardUrl(a.id)}&e=${a.edited ?? 0}`
  }
  if (!imageExts.includes(a.ext)) return ''
  return `${window.api.thumbnailUrl(a.id)}&e=${a.edited ?? 0}`
}

/** 可进入编辑器/浏览器可直接解码的格式（PSD 有缩略图但无法进编辑器） */
export function assetEditable(a: { ext: string }): boolean {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'tiff', 'tif'].includes(a.ext)
}

/** 视频故事板 URL（悬停预览时优先显示，无则返回空串） */
export function assetStoryboardUrl(a: { id: string; ext: string; edited?: number }): string {
  return VIDEO_EXTS.includes(a.ext)
    ? `${window.api.storyboardUrl(a.id)}&e=${a.edited ?? 0}`
    : ''
}
