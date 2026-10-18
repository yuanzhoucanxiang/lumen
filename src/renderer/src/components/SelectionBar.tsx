import { useEffect, useMemo, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import Button from './ui/Button'
import IconButton from './ui/IconButton'
import ExportDialog from './ExportDialog'
import ConfirmDialog from './ConfirmDialog'
import type { Folder } from '@shared/types'

/** 文件夹树 → 扁平列表（带缩进深度），供选区操作条的下拉使用 */
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
 * 选区操作条（里程碑 195）：多选时浮在图库底部，提供加标签/移入文件夹/发送白板/
 * 导出/AI/删除。位置按左右面板实际占用居中，避免被详情栏或助手盖住。
 */
export default function SelectionBar({ leftInset, rightInset }: { leftInset: number; rightInset: number }) {
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
    useLibraryStore.getState().showToast(`已为 ${selection.length} 个素材添加标签「${name}」`)
    setTagInput('')
    setTagOpen(false)
    await useLibraryStore.getState().refreshAssets()
    await useLibraryStore.getState().refreshTags()
  }

  const moveToFolder = async (folder: Folder) => {
    await window.api.addAssetsToFolder([...selection], folder.id)
    useLibraryStore.getState().showToast(`已把 ${selection.length} 个素材移入「${folder.name}」`)
    setFolderOpen(false)
    await useLibraryStore.getState().refreshAssets()
    await useLibraryStore.getState().refreshFolders()
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

  const width = `calc(100vw - ${leftInset}px - ${rightInset}px - 2rem)`
  const left = `calc(${leftInset}px + (100vw - ${leftInset}px - ${rightInset}px) / 2)`

  return (
    <>
      {tagOpen || folderOpen ? (
        <div className="fixed inset-0 z-[89]" onClick={closePopovers} aria-hidden="true" />
      ) : null}
      <div
        role="toolbar"
        aria-label="选区操作"
        data-testid="selection-bar"
        className="anim-dialog menu fixed bottom-5 z-[90] flex flex-wrap items-center gap-1.5 px-2.5 py-1.5"
        style={{ left, transform: 'translateX(-50%)', width, maxWidth: 760 }}
      >
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
            <div className="menu absolute bottom-full left-0 z-[91] mb-2 w-64 p-3">
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
            </div>
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
              {flatFolders.map(({ folder, depth }) => (
                <button
                  key={folder.id}
                  className="block w-full truncate px-2 py-1 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                  style={{ paddingLeft: 8 + depth * 14 }}
                  title={folder.name}
                  onClick={() => void moveToFolder(folder)}
                >
                  {folder.name}
                </button>
              ))}
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
        <IconButton
          label="取消选择"
          size="sm"
          className="ml-auto"
          onClick={() => useLibraryStore.getState().setSelection([])}
        >
          <Icon name="close" size={12} />
        </IconButton>
      </div>

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
}
