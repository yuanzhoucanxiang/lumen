import { useMemo, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import ConfirmDialog from './ConfirmDialog'

type PendingAction = { type: 'merge' } | { type: 'move' } | null

/**
 * 标签管理对话框：多选批量操作（合并/移组/优先/删除）+ 行内重命名。
 * 用于快速收拾标签库（历史同义标签合并、批量归组等）。
 */
export default function TagManagerDialog({ onClose }: { onClose: () => void }) {
  const tags = useLibraryStore((s) => s.tags)
  const tagGroups = useLibraryStore((s) => s.tagGroups)
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pending, setPending] = useState<PendingAction>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  const groupNameOf = (groupId: number | null): string =>
    groupId == null ? '未分组' : (tagGroups.find((g) => g.id === groupId)?.name ?? '未知分组')

  // 按分组聚合（空分组也显示），组内 count 降序
  const { grouped, ungrouped } = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const filtered = tags.filter((t) => (kw ? t.name.toLowerCase().includes(kw) : true))
    const byCount = (a: typeof tags[number], b: typeof tags[number]) =>
      b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')
    const byGroup = new Map<number, typeof tags>()
    const un: typeof tags = []
    for (const t of filtered) {
      if (t.groupId != null) {
        const list = byGroup.get(t.groupId) ?? []
        list.push(t)
        byGroup.set(t.groupId, list)
      } else {
        un.push(t)
      }
    }
    return {
      grouped: tagGroups.map((g) => ({ group: g, tags: (byGroup.get(g.id) ?? []).sort(byCount) })),
      ungrouped: un.sort(byCount)
    }
  }, [tags, tagGroups, keyword])

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 操作后统一刷新 */
  const afterMutate = async () => {
    await useLibraryStore.getState().refreshTags()
    await useLibraryStore.getState().refreshTagGroups()
    await useLibraryStore.getState().refreshAssets()
    setSelected(new Set())
  }

  /** 批量合并:所选标签逐个并入目标标签 */
  const doMerge = async (targetId: number) => {
    const ids = [...selected]
    for (const id of ids) {
      if (id !== targetId) await window.api.mergeTags(id, targetId)
    }
    await afterMutate()
    setPending(null)
    useLibraryStore.getState().showToast(`已合并 ${ids.length - (selected.has(targetId) ? 1 : 0)} 个标签`)
  }

  /** 批量移组 */
  const doMove = async (groupId: number | null) => {
    for (const id of selected) {
      await window.api.assignTagToGroup(id, groupId)
    }
    await afterMutate()
    setPending(null)
    useLibraryStore.getState().showToast(`已移动 ${selected.size} 个标签到「${groupNameOf(groupId)}」`)
  }

  /** 批量切换优先(全设为 1,若已全优先则取消) */
  const doPriority = async () => {
    const ids = [...selected]
    const allPriority = ids.every((id) => tags.find((t) => t.id === id)?.priority === 1)
    const target = allPriority ? 0 : 1
    for (const id of ids) {
      await window.api.setTagPriority(id, target)
    }
    await afterMutate()
    useLibraryStore.getState().showToast(target === 1 ? `已设为优先 ${ids.length} 个标签` : `已取消优先 ${ids.length} 个标签`)
  }

  /** 批量删除 */
  const doDelete = async () => {
    const ids = [...selected]
    for (const id of ids) {
      await window.api.deleteTag(id)
    }
    await afterMutate()
    setConfirmDel(false)
    useLibraryStore.getState().showToast(`已删除 ${ids.length} 个标签`)
  }

  /** 行内重命名提交 */
  const submitRename = async () => {
    if (renamingId == null) return
    const name = renameVal.trim()
    if (name) await window.api.renameTag(renamingId, name)
    setRenamingId(null)
    await useLibraryStore.getState().refreshTags()
  }

  /** 单行 ⭐ 切换优先 */
  const togglePriority = async (id: number) => {
    const t = tags.find((x) => x.id === id)
    await window.api.setTagPriority(id, t?.priority === 1 ? 0 : 1)
    await useLibraryStore.getState().refreshTags()
  }

  const renderRow = (t: (typeof tags)[number]) => (
    <div
      key={t.id}
      className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 text-[12px] transition-colors duration-100 ${
        selected.has(t.id)
          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
          : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      <input
        type="checkbox"
        checked={selected.has(t.id)}
        onChange={() => toggle(t.id)}
        className="shrink-0"
        aria-label={`选择标签 ${t.name}`}
      />
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: t.color || 'transparent', border: t.color ? 'none' : '1px solid var(--border-strong)' }}
      />
      {renamingId === t.id ? (
        <input
          autoFocus
          aria-label="重命名标签"
          className="field-input min-w-0 flex-1 px-1 py-0 text-[12px]"
          value={renameVal}
          onChange={(e) => setRenameVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitRename()
            if (e.key === 'Escape') setRenamingId(null)
          }}
          onBlur={() => void submitRename()}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{t.name}</span>
      )}
      <button
        aria-label={t.priority === 1 ? '取消优先' : '设为优先标签'}
        title={t.priority === 1 ? '取消优先' : '设为优先标签'}
        className={`text-[11px] transition-opacity duration-100 hover:opacity-60 ${t.priority === 1 ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}
        onClick={() => void togglePriority(t.id)}
      >
        ⭐
      </button>
      <button
        aria-label={`重命名标签 ${t.name}`}
        className="text-[var(--text-faint)] transition-colors duration-100 hover:text-[var(--accent-text)]"
        onClick={() => {
          setRenamingId(t.id)
          setRenameVal(t.name)
        }}
      >
        <Icon name="pencil" size={11} />
      </button>
      <span className="w-10 text-right text-[10px] text-[var(--text-faint)] tnum mono">{t.count}</span>
      <span className="w-16 truncate text-right text-[10px] text-[var(--text-faint)]">{groupNameOf(t.groupId)}</span>
    </div>
  )

  // 合并目标候选:排除所选
  const mergeCandidates = tags
    .filter((t) => !selected.has(t.id))
    .sort((a, b) => b.priority - a.priority || b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))

  return (
    <div className="anim-overlay overlay fixed inset-0 z-[400] flex items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="标签管理"
        className="anim-dialog dialog flex h-[70vh] w-[560px] flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Icon name="tag" size={15} />
            标签管理
            <span className="mono text-[11px] text-[var(--text-faint)]">{tags.length} 个标签</span>
          </h2>
          <button
            aria-label="关闭"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        {/* 搜索 */}
        <input
          type="text"
          aria-label="搜索标签"
          placeholder="搜索标签…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="field-input mb-2 w-full px-2 py-1.5 text-[12px]"
        />

        {/* 列表 */}
        <div className="modal-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {/* 合并目标选择(内层) */}
          {pending?.type === 'merge' && (
            <div className="mb-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] text-[var(--accent-text)]">选择合并目标标签：</span>
                <button className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-main)]" onClick={() => setPending(null)}>
                  取消
                </button>
              </div>
              <div className="max-h-40 space-y-0.5 overflow-y-auto">
                {mergeCandidates.map((t) => (
                  <button
                    key={t.id}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                    onClick={() => void doMerge(t.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {t.priority === 1 && <span className="text-[10px] text-[var(--accent)]">⭐</span>}
                    <span className="mono text-[10px] text-[var(--text-faint)]">{t.count}</span>
                  </button>
                ))}
                {mergeCandidates.length === 0 && (
                  <p className="py-2 text-center text-[11px] text-[var(--text-faint)]">没有可合并的目标</p>
                )}
              </div>
            </div>
          )}
          {/* 移组目标选择(内层) */}
          {pending?.type === 'move' && (
            <div className="mb-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] text-[var(--accent-text)]">选择目标分组：</span>
                <button className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-main)]" onClick={() => setPending(null)}>
                  取消
                </button>
              </div>
              <div className="space-y-0.5">
                <button
                  className="block w-full rounded-sm px-2 py-1 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                  onClick={() => void doMove(null)}
                >
                  未分组
                </button>
                {tagGroups.map((g) => (
                  <button
                    key={g.id}
                    className="block w-full rounded-sm px-2 py-1 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                    onClick={() => void doMove(g.id)}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 分组内标签 */}
          {grouped.map(({ group, tags: gtags }) => (
            <div key={group.id}>
              <div className="mb-0.5 flex items-center justify-between px-1">
                <span className="section-title">{group.name}</span>
                <span className="mono text-[10px] text-[var(--text-faint)]">{gtags.length}</span>
              </div>
              <div className="space-y-0.5">{gtags.map(renderRow)}</div>
            </div>
          ))}
          {/* 未分组 */}
          {ungrouped.length > 0 && (
            <div>
              <div className="mb-0.5 px-1">
                <span className="section-title">未分组</span>
              </div>
              <div className="space-y-0.5">{ungrouped.map(renderRow)}</div>
            </div>
          )}
          {grouped.length === 0 && ungrouped.length === 0 && (
            <p className="py-8 text-center text-[12px] text-[var(--text-faint)]">没有匹配的标签</p>
          )}
        </div>

        {/* 批量操作栏 */}
        <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
          <span className="mono text-[11px] text-[var(--text-faint)]">已选 {selected.size}</span>
          {selected.size > 0 && (
            <>
              <button
                className="btn-ghost disabled:opacity-40"
                disabled={selected.size >= tags.length}
                onClick={() => setPending({ type: 'merge' })}
              >
                合并所选
              </button>
              <button className="btn-ghost" onClick={() => setPending({ type: 'move' })}>
                移到分组
              </button>
              <button className="btn-ghost" onClick={() => void doPriority()}>
                {selected.size > 0 &&
                [...selected].every((id) => tags.find((t) => t.id === id)?.priority === 1)
                  ? '取消优先'
                  : '设为优先'}
              </button>
              <button className="btn-ghost text-[var(--danger)]" onClick={() => setConfirmDel(true)}>
                删除
              </button>
            </>
          )}
          <button className="btn-primary ml-auto" onClick={onClose}>
            完成
          </button>
        </div>
      </div>

      {confirmDel && (
        <ConfirmDialog
          title={`删除 ${selected.size} 个标签？`}
          message="标签将从所有素材上移除（素材本身不受影响）。此操作无法撤销。"
          confirmLabel="删除标签"
          onConfirm={() => void doDelete()}
          onClose={() => setConfirmDel(false)}
        />
      )}
    </div>
  )
}
