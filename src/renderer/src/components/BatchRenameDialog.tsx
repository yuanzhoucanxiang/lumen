import { useMemo, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import type { Asset } from '@shared/types'

/** 清洗模板渲染结果（与主进程 safePathSegment 同口径：非法字符/控制字符/尾点尾空格） */
function cleanStem(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
}

/**
 * 批量重命名（对标 Eagle）：模板占位符 {原名} 原文件名主干、{序号} 两位序号、{日期} 当日 YYYYMMDD。
 * 扩展名自动保留；批量内重名自动加 (2)；渲染结果与原名相同的素材跳过不写库。
 */
export default function BatchRenameDialog({ assets, onClose }: { assets: Asset[]; onClose: () => void }) {
  const [template, setTemplate] = useState('{原名} {序号}')
  const [applying, setApplying] = useState(false)
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const plan = useMemo(() => {
    const used = new Set<string>()
    return assets.map((a, i) => {
      const ext = a.ext ? `.${a.ext}` : ''
      const stem = cleanStem(
        template
          .replaceAll('{原名}', a.name.replace(/\.[^.]+$/, ''))
          .replaceAll('{序号}', String(i + 1).padStart(2, '0'))
          .replaceAll('{日期}', today)
      )
      let final = stem ? `${stem}${ext}` : a.name
      let n = 2
      while (used.has(final.toLowerCase())) final = `${stem} (${n++})${ext}`
      used.add(final.toLowerCase())
      return { asset: a, final, changed: final !== a.name }
    })
  }, [assets, template, today])

  const changedCount = plan.filter((r) => r.changed).length

  const apply = async () => {
    if (applying || changedCount === 0) return
    setApplying(true)
    try {
      for (const r of plan) {
        if (!r.changed) continue
        await window.api.updateAsset(r.asset.id, { name: r.final })
        useLibraryStore.getState().updateAssetLocal(r.asset.id, { name: r.final })
      }
      useLibraryStore.getState().showToast(`已重命名 ${changedCount} 个素材`)
      onClose()
    } finally {
      setApplying(false)
    }
  }

  const preview = plan.slice(0, 6)

  return (
    <div className="anim-overlay overlay fixed inset-0 z-[400] flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="批量重命名"
        className="anim-dialog dialog flex max-h-[calc(100vh-32px)] w-[min(480px,calc(100vw-32px))] flex-col overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 pb-4 pt-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Icon name="type" size={15} />
            批量重命名
            <span className="mono text-[11px] text-[var(--text-faint)]">{assets.length} 个</span>
          </h2>
          <button
            aria-label="关闭"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        <div className="modal-scroll min-h-0 overflow-y-auto px-5 py-4">
          <div className="mb-4">
            <div className="section-title mb-2">命名模板</div>
            <input
              aria-label="重命名模板"
              className="field-input w-full px-2 py-1.5 font-mono text-[12px]"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="{原名} {序号}"
            />
            <div className="mt-1.5 text-[11px] text-[var(--text-faint)]">
              占位符：<code className="mono">{'{原名}'}</code> 原文件名主干、
              <code className="mono">{'{序号}'}</code> 两位序号、<code className="mono">{'{日期}'}</code> 当日日期。扩展名自动保留。
            </div>
          </div>

          <div className="mb-1">
            <div className="section-title mb-2">预览{plan.length > preview.length ? `（前 ${preview.length} 条 / 共 ${plan.length} 条）` : ''}</div>
            <div className="overflow-hidden rounded-sm border border-[var(--border)]">
              {preview.map((r) => (
                <div
                  key={r.asset.id}
                  className="flex items-center gap-2 border-b border-[var(--border)] px-2.5 py-1.5 text-[11px] last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--text-faint)]" title={r.asset.name}>
                    {r.asset.name}
                  </span>
                  <Icon name="arrowRight" size={11} className="shrink-0 text-[var(--text-faint)]" />
                  <span className={`min-w-0 flex-1 truncate ${r.changed ? 'text-[var(--text-main)]' : 'text-[var(--text-faint)]'}`} title={r.final}>
                    {r.final}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <span className="mr-auto text-[11px] text-[var(--text-faint)]">将更新 {changedCount} 个名称</span>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary disabled:opacity-40" disabled={changedCount === 0 || applying} onClick={() => void apply()}>
            {applying ? '应用中…' : '应用'}
          </button>
        </div>
      </div>
    </div>
  )
}
