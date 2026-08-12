import { useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import type { ExportNaming, ExportOptions } from '@shared/types'

const NAMING_OPTIONS: { key: ExportNaming; label: string; hint: string }[] = [
  { key: 'original', label: '保留原名', hint: '重名自动加 (1)' },
  { key: 'tag_name', label: '标签_原名', hint: '如 暗黑氛围_IMG001.jpg' },
  { key: 'tag_index', label: '标签_序号', hint: '如 暗黑氛围_001.jpg' },
  { key: 'name_index', label: '原名_序号', hint: '如 IMG001_001.jpg' }
]

/** 导出对话框：命名模板 + 按标签分文件夹 + 文件夹/ZIP 选择 */
export default function ExportDialog({
  ids,
  onClose
}: {
  ids: string[]
  onClose: () => void
}) {
  const [naming, setNaming] = useState<ExportNaming>('original')
  const [groupByTag, setGroupByTag] = useState(false)
  const [mode, setMode] = useState<'folder' | 'zip'>('folder')
  const [exporting, setExporting] = useState(false)

  const doExport = async () => {
    if (ids.length === 0 || exporting) return
    setExporting(true)
    try {
      const opts: ExportOptions = { naming, groupByTag }
      const r = await window.api.exportAssets(ids, mode, opts)
      if (r) {
        useLibraryStore
          .getState()
          .showToast(mode === 'folder' ? `已导出 ${r.exported} 个文件` : `已打包 ${r.exported} 个素材为 ZIP`)
        onClose()
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="anim-overlay overlay fixed inset-0 z-[400] flex items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="导出素材"
        className="anim-dialog dialog w-[440px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Icon name="import" size={15} />
            导出素材
            <span className="mono text-[11px] text-[var(--text-faint)]">{ids.length} 个</span>
          </h2>
          <button
            aria-label="关闭"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        {/* 导出方式 */}
        <div className="mb-4">
          <div className="section-title mb-2">导出方式</div>
          <div className="flex gap-2" role="radiogroup" aria-label="导出方式">
            {(
              [
                { key: 'folder', label: '导出到文件夹', hint: '保持为文件' },
                { key: 'zip', label: '打包为 ZIP', hint: '含 metadata.json' }
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                role="radio"
                aria-checked={mode === m.key}
                className={`flex-1 rounded-sm border px-3 py-2 text-left text-[12px] transition-colors duration-100 ${
                  mode === m.key
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
                }`}
                onClick={() => setMode(m.key)}
              >
                <div className="font-medium">{m.label}</div>
                <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">{m.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 命名模板 */}
        <div className="mb-4">
          <div className="section-title mb-2">命名方式</div>
          <div className="space-y-1.5">
            {NAMING_OPTIONS.map((o) => (
              <button
                key={o.key}
                role="radio"
                aria-checked={naming === o.key}
                className={`flex w-full items-center justify-between rounded-sm border px-3 py-1.5 text-left text-[12px] transition-colors duration-100 ${
                  naming === o.key
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
                }`}
                onClick={() => setNaming(o.key)}
              >
                <span className="font-medium">{o.label}</span>
                <span className="text-[11px] text-[var(--text-dim)]">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 按标签分文件夹 */}
        <button
          role="checkbox"
          aria-checked={groupByTag}
          className="flex w-full items-center gap-2 rounded-sm border border-[var(--border)] px-3 py-2 text-left text-[12px] transition-colors duration-100 hover:bg-[var(--bg-hover)]"
          onClick={() => setGroupByTag(!groupByTag)}
        >
          <Icon name="check" size={13} className={groupByTag ? 'text-[var(--accent)]' : 'text-transparent'} />
          <span>
            <span className="font-medium">按标签分文件夹</span>
            <span className="ml-2 text-[11px] text-[var(--text-dim)]">按第一个标签归入子文件夹，无标签归入「未分类」</span>
          </span>
        </button>

        {/* 底部 */}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary disabled:opacity-40" disabled={exporting} onClick={() => void doExport()}>
            {exporting ? '导出中…' : '导出'}
          </button>
        </div>
      </div>
    </div>
  )
}
