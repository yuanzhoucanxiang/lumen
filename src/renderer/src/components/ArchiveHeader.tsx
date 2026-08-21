import { useMemo } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import { useTheme } from '../theme'

/**
 * 银盐鸦影的工作区抬头。
 * 它不是装饰标题，而是把当前视图解释成一张可追踪的接触印样：
 * 哪个档案盒、多少张底片、当前选中了多少张，一眼可读。
 */
export default function ArchiveHeader() {
  const theme = useTheme()
  const pixel = theme === 'pixel-glitch'
  const view = useLibraryStore((s) => s.view)
  const assets = useLibraryStore((s) => s.assets)
  const folders = useLibraryStore((s) => s.folders)
  const tags = useLibraryStore((s) => s.tags)
  const selection = useLibraryStore((s) => s.selection)
  const loading = useLibraryStore((s) => s.loading)

  const title = useMemo(() => {
    if (view.type === 'all') return '全部素材'
    if (view.type === 'starred') return '已收藏'
    if (view.type === 'trash') return '回收站'
    if (view.type === 'folder') return folders.find((f) => f.id === view.id)?.name ?? '文件夹'
    return tags.find((t) => t.id === view.id)?.name ?? '标签'
  }, [folders, tags, view])

  const archiveCode = useMemo(() => {
    const prefix = view.type === 'folder' ? 'BX' : view.type === 'tag' ? 'TG' : view.type === 'starred' ? 'FV' : view.type === 'trash' ? 'TR' : 'RA'
    const id = 'id' in view ? view.id : 1
    return `${prefix}-${String(id).padStart(3, '0')}`
  }, [view])

  const mediaTypeCount = useMemo(() => new Set(assets.map((asset) => asset.ext.toLowerCase())).size, [assets])
  const accessState = view.type === 'trash' ? 'RESTRICTED' : 'READ / WRITE'

  return (
    <header className="archive-masthead">
      <div className="archive-masthead__identity">
        <div className="archive-masthead__eyebrow">
          <span>{pixel ? 'MASTER INDEX' : 'CONTACT SHEET'}</span>
          <span aria-hidden="true">/</span>
          <span>{archiveCode}</span>
        </div>
        <div className="archive-masthead__title-row">
          <h2>{title}</h2>
          <span className="archive-masthead__count tnum">{String(assets.length).padStart(3, '0')} {pixel ? 'RECORDS' : 'FRAMES'}</span>
        </div>
      </div>

      {pixel && (
        <div className="archive-masthead__telemetry" aria-hidden="true">
          <span>
            <small>CHANNEL</small>
            <b>{archiveCode}</b>
          </span>
          <span>
            <small>MEDIA</small>
            <b>{String(mediaTypeCount).padStart(2, '0')} TYPES</b>
          </span>
          <span>
            <small>ACCESS</small>
            <b>{accessState}</b>
          </span>
        </div>
      )}

      <div className="archive-masthead__readout" aria-label="当前档案状态">
        <span className="archive-selection-readout mono tnum">{pixel ? 'SEL' : '已选'} {String(selection.length).padStart(2, '0')}</span>
        <div className={`archive-safe-light ${loading ? 'is-working' : ''}`} title={loading ? (pixel ? '正在编制索引' : '正在显影素材') : (pixel ? '索引已就绪' : '档案已就绪')}>
          <span className="archive-safe-light__lamp" aria-hidden="true" />
          <span>
            {loading ? (pixel ? 'INDEXING' : 'PROCESSING') : 'READY'}
          </span>
          <Icon name={loading ? 'rotate' : 'check'} size={12} className={loading ? 'animate-spin' : ''} />
        </div>
      </div>
    </header>
  )
}
