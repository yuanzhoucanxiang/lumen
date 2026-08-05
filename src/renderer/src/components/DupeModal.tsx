import { useEffect, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import type { DupeGroup } from '@shared/types'

function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export default function DupeModal({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<DupeGroup[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.api.findDuplicates().then((gs) => {
      setGroups(gs)
      // 默认勾选每组除第一张之外的所有副本
      const init = new Set<string>()
      for (const g of gs) g.assets.slice(1).forEach((a) => init.add(a.id))
      setChecked(init)
    })
  }, [])

  const toggle = (id: string) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChecked(next)
  }

  const deleteChecked = async () => {
    if (checked.size === 0) return
    await window.api.deleteAssets([...checked], false)
    useLibraryStore.getState().showToast(`已将 ${checked.size} 个重复素材移入回收站`)
    await useLibraryStore.getState().refreshAll()
    // 从组中移除已删项，剩 1 个的组直接消失
    setGroups(
      (groups ?? [])
        .map((g) => ({ ...g, assets: g.assets.filter((a) => !checked.has(a.id)) }))
        .filter((g) => g.assets.length > 1)
    )
    setChecked(new Set())
  }

  return (
    <div
      className="anim-overlay overlay fixed inset-0 z-[400] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="重复素材检测"
        className="anim-dialog dialog flex h-[70vh] w-[720px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">重复素材检测</h2>
          <button
            aria-label="关闭"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        <div className="modal-scroll flex-1 overflow-y-auto p-4">
          {groups === null ? (
            <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
              正在扫描素材库指纹（首次扫描可能需要一点时间）…
            </div>
          ) : groups.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--text-dim)]">
              <Icon name="checkCircle" size={40} strokeWidth={1.4} className="text-[var(--accent)]" />
              未发现重复素材
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.hash} className="rounded-sm border border-[var(--border)] bg-[var(--bg-base)] p-3.5">
                  <p className="mb-2.5 text-[12px] text-[var(--text-dim)]">
                    相似组（<span className="tnum">{g.assets.length}</span> 张）· 默认保留最早导入的一张
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {g.assets.map((a, i) => (
                      <label
                        key={a.id}
                        className={`relative w-28 cursor-pointer rounded-lg border-2 p-1 transition-colors duration-100 ${
                          checked.has(a.id)
                            ? 'border-[var(--danger)] bg-[var(--danger-soft)]'
                            : 'border-transparent hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="absolute left-2 top-2 z-10"
                          checked={checked.has(a.id)}
                          onChange={() => toggle(a.id)}
                        />
                        <img
                          src={`${window.api.thumbnailUrl(a.id)}&e=0`}
                          className="h-20 w-full rounded-md object-cover"
                          alt={a.name}
                        />
                        <div className="mt-1 truncate text-[10px] text-[var(--text-dim)]" title={a.name}>
                          {i === 0 ? '★ ' : ''}
                          {a.name}
                        </div>
                        <div className="tnum text-[10px] text-[var(--text-faint)]">{fmtSize(a.size)}</div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3.5">
          <span className="tnum text-[12px] text-[var(--text-dim)]">
            {groups !== null && `共 ${groups.length} 组重复`}
            {checked.size > 0 && ` · 已选 ${checked.size} 个待删除`}
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn-danger-solid disabled:opacity-40"
              disabled={checked.size === 0}
              onClick={() => void deleteChecked()}
            >
              删除所选（{checked.size}）
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
