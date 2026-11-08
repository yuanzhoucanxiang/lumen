import { useEffect, useMemo, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import Button from './ui/Button'
import ExportDialog from './ExportDialog'
import ConfirmDialog from './ConfirmDialog'
import type { Folder } from '@shared/types'

/** 文件夹树 → 扁平列表（带缩进深度），供选区动作的下拉使用 */
function flattenFolders(folders: Folder[]): { folder: Folder; depth: number }[] {
  const byParent = new Map<number | null, Folder[]>()
  for (const f of folders) {
    const key = f.parentId ?? null
    const list = byParent.get(key) ?? []
    list.push(f)
    byParent.set(key, list)
  }
  const out: { folder: Folder; depth: number }[] = []
  const walk = (parentId: number | null, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      out.push({ folder, depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/**
 * 选区批量操作（里程碑 232）：此前动作只在图库底部那条选区操作条里，和右侧详情栏的
 * 「已选择 N 个素材」面板功能重叠、还要来回看两处。抽成共用组件后：
 * - layout='column'：右侧详情栏内竖排（主入口，多选时的操作都在这里）
 * - layout='row'：图库底部横排（详情栏收起时的兜底入口）
 * 两种布局共用同一套动作与弹层，aria-label 保持一致（测试与快捷键语义统一）。
 */
export default function SelectionActions({ layout = 'row' }: { layout?: 'row' | 'column' }) {
  const selection = useLibraryStore((s) => s.selection)
  const folders = useLibraryStore((s) => s.folders)
  const tags = useLibraryStore((s) => s.tags)
  const [tagOpen, setTagOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const flatFolders = useMemo(() => flattenFolders(folders), [folders])

  // 选区清空后组件不卸载（早退 null），下次再选时不能自动弹出上一次的弹层
  useEffect(() => {
    if (selection.length < 2) {
      setTagOpen(false)
      setFolderOpen(false)
      setTagInput('')
    }
  }, [selection.length])

  if (selection.length < 2) return null

  const closePopovers = () => {
    setTagOpen(false)
    setFolderOpen(false)
  }

  const applyTag = async () => {
    const name = tagInput.trim()
    if (!name) return
    await window.api.addTagToAssets(selection, name)
    const store = useLibraryStore.getState()
    // 就地更新：批量打标签后整页重查会把已加载的多页截回第一页，滚动位置被顶回上方
    store.addTagLocal(selection, name)
    store.showToast(`已为 ${selection.length} 个素材添加标签「${name}」`)
    setTagInput('')
    setTagOpen(false)
    await store.refreshTags()
    // 仅"未打标签"/标签视图的成员资格会变，才需要重查列表
    if (store.untagged || store.view.type === 'tag') await store.refreshAssets()
  }

  const moveToFolder = async (folder: Folder) => {
    await window.api.addAssetsToFolder([...selection], folder.id)
    const store = useLibraryStore.getState()
    store.showToast(`已把 ${selection.length} 个素材移入「${folder.name}」`)
    setFolderOpen(false)
    await store.refreshFolders()
    // 只有在"文件夹视图"里成员资格才会变化（素材可能离开当前夹）；其它视图重查只会白丢滚动位置
    if (store.view.type === 'folder') await store.refreshAssets()
  }

  const sendToBoard = async () => {
    const st = useLibraryStore.getState()
    if (st.activeBoardId == null) {
      st.showToast('请先新建白板（白板面板右侧 + 号）')
      return
    }
    const existing = await st.sendAssetsToBoard([...selection])
    st.showToast(existing.length > 0 ? '选中的素材已在当前白板中' : `已发送 ${selection.length} 张到当前白板`)
  }

  const tagPanel = (
    <>
      <p className="section-title mb-2">批量添加标签</p>
      <input
        autoFocus
        aria-label="批量标签名"
        className="field-input w-full text-[12px]"
        placeholder="输入标签名，回车应用"
        value={tagInput}
        list="selection-tag-suggestions"
        onChange={(e) => setTagInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void applyTag()
          if (e.key === 'Escape') setTagOpen(false)
        }}
      />
      <datalist id="selection-tag-suggestions">
        {tags.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
      <Button
        variant="primary"
        size="md"
        className="mt-2 w-full"
        disabled={!tagInput.trim()}
        onClick={() => void applyTag()}
      >
        应用到 {selection.length} 个素材
      </Button>
    </>
  )

  const folderList = flatFolders.map(({ folder, depth }) => (
    <button
      key={folder.id}
      className="block w-full truncate px-2 py-1 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
      style={{ paddingLeft: 8 + depth * 14 }}
      title={folder.name}
      onClick={() => void moveToFolder(folder)}
    >
      {folder.name}
    </button>
  ))

  const dialogs = (
    <>
      {exportOpen && <ExportDialog ids={selection} onClose={() => setExportOpen(false)} />}
      {confirmDelete && (
        <ConfirmDialog
          title={`删除 ${selection.length} 个素材？`}
          message="素材会移入回收站，可在回收站恢复；回收站中的素材可再永久删除。"
          confirmLabel="移入回收站"
          danger
          onConfirm={() => useLibraryStore.getState().deleteSelection(false)}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )

  if (layout === 'column') {
    // 里程碑 233：重排成「计数 + 2×2 主操作网格 + AI + 分隔线 + 次级操作」，
    // 避免七个等宽描边按钮把面板塞满、删除/取消与主操作抢视觉权重
    const gridBtn = 'w-full justify-start'
    return (
      <div className="flex w-full flex-col gap-2.5" data-testid="selection-actions">
        <div className="flex items-baseline justify-between">
          <p className="mono text-[12px] tracking-[0.08em] text-[var(--accent-text)]">
            已选 {selection.length} 项
          </p>
          <span className="text-[10px] text-[var(--text-faint)]">批量操作</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Button
            icon={<Icon name="tag" size={12} />}
            aria-label="为所选素材添加标签"
            aria-expanded={tagOpen}
            className={gridBtn}
            onClick={() => {
              setFolderOpen(false)
              setTagOpen((v) => !v)
            }}
          >
            标签
          </Button>
          <Button
            icon={<Icon name="folder" size={12} />}
            aria-label="把所选素材移入文件夹"
            aria-expanded={folderOpen}
            disabled={flatFolders.length === 0}
            className={gridBtn}
            onClick={() => {
              setTagOpen(false)
              setFolderOpen((v) => !v)
            }}
          >
            文件夹
          </Button>
          <Button className={gridBtn} icon={<Icon name="shapes" size={12} />} onClick={() => void sendToBoard()}>
            发送白板
          </Button>
          <Button className={gridBtn} icon={<Icon name="import" size={12} />} onClick={() => setExportOpen(true)}>
            导出
          </Button>
        </div>

        {tagOpen && <div className="menu w-full p-3">{tagPanel}</div>}
        {folderOpen && (
          <div className="menu modal-scroll max-h-56 w-full overflow-y-auto p-1.5">{folderList}</div>
        )}

        <Button
          className="w-full justify-start"
          icon={<Icon name="sparkles" size={12} />}
          onClick={() => useLibraryStore.getState().openAiDialog()}
        >
          AI 处理
        </Button>

        <div className="my-0.5 border-t border-[var(--border)]" />

        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-1.5 px-1 py-1 text-[11.5px] text-[var(--danger)] opacity-80 transition-colors duration-100 hover:opacity-100"
            title={`把 ${selection.length} 个素材移入回收站`}
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" size={12} />
            删除
          </button>
          <button
            aria-label="取消选择"
            className="flex items-center gap-1.5 px-1 py-1 text-[11.5px] text-[var(--text-dim)] transition-colors duration-100 hover:text-[var(--text-main)]"
            onClick={() => useLibraryStore.getState().setSelection([])}
          >
            <Icon name="close" size={12} />
            取消选择
          </button>
        </div>
        {dialogs}
      </div>
    )
  }

  return (
    <>
      {tagOpen || folderOpen ? (
        <div className="fixed inset-0 z-[89]" onClick={closePopovers} aria-hidden="true" />
      ) : null}
      <span className="mono shrink-0 px-1 text-[11px] text-[var(--accent-text)]">
        已选 {selection.length} 项
      </span>

      <div className="relative">
        <Button
          icon={<Icon name="tag" size={12} />}
          aria-label="为所选素材添加标签"
          aria-expanded={tagOpen}
          className={tagOpen ? 'text-[var(--accent-text)]' : ''}
          onClick={() => {
            setFolderOpen(false)
            setTagOpen((v) => !v)
          }}
        >
          标签
        </Button>
        {tagOpen && (
          <div className="menu absolute bottom-full left-0 z-[91] mb-2 w-64 p-3">{tagPanel}</div>
        )}
      </div>

      <div className="relative">
        <Button
          icon={<Icon name="folder" size={12} />}
          aria-label="把所选素材移入文件夹"
          aria-expanded={folderOpen}
          disabled={flatFolders.length === 0}
          className={folderOpen ? 'text-[var(--accent-text)]' : ''}
          onClick={() => {
            setTagOpen(false)
            setFolderOpen((v) => !v)
          }}
        >
          文件夹
        </Button>
        {folderOpen && (
          <div className="menu modal-scroll absolute bottom-full left-0 z-[91] mb-2 max-h-64 w-60 overflow-y-auto p-1.5">
            {folderList}
          </div>
        )}
      </div>

      <Button icon={<Icon name="shapes" size={12} />} onClick={() => void sendToBoard()}>
        发送白板
      </Button>
      <Button icon={<Icon name="import" size={12} />} onClick={() => setExportOpen(true)}>
        导出
      </Button>
      <Button
        icon={<Icon name="sparkles" size={12} />}
        onClick={() => useLibraryStore.getState().openAiDialog()}
      >
        AI 处理
      </Button>
      <Button
        variant="quiet"
        icon={<Icon name="trash" size={12} />}
        className="text-[var(--danger)] hover:text-[var(--danger)]"
        onClick={() => setConfirmDelete(true)}
      >
        删除
      </Button>
      <Button
        variant="quiet"
        className="ml-auto"
        icon={<Icon name="close" size={12} />}
        aria-label="取消选择"
        onClick={() => useLibraryStore.getState().setSelection([])}
      >
        取消选择
      </Button>
      {dialogs}
    </>
  )
}
