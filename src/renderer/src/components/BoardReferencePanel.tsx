import { useMemo, useState } from 'react'
import { assetThumbUrl, useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import type { Asset } from '@shared/types'
import { useTheme } from '../theme'

const ASSET_MIME = 'application/x-eaglelike-assets'

function sourceName(
  view: ReturnType<typeof useLibraryStore.getState>['view'],
  folders: ReturnType<typeof useLibraryStore.getState>['folders'],
  tags: ReturnType<typeof useLibraryStore.getState>['tags']
): string {
  if (view.type === 'folder') return folders.find((folder) => folder.id === view.id)?.name ?? '文件夹'
  if (view.type === 'tag') return tags.find((tag) => tag.id === view.id)?.name ?? '标签'
  if (view.type === 'starred') return '参考收藏'
  if (view.type === 'trash') return '回收站'
  return '全部参考'
}

function beginAssetDrag(event: React.DragEvent, asset: Asset): void {
  event.dataTransfer.setData(ASSET_MIME, JSON.stringify([asset.id]))
  event.dataTransfer.effectAllowed = 'copy'
}

export default function BoardReferencePanel() {
  const pixel = useTheme() === 'pixel-glitch'
  const assets = useLibraryStore((state) => state.assets)
  const boardItems = useLibraryStore((state) => state.boardItems)
  const folders = useLibraryStore((state) => state.folders)
  const tags = useLibraryStore((state) => state.tags)
  const view = useLibraryStore((state) => state.view)
  const keyword = useLibraryStore((state) => state.keyword)
  const loading = useLibraryStore((state) => state.loading)
  const setKeyword = useLibraryStore((state) => state.setKeyword)
  const sendAssetsToBoard = useLibraryStore((state) => state.sendAssetsToBoard)
  const openPreview = useLibraryStore((state) => state.openPreview)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('lumen.board.referenceTrayCollapsed') === '1'
    } catch {
      return false
    }
  })
  const updateCollapsed = (next: boolean): void => {
    setCollapsed(next)
    try {
      localStorage.setItem('lumen.board.referenceTrayCollapsed', next ? '1' : '0')
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }

  const placed = useMemo(
    () => new Set(boardItems.flatMap((item) => (item.assetId ? [item.assetId] : []))),
    [boardItems]
  )
  // 元素清单是否对得上当前白板:切板后加载完成前为未知,此时禁用添加(防重复入板)
  const placedKnown = useLibraryStore((state) => state.boardItemsBoardId) === useLibraryStore((state) => state.activeBoardId)
  const source = sourceName(view, folders, tags)

  if (collapsed) {
    return (
      <aside data-board-reference-panel data-collapsed="true" className="board-reference-panel board-reference-panel--collapsed">
        <button
          aria-label="展开参考素材架"
          title="展开参考素材架"
          className="board-reference-panel__rail"
          onClick={() => updateCollapsed(false)}
        >
          <span className="board-rail__opener" aria-hidden="true">
            <Icon name="chevronRight" size={12} />
          </span>
          <span className="board-rail__code mono" aria-hidden="true">{pixel ? 'R-02' : '02'}</span>
          <span className="board-rail__label mono" aria-hidden="true">{pixel ? 'REF NODE' : 'CONTACT SHEET'}</span>
          <span className="board-rail__signal" aria-hidden="true" />
          <span className="board-rail__count mono" aria-hidden="true">{String(assets.length).padStart(pixel ? 4 : 3, '0')}</span>
          <small className="board-rail__foot mono" aria-hidden="true">{pixel ? 'LINK' : 'FRAMES'}</small>
          <span className="sr-only">参考素材</span>
        </button>
      </aside>
    )
  }

  return (
    <aside data-board-reference-panel data-collapsed="false" className="board-reference-panel flex min-h-0 w-[264px] shrink-0 flex-col">
      <header className="board-reference-panel__head shrink-0">
        <div className="min-w-0">
          <span className="mono block text-[8px] tracking-[0.18em] text-[var(--accent-text)]">REFERENCE TRAY</span>
          <div className="mt-1 flex items-baseline gap-2">
            <strong className="truncate text-[13px] font-medium text-[var(--text-main)]">{source}</strong>
            <span className="mono shrink-0 text-[9px] text-[var(--text-faint)]">{assets.length} FRAMES</span>
          </div>
        </div>
        <button
          aria-label="收起参考素材架"
          title="收起参考素材架"
          className="board-reference-panel__collapse"
          onClick={() => updateCollapsed(true)}
        >
          <Icon name="chevronLeft" size={12} />
        </button>
      </header>

      <div className="board-reference-panel__search shrink-0">
        <Icon name="search" size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
        <input
          aria-label="搜索参考素材"
          className="field-input h-8 w-full pr-8 text-[11px]"
          style={{ paddingLeft: 34 }}
          value={keyword}
          placeholder="筛选当前参考来源…"
          onChange={(event) => setKeyword(event.target.value)}
        />
        {keyword && (
          <button
            aria-label="清空参考素材搜索"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-main)]"
            onClick={() => setKeyword('')}
          >
            ×
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-y border-[var(--border)] px-3 py-1.5 text-[9px] text-[var(--text-faint)]">
        <span>拖到右侧画布放置</span>
        <span className="mono">DRAG / DROP</span>
      </div>

      <div className="modal-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-[10px] text-[var(--text-faint)]">正在装片…</div>
        ) : assets.length === 0 ? (
          <div className="board-reference-panel__empty">
            <Icon name="image" size={20} />
            <span>当前来源没有素材</span>
            <small>可在左侧切换文件夹或标签</small>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {assets.map((asset) => {
              const thumb = assetThumbUrl(asset)
              const alreadyPlaced = placedKnown && placed.has(asset.id)
              const addDisabled = alreadyPlaced || !placedKnown
              return (
                <article
                  key={asset.id}
                  data-board-reference-asset={asset.id}
                  draggable
                  className="board-reference-card group"
                  onDragStart={(event) => beginAssetDrag(event, asset)}
                  onDoubleClick={() => openPreview(asset.id)}
                >
                  <div className="board-reference-card__media">
                    {thumb ? (
                      <img src={thumb} alt={asset.name} draggable={false} loading="lazy" />
                    ) : (
                      <Icon name="file" size={20} className="text-[var(--text-faint)]" />
                    )}
                    <button
                      aria-label={alreadyPlaced ? `${asset.name} 已在白板中` : `添加 ${asset.name} 到白板`}
                      title={alreadyPlaced ? '已在当前白板' : placedKnown ? '添加到当前白板' : '白板元素加载中…'}
                      disabled={addDisabled}
                      className={`board-reference-card__add ${alreadyPlaced ? 'is-placed' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        void sendAssetsToBoard([asset.id])
                      }}
                    >
                      <Icon name={alreadyPlaced ? 'check' : 'plus'} size={10} strokeWidth={2.5} />
                    </button>
                  </div>
                  <footer>
                    <span title={asset.name}>{asset.name}</span>
                    <small className="mono">{asset.ext.toUpperCase()}</small>
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
