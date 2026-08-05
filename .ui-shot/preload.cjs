/* 截图专用 mock preload：无需真实素材库即可渲染完整 UI */
const { contextBridge } = require('electron')

const now = Date.now()
const DAY = 86400e3

const mk = (id, name, ext, w, h, size, star, tagNames, url, colors) => ({
  id,
  name,
  ext,
  relDir: '',
  size,
  width: w,
  height: h,
  colors: JSON.stringify(colors),
  hash: '',
  star,
  comment: '',
  url: url ?? '',
  createdAt: now - 30 * DAY,
  importedAt: now - Math.floor(Math.random() * 20) * DAY,
  deletedAt: null,
  tagNames
})

const assets = [
  mk('a01', '雾中群山', 'jpg', 1600, 1067, 2450000, 5, ['风光', '旅拍'], '', [[96, 110, 128], [42, 48, 58], [168, 176, 184]]),
  mk('a02', '黄昏海岸', 'jpg', 1600, 900, 1980000, 4, ['风光'], 'https://example.com/sunset', [[214, 148, 92], [52, 60, 84], [248, 214, 160]]),
  mk('a03', '城市夜景-长曝光', 'jpg', 1200, 1800, 3200000, 3, ['城市'], '', [[24, 28, 44], [255, 190, 92], [80, 96, 140]]),
  mk('a04', '工作室人像_01', 'jpg', 1080, 1350, 1540000, 5, ['人像'], '', [[186, 142, 116], [36, 30, 28], [232, 214, 198]]),
  mk('a05', '极简海报排版参考', 'png', 1240, 1754, 890000, 0, ['灵感', '海报'], '', [[240, 236, 228], [28, 28, 30], [224, 122, 58]]),
  mk('a06', '森林晨雾', 'jpg', 1600, 1067, 2100000, 4, ['风光', '旅拍'], '', [[64, 92, 74], [20, 28, 22], [172, 190, 168]]),
  mk('a07', '产品静物-香氛', 'jpg', 1400, 1400, 1760000, 0, ['静物'], '', [[202, 178, 152], [92, 74, 58], [240, 234, 224]]),
  mk('a08', '街头瞬间-雨伞', 'jpg', 1600, 1200, 2320000, 2, ['城市', '街拍'], 'https://example.com/rain', [[44, 48, 56], [188, 60, 52], [150, 156, 166]]),
  mk('a09', '抽象渐变背景', 'png', 1600, 1000, 640000, 0, ['灵感'], '', [[236, 140, 90], [120, 60, 140], [250, 220, 160]]),
  mk('a10', '手写字体样张', 'jpg', 1200, 1600, 1120000, 1, ['字体', '灵感'], '', [[238, 232, 220], [40, 38, 36], [120, 96, 72]]),
  mk('a11', '胶片质感-老街', 'jpg', 1600, 1067, 2680000, 4, ['街拍', '胶片'], '', [[148, 118, 88], [52, 44, 38], [210, 190, 160]]),
  mk('a12', '建筑光影-美术馆', 'jpg', 1400, 934, 1860000, 5, ['建筑'], '', [[222, 218, 210], [36, 38, 42], [160, 158, 150]]),
  mk('a13', '咖啡拉花特写', 'jpg', 1200, 1500, 1450000, 0, ['静物'], '', [[120, 84, 60], [226, 214, 198], [64, 44, 32]]),
  mk('a14', '雪山日出', 'jpg', 1600, 900, 2240000, 3, ['风光'], '', [[250, 200, 150], [70, 80, 110], [240, 244, 250]])
]

const tags = [
  { id: 1, name: '风光', count: 5, color: '#4da9e9', groupId: 1 },
  { id: 2, name: '人像', count: 1, color: '#e8a0b4', groupId: 1 },
  { id: 3, name: '灵感', count: 3, color: '#f5d76e', groupId: 2 },
  { id: 4, name: '城市', count: 2, color: '#7b8cde', groupId: null },
  { id: 5, name: '胶片', count: 1, color: '#e8a33d', groupId: null }
]

