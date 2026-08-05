import { useEffect, useMemo, useState } from 'react'
import { assetThumbUrl, useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export default function Inspector() {
  const assets = useLibraryStore((s) => s.assets)
  const selection = useLibraryStore((s) => s.selection)
  const tags = useLibraryStore((s) => s.tags)
  const asset = useMemo(
    () => (selection.length === 1 ? assets.find((a) => a.id === selection[0]) : null),
    [selection, assets]
  )

  const [tagInput, setTagInput] = useState('')
  const [comment, setComment] = useState('')
  const [batchTag, setBatchTag] = useState('')

  /** 批量打标签：追加到所有选中素材 */
  const applyBatchTag = async () => {
    const name = batchTag.trim()
    if (!name || selection.length === 0) return
    await window.api.addTagToAssets(selection, name)
    useLibraryStore.getState().showToast(`已为 ${selection.length} 个素材添加标签「${name}」`)
    setBatchTag('')
    await useLibraryStore.getState().refreshAssets()
    await useLibraryStore.getState().refreshTags()
  }

  /** 批量评分：统一设置所有选中素材的星级 */
  const applyBatchStar = async (star: number) => {
    if (selection.length === 0) return
    await Promise.all(selection.map((id) => window.api.updateAsset(id, { star })))
    useLibraryStore.getState().showToast(`已将 ${selection.length} 个素材评为 ${star} 星`)
    await useLibraryStore.getState().refreshAssets()
  }

  useEffect(() => {
    setComment(asset?.comment ?? '')
    setTagInput('')
  }, [asset?.id, asset?.comment])

  const colors = useMemo<number[][]>(() => {
    if (!asset) return []
    try {
      return JSON.parse(asset.colors)
    } catch {
      return []
    }
  }, [asset?.colors])

  const saveTags = async (names: string[]) => {
    if (!asset) return
    await window.api.setAssetTags(asset.id, names)
    await useLibraryStore.getState().refreshAssets()
    await useLibraryStore.getState().refreshTags()
  }

  const addTag = async () => {
    const name = tagInput.trim()
    if (!name || !asset) return
    if (!asset.tagNames.includes(name)) {
      await saveTags([...asset.tagNames, name])
    }
    setTagInput('')
  }

  return (
    <aside
      aria-label="素材详情"
      className="flex w-64 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]"
    >
      {!asset ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-4 text-center text-[12px] text-[var(--text-dim)]">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center border border-dashed border-[var(--border-strong)] text-[var(--text-faint)]"
          >
            <Icon name="eye" size={22} strokeWidth={1.4} />
          </span>
          {selection.length > 1 ? (
            <div className="w-full">
              <p className="mono text-[11px] tracking-[0.08em]">已选择 {selection.length} 个素材</p>
              {/* 批量评分 */}
              <div className="mt-3 text-left">
                <div className="section-title mb-1.5">批量评分</div>
                <div className="flex gap-1" role="group" aria-label="批量评分">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      aria-label={`全部评为 ${n} 星`}
                      className="text-lg text-[var(--text-faint)] transition-all duration-100 hover:scale-125 hover:text-[var(--amber)]"
                      onClick={() => void applyBatchStar(n)}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
              {/* 批量打标签 */}
              <div className="mt-4 text-left">
                <label htmlFor="batch-tag" className="section-title mb-1.5 block">
                  批量添加标签
                </label>
                <input
                  id="batch-tag"
                  className="field-input w-full"
                  placeholder={`为 ${selection.length} 个素材加标签，回车确认`}
                  value={batchTag}
                  list="tag-suggestions"
                  onChange={(e) => setBatchTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void applyBatchTag()
                  }}
                />
                <datalist id="tag-suggestions">
                  {tags.map((t) => (
                    <option key={t.id} value={t.name} />
                  ))}
                </datalist>
                <button
                  className="btn-primary mt-2 w-full disabled:opacity-40"
                  disabled={!batchTag.trim()}
                  onClick={() => void applyBatchTag()}
                >
                  应用到 {selection.length} 个素材
                </button>
              </div>
            </div>
          ) : (
            '选择一个素材查看详情'
          )}
        </div>
      ) : (
        <div className="modal-scroll flex-1 overflow-y-auto p-3.5">
          {/* 预览 */}
          <div className="mb-3 flex h-44 items-center justify-center border border-[var(--border)] bg-[#0d0f12] p-1.5">
            {assetThumbUrl(asset) ? (
              <img
                src={assetThumbUrl(asset)}
                className="max-h-full max-w-full object-contain"
                alt={asset.name}
              />
            ) : (
              <Icon name="file" size={34} strokeWidth={1.3} className="text-[var(--text-faint)]" />
            )}
          </div>

          {/* 名称 */}
          <label htmlFor="asset-name" className="sr-only">
            素材名称
          </label>
          <input
            id="asset-name"
            className="mb-2 w-full border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium transition-colors duration-100 hover:border-[var(--border)] focus:border-[var(--accent)] focus:bg-[rgba(0,0,0,0.25)] focus:outline-none"
            defaultValue={asset.name}
            key={`name-${asset.id}`}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== asset.name) {
                void window.api.updateAsset(asset.id, { name: e.target.value })
                useLibraryStore.getState().updateAssetLocal(asset.id, { name: e.target.value })
              }
            }}
          />

          {/* 星级 */}
          <div className="mb-4 flex gap-1" role="group" aria-label="评分">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-label={`评分 ${n} 星`}
                aria-pressed={n <= asset.star}
                className={`text-base transition-all duration-100 hover:scale-110 ${
                  n <= asset.star ? 'text-[var(--amber)]' : 'text-white/15 hover:text-white/50'
                }`}
                onClick={async () => {
                  const star = n === asset.star ? 0 : n
                  await window.api.updateAsset(asset.id, { star })
                  useLibraryStore.getState().updateAssetLocal(asset.id, { star })
                }}
              >
                ★
              </button>
            ))}
          </div>

          {/* 标签 */}
          <div className="mb-4">
            <div className="section-title mb-1.5">标签</div>
            <div className="flex flex-wrap gap-1.5">
              {asset.tagNames.map((t) => {
                const color = tags.find((x) => x.name === t)?.color
                return (
                  <span
                    key={t}
                    className="flex items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--bg-hover)] px-2 py-0.5 text-[11px]"
                  >
                    {color && (
                      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: color }} />
                    )}
                    {t}
                    <button
                      aria-label={`删除标签 ${t}`}
                      className="flex items-center text-[var(--text-faint)] transition-colors duration-100 hover:text-[var(--danger)]"
                      onClick={() => void saveTags(asset.tagNames.filter((x) => x !== t))}
                    >
                      <Icon name="close" size={10} strokeWidth={2.2} />
                    </button>
                  </span>
                )
              })}
              <label htmlFor="tag-input" className="sr-only">
                添加标签
              </label>
              <input
                id="tag-input"
                className="w-20 border border-dashed border-[var(--border-strong)] bg-transparent px-2 py-0.5 text-[11px] outline-none transition-colors duration-100 placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]"
                placeholder="+ 添加…"
                value={tagInput}
                list="tag-suggestions"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addTag()
                }}
              />
              <datalist id="tag-suggestions">
                {tags.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
            </div>
          </div>

          {/* 注释 */}
          <div className="mb-4">
            <label htmlFor="asset-comment" className="section-title mb-1.5 block">
              注释
            </label>
            <textarea
              id="asset-comment"
              className="field-input h-16 w-full resize-none text-[12px]"
              placeholder="添加注释…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onBlur={() => {
                if (comment !== asset.comment) {
                  void window.api.updateAsset(asset.id, { comment })
                  useLibraryStore.getState().updateAssetLocal(asset.id, { comment })
                }
              }}
            />
          </div>

          {/* 色板 */}
          {colors.length > 0 && (
            <div className="mb-4">
              <div className="section-title mb-1.5">主色调</div>
              <div className="flex border border-[var(--border)]">
                {colors.map((c, i) => (
                  <div
                    key={i}
                    className="h-6 flex-1"
                    style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}
                    title={`rgb(${c[0]},${c[1]},${c[2]})`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 信息 */}
          <div className="section-title mb-1.5">信息</div>
          <dl className="space-y-1.5 text-[11px] text-[var(--text-dim)]">
            <div className="flex justify-between">
              <dt>格式</dt>
              <dd className="mono uppercase">{asset.ext}</dd>
            </div>
            <div className="flex justify-between">
              <dt>大小</dt>
              <dd className="tnum mono">{fmtSize(asset.size)}</dd>
            </div>
            {asset.width > 0 && (
              <div className="flex justify-between">
                <dt>尺寸</dt>
                <dd className="tnum mono">
                  {asset.width} × {asset.height}
                </dd>
              </div>
            )}
            {(() => {
              const exif = asset.exif ? JSON.parse(asset.exif) : null
              if (!exif) return null
              const items: { label: string; value: string }[] = []
              if (exif.make || exif.model) {
                items.push({ label: '相机', value: [exif.make, exif.model].filter(Boolean).join(' ') })
              }
              if (exif.dateTime) items.push({ label: '拍摄时间', value: exif.dateTime })
              if (exif.fNumber) items.push({ label: '光圈', value: `f/${exif.fNumber.toFixed(1)}` })
              if (exif.exposureTime) {
                items.push({
                  label: '快门',
                  value: exif.exposureTime < 1 ? `1/${Math.round(1 / exif.exposureTime)}s` : `${exif.exposureTime}s`
                })
              }
              if (exif.iso) items.push({ label: 'ISO', value: String(exif.iso) })
              if (exif.focalLength) items.push({ label: '焦距', value: `${exif.focalLength}mm` })
              return items.map((it) => (
                <div key={it.label} className="flex justify-between">
                  <dt>{it.label}</dt>
                  <dd className="mono truncate" title={it.value}>{it.value}</dd>
                </div>
              ))
            })()}
            <div className="flex justify-between">
              <dt>导入时间</dt>
              <dd className="tnum mono">
                {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(asset.importedAt)}
              </dd>
            </div>
            {asset.url && (
              <div className="pt-1">
                <dt className="mb-0.5">来源</dt>
                <dd>
                  <button
                    className="flex max-w-full items-center gap-1 truncate text-left text-[var(--accent-text)] underline decoration-dotted underline-offset-2 transition-colors duration-100 hover:text-[var(--text-main)]"
                    title={asset.url}
                    onClick={() => void window.api.openExternal(asset.url)}
                  >
                    <span className="truncate">{asset.url}</span>
                    <Icon name="external" size={11} />
                  </button>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </aside>
  )
}
