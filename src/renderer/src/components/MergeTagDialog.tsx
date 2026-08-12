import { useEffect, useMemo, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'

/**
 * 标签合并对话框：把源标签合并到另一个标签（源标签的素材全部打上目标标签，再删除源标签）。
 * 用于清理历史同义标签（如「夜景」+「夜晚场景」并存）。
 */
export default function MergeTagDialog({
  sourceId,
  onClose
}: {
  sourceId: number
  onClose: () => void
}) {
  const tags = useLibraryStore((s) => s.tags)
  const [keyword, setKeyword] = useState('')
  const [targetId, setTargetId] = useState<number | null>(null)

  const source = tags.find((t) => t.id === sourceId)
  const target = tags.find((t) => t.id === targetId)

  // 候选目标：排除源标签，按 count 降序（优先标签靠前），关键词过滤
  const candidates = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return tags
      .filter((t) => t.id !== sourceId)
      .filter((t) => (kw ? t.name.toLowerCase().includes(kw) : true))
      .sort((a, b) => (b.priority - a.priority) || (b.count - a.count) || a.name.localeCompare(b.name, 'zh-CN'))
  }, [tags, sourceId, keyword])

  // 源标签变化时重置选中
  useEffect(() => {
    setTargetId(null)
  }, [sourceId])

  const doMerge = async () => {
    if (!target) return
    await window.api.mergeTags(sourceId, target.id)
    await useLibraryStore.getState().refreshTags()
    useLibraryStore.getState().showToast(`已将「${source?.name ?? ''}」合并到「${target.name}」`)
    onClose()
  }

  return (
    <div className="anim-overlay overlay fixed inset-0 z-[400] flex items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="合并标签"
        className="anim-dialog dialog flex h-[60vh] w-[420px] flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Icon name="tag" size={15} />
            合并标签
          </h2>
          <button
            aria-label="关闭"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        <p className="mb-3 text-[12px] text-[var(--text-dim)]">
          将「<span className="font-medium text-[var(--accent-text)]">{source?.name}</span>」
          <span className="mono tnum">（{source?.count ?? 0} 个素材）</span>合并到目标标签，源标签将被删除。
        </p>

        {/* 搜索框 */}
        <input
          autoFocus
          type="text"
          aria-label="搜索目标标签"
          placeholder="搜索目标标签…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="field-input mb-2 w-full px-2 py-1.5 text-[12px]"
        />

        {/* 目标标签列表 */}
        <div className="modal-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {candidates.map((t) => (
            <button
              key={t.id}
              aria-pressed={targetId === t.id}
              className={`flex w-full items-center gap-2 rounded-sm border px-2.5 py-1.5 text-left text-[12px] transition-colors duration-100 ${
                targetId === t.id
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => setTargetId(t.id)}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color || 'transparent', border: t.color ? 'none' : '1px solid var(--border-strong)' }} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.priority === 1 && <span className="text-[10px] text-[var(--accent)]">⭐</span>}
              <span className="mono tnum text-[10px] text-[var(--text-faint)]">{t.count}</span>
            </button>
          ))}
          {candidates.length === 0 && (
            <p className="py-6 text-center text-[12px] text-[var(--text-faint)]">没有其他标签</p>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary disabled:opacity-40"
            disabled={!target || sourceId === targetId}
            onClick={() => void doMerge()}
          >
            合并到「{target?.name ?? '…'}」
          </button>
        </div>
      </div>
    </div>
  )
}