const tagGroups = [
  { id: 1, name: '题材' },
  { id: 2, name: '用途' }
]

const folders = [
  { id: 1, name: '旅行相册', parentId: null, isSmart: 0, conditions: '', count: 4 },
  { id: 4, name: '2025 西北环线', parentId: 1, isSmart: 0, conditions: '', count: 3 },
  { id: 5, name: '无人机航拍', parentId: 1, isSmart: 0, conditions: '', count: 1 },
  { id: 2, name: '海报参考', parentId: null, isSmart: 0, conditions: '', count: 2 },
  { id: 3, name: '暖色调 · 4★以上', parentId: null, isSmart: 1, conditions: '{"starMin":4}', count: 6 }
]

const noop = async () => {}

contextBridge.exposeInMainWorld('api', {
  getLibraryInfo: async () => ({ name: '我的素材库', path: 'C:/demo/EagleLike.library' }),
  getLibraryStats: async () => ({ total: assets.length, deleted: 2 }),
  listLibraries: async () => ({
    libraries: [{ name: '我的素材库', path: 'C:/demo/EagleLike.library' }],
    current: 'C:/demo/EagleLike.library'
  }),
  chooseLibrary: async () => null,
  switchLibrary: async () => ({}),
  removeLibrary: noop,

  importViaDialog: async () => ({ imported: 0, skipped: 0, failed: 0 }),
  importFileObjects: async () => ({ imported: 0, skipped: 0, failed: 0 }),

  queryAssets: async () => (process.env.SHOT_EMPTY ? [] : assets),
  updateAsset: noop,
  deleteAssets: noop,
  restoreAssets: noop,
  emptyTrash: noop,
  findDuplicates: async () => [],
  findSimilar: async () => assets.slice(0, 6),
  applyEdit: noop,

  getSettings: async () => ({ watchDirs: [], importMode: 'copy' }),
  updateSettings: async (p) => ({ watchDirs: p.watchDirs ?? [], importMode: p.importMode ?? 'copy' }),
  chooseWatchDir: async () => null,

  listTags: async () => tags,
  createTag: async (name) => ({ id: 99, name, count: 0, color: '', groupId: null }),
  renameTag: noop,
  setTagColor: noop,
  deleteTag: noop,
  setAssetTags: noop,
  addTagToAssets: noop,

  listTagGroups: async () => tagGroups,
  createTagGroup: async (name) => ({ id: 99, name }),
  renameTagGroup: noop,
  deleteTagGroup: noop,
  assignTagToGroup: noop,

  listFolders: async () => folders,
  createFolder: async (name) => ({ id: 99, name, parentId: null, isSmart: 0, conditions: '', count: 0 }),
  updateSmartFolder: noop,
  renameFolder: noop,
  deleteFolder: noop,
  addAssetsToFolder: noop,
  removeAssetsFromFolder: noop,

  showInFolder: noop,
  copyImage: async () => true,
  openExternal: noop,
  exportAssets: async (ids) => ({ exported: ids.length, target: 'C:/demo/export' }),

  thumbnailUrl: (id) => `asset://${id}/file?t=t`,
  originalUrl: (id) => `asset://${id}/file?t=o`,

  onClipImported: () => {},

  getAppVersion: async () => '0.2.0',
  checkUpdate: async () => ({ state: 'dev' }),
  downloadUpdate: async () => {},
  installUpdate: async () => {},
  // 模拟一次「发现新版本」推送，验证更新卡片 UI
  onUpdateStatus: (cb) => {
    setTimeout(
      () =>
        cb({
          state: 'available',
          version: '9.9.9',
          notes: '示例更新内容：\n- 剪藏扩展区域截图与长截图\n- 导出文件夹与打包 ZIP\n- 字体样张预览'
        }),
      1200
    )
  }
})
