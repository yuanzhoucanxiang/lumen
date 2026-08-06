import { useEffect, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import Icon from './Icon'
import type { AiProcessItem, AiProcessOptions, AiProcessResult, AiScope } from '@shared/types'

type Phase = 'config' | 'processing' | 'result'

interface ScopeOption {
  key: AiScope['type']
  label: string
  hint: string
}

const SCOPE_OPTIONS: ScopeOption[] = [
  { key: 'selection', label: '选中的素材', hint: '当前多选中的素材' },
  { key: 'all', label: '全部素材', hint: '库内所有素材' },
  { key: 'untagged', label: '无标签素材', hint: '没有打任何标签的素材' },
  { key: 'unnamed', label: '未命名素材', hint: '文件名是相机默认名/日期串等' }
]

/** AI 智能处理对话框：配置 -> 进度 -> 结果(可撤销) 三态 */
export default function AiDialog({
  selectionIds,
  onClose
}: {
  selectionIds: string[]
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('config')
  const [scopeType, setScopeType] = useState<AiScope['type']>('selection')
  const [doRename, setDoRename] = useState(true)
  const [doTag, setDoTag] = useState(true)
  const [maxTags, setMaxTags] = useState(5)
  const [count, setCount] = useState(selectionIds.length)
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null)
  const [result, setResult] = useState<AiProcessResult | null>(null)
  const [revertIds, setRevertIds] = useState<Set<string>>(new Set())

  // 范围切换时统计候选数
  useEffect(() => {
    if (phase !== 'config') return
    const scope: AiScope =
      scopeType === 'selection' ? { type: 'selection', ids: selectionIds } : { type: scopeType }
    void window.api.aiCountCandidates(scope).then((n) => setCount(n))
  }, [scopeType, selectionIds, phase])

  // 处理进度推送(挂载时注册一次)
  useEffect(() => {
    window.api.onAiProgress((p) => {
      setProgress(p)
    })
  }, [])

  const start = async () => {
    setPhase('processing')
    setProgress({ done: 0, total: count, failed: 0 })
    try {
      const scope: AiScope =
        scopeType === 'selection' ? { type: 'selection', ids: selectionIds } : { type: scopeType }
      // 通过主进程拿候选 ids(scope 展开,未命名判定与 count 一致)
      const ids = await window.api.aiResolveScope(scope)
      const options: AiProcessOptions = {
        rename: doRename,
        tag: doTag,
        maxTags,
        tagGroupName: 'AI 标签'
      }
      const r = await window.api.aiProcess(ids, options)
      setResult(r)
      setPhase('result')
    } catch (e) {
      useLibraryStore.getState().showToast(`AI 处理失败：${(e as Error).message}`)
      onClose()
    }
  }

  // 撤销单条:恢复旧名 + 移除新增标签(用 setAssetTags 替换回处理前标签)
  const revertOne = async (item: AiProcessItem) => {
    if (item.oldName !== item.newName) {
      await window.api.updateAsset(item.id, { name: item.oldName })
    }
    if (item.addedTags.length > 0) {
      // 读取当前标签,移除 AI 新增的
      const cur = await window.api.queryAssets({ limit: 1 })
      const asset = (await window.api.queryAssets({ limit: 100000 })).find((a) => a.id === item.id)
      if (asset) {
        const remaining = asset.tagNames.filter((t) => !item.addedTags.includes(t))
        await window.api.setAssetTags(item.id, remaining)
      }
      void cur
    }
    // 更新本地结果状态
    setResult((prev) => {
      if (!prev || !prev.items) return prev
      return { ...prev, items: prev.items.filter((it) => it.id !== item.id) }
    })
  }

  const revertSelected = async () => {
    if (!result?.items) return
    const selected = result.items.filter((it) => revertIds.has(it.id))
    for (const it of selected) await revertOne(it)
    setRevertIds(new Set())
    await useLibraryStore.getState().refreshAll()
    useLibraryStore.getState().showToast(`已撤销 ${selected.length} 个素材的 AI 处理`)
  }

  const finish = async () => {
    await useLibraryStore.getState().refreshAll()
    onClose()
  }

  const scopeCount = (key: AiScope['type']): string => {
    if (key === 'selection') return `${selectionIds.length} 个`
    return count + ' 个'
  }

  return (
    <div
      className="anim-overlay overlay fixed inset-0 z-[400] flex items-center justify-center"
      onClick={phase === 'processing' ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI 智能处理"
        className="anim-dialog dialog flex h-[70vh] w-[640px] flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Icon name="sparkles" size={15} />
            AI 智能处理
          </h2>
          <button
            aria-label="关闭"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        {/* ===== 配置阶段 ===== */}
        {phase === 'config' && (
          <div className="modal-scroll min-h-0 flex-1 space-y-5 overflow-y-auto">
            {/* 处理范围 */}
            <div>
              <div className="section-title mb-2">处理范围</div>
              <div className="space-y-1.5">
                {SCOPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    role="radio"
                    aria-checked={scopeType === opt.key}
                    className={`flex w-full items-center justify-between rounded-sm border px-3 py-2 text-left text-[12px] transition-colors duration-100 ${
                      scopeType === opt.key
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
                    }`}
                    onClick={() => setScopeType(opt.key)}
                  >
                    <span>
                      <span className="font-medium">{opt.label}</span>
                      <span className="ml-2 text-[11px] text-[var(--text-dim)]">{opt.hint}</span>
                    </span>
                    <span className="mono tnum text-[11px] text-[var(--text-faint)]">
                      {scopeType === opt.key ? scopeCount(opt.key) : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 处理内容 */}
            <div>
              <div className="section-title mb-2">处理内容</div>
              <div className="flex gap-2">
                <button
                  role="checkbox"
                  aria-checked={doRename}
                  className={`flex-1 rounded-sm border px-3 py-2 text-left text-[12px] transition-colors duration-100 ${
                    doRename
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
                  }`}
                  onClick={() => setDoRename(!doRename)}
                >
                  <div className="font-medium">AI 改名</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">生成描述性文件名</div>
                </button>
                <button
                  role="checkbox"
                  aria-checked={doTag}
                  className={`flex-1 rounded-sm border px-3 py-2 text-left text-[12px] transition-colors duration-100 ${
                    doTag
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
                  }`}
                  onClick={() => setDoTag(!doTag)}
                >
                  <div className="font-medium">AI 打标签</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">追加到「AI 标签」分组</div>
                </button>
              </div>
            </div>

            {/* 标签数量 */}
            <div>
              <div className="section-title mb-2">每张最多标签数</div>
              <div className="flex gap-1.5">
                {[3, 5, 8].map((n) => (
                  <button
                    key={n}
                    aria-pressed={maxTags === n}
                    className={`rounded-sm border px-3 py-1.5 text-[12px] transition-colors duration-100 ${
                      maxTags === n
                        ? 'border-[var(--accent-deep)] bg-[var(--accent)] font-medium text-[var(--on-accent)]'
                        : 'border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-dim)] hover:border-[var(--border-strong)] hover:text-[var(--text-main)]'
                    }`}
                    onClick={() => setMaxTags(n)}
                  >
                    {n} 个
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===== 处理阶段 ===== */}
        {phase === 'processing' && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
            <p className="text-[13px] text-[var(--text-dim)]">AI 正在处理素材…</p>
            <p className="mono tnum text-[12px] text-[var(--text-faint)]">
              {progress?.done ?? 0} / {progress?.total ?? 0}
              {progress && progress.failed > 0 && (
                <span className="ml-2 text-red-400">失败 {progress.failed}</span>
              )}
            </p>
            <div className="h-1 w-64 bg-[var(--bg-active)]">
              <div
                className="h-full bg-[var(--accent)] transition-all duration-200"
                style={{
                  width: `${progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`
                }}
              />
            </div>
            <p className="text-[11px] text-[var(--text-faint)]">处理中请勿关闭窗口</p>
          </div>
        )}

        {/* ===== 结果阶段 ===== */}
        {phase === 'result' && result && (
          <>
            <p className="mb-3 text-[12px] text-[var(--text-dim)]">
              已处理 <span className="mono tnum">{result.processed}</span> 个素材
              {result.failed > 0 && <span className="ml-2 text-red-400">失败 {result.failed} 个</span>}
              {result.items && result.items.length > 0 && (
                <span className="ml-2 text-[var(--accent-text)]">
                  新增标签归入「AI 标签」分组
                </span>
              )}
            </p>
            <div className="modal-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {(result.items ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2"
                >
                  <input
                    type="checkbox"
                    checked={revertIds.has(item.id)}
                    onChange={() => {
                      const next = new Set(revertIds)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      setRevertIds(next)
                    }}
                    className="shrink-0"
                  />
                  <img
                    src={`${window.api.thumbnailUrl(item.id)}&e=0`}
                    className="h-10 w-10 shrink-0 rounded-sm object-cover"
                    alt=""
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-[var(--text-faint)] line-through decoration-dotted">
                      {item.oldName}
                    </div>
                    {item.newName !== item.oldName && (
                      <div className="truncate text-[12px] text-[var(--accent-text)]">{item.newName}</div>
                    )}
                    {item.addedTags.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {item.addedTags.map((t) => (
                          <span
                            key={t}
                            className="rounded-sm bg-[var(--bg-hover)] px-1.5 py-px text-[10px] text-[var(--text-dim)]"
                          >
                            +{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {(!result.items || result.items.length === 0) && (
                <p className="py-8 text-center text-[12px] text-[var(--text-faint)]">
                  {result.processed > 0 ? '处理完成，无变化（AI 判断原名/标签已合适）' : '没有可处理的变化'}
                </p>
              )}
            </div>
          </>
        )}

        {/* 底部按钮 */}
        <div className="mt-4 flex justify-end gap-2">
          {phase === 'config' && (
            <>
              <button className="btn-ghost" onClick={onClose}>
                取消
              </button>
              <button className="btn-primary disabled:opacity-40" disabled={count === 0} onClick={() => void start()}>
                开始处理（{count} 个）
              </button>
            </>
          )}
          {phase === 'result' && (
            <>
              <button className="btn-ghost disabled:opacity-40" disabled={revertIds.size === 0} onClick={() => void revertSelected()}>
                撤销所选（{revertIds.size}）
              </button>
              <button className="btn-primary" onClick={() => void finish()}>
                完成
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
