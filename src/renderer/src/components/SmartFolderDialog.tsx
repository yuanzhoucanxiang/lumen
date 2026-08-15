import { useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import type { Folder, SmartConditions } from '@shared/types'

const EXT_GROUPS = [
  { label: 'JPG', exts: ['jpg', 'jpeg'] },
  { label: 'PNG', exts: ['png'] },
  { label: 'GIF', exts: ['gif'] },
  { label: 'WebP', exts: ['webp'] },
  { label: 'SVG', exts: ['svg'] },
  { label: 'PSD', exts: ['psd', 'ai'] },
  { label: '视频', exts: ['mp4', 'webm', 'mov', 'mkv', 'avi'] },
  { label: '音频', exts: ['mp3', 'wav', 'ogg', 'flac'] },
  { label: '字体', exts: ['ttf', 'otf', 'ttc', 'woff', 'woff2'] }
]

const QUICK_COLORS = [
  '#e53935', '#ff9800', '#ffeb3b', '#8bc34a', '#4caf50', '#009688',
  '#00bcd4', '#2196f3', '#3f51b5', '#9c27b0', '#e91e63', '#795548'
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="section-title mb-2">{title}</div>
      {children}
    </div>
  )
}

/** 条件选项小方块（未选 / 选中两态） */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-pressed={active}
      className={`rounded-sm border px-2.5 py-1 text-[12px] transition-colors duration-100 ${
        active
          ? 'border-[var(--accent-deep)] bg-[var(--accent)] font-medium text-[var(--on-accent)]'
          : 'border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-dim)] hover:border-[var(--border-strong)] hover:text-[var(--text-main)]'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function SmartFolderDialog({
  editFolder,
  onClose
}: {
  editFolder?: Folder | null
  onClose: () => void
}) {
  const tags = useLibraryStore((s) => s.tags)
  const initial: SmartConditions = editFolder
    ? (() => {
        try {
          return JSON.parse(editFolder.conditions) as SmartConditions
        } catch {
          return {}
        }
      })()
    : {}

  const [name, setName] = useState(editFolder?.name ?? '')
  const [keyword, setKeyword] = useState(initial.keyword ?? '')
  const [tagIds, setTagIds] = useState<number[]>(initial.tagIds ?? [])
  const [exts, setExts] = useState<string[]>(initial.exts ?? [])
  const [starMin, setStarMin] = useState(initial.starMin ?? 0)
  const [color, setColor] = useState<string | undefined>(initial.color)
  const [minW, setMinW] = useState(initial.minW?.toString() ?? '')
  const [maxW, setMaxW] = useState(initial.maxW?.toString() ?? '')
  const [minSizeKB, setMinSizeKB] = useState(initial.minSizeKB?.toString() ?? '')
  const [maxSizeKB, setMaxSizeKB] = useState(initial.maxSizeKB?.toString() ?? '')
  const [withinDays, setWithinDays] = useState(initial.withinDays ?? 0)
  const [untagged, setUntagged] = useState(initial.untagged ?? false)
  const [shape, setShape] = useState(initial.shape ?? '')
  const [colorCountMax, setColorCountMax] = useState(initial.colorCountMax ?? 0)

  const toggleTag = (id: number) =>
    setTagIds(tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id])

  const toggleExts = (group: string[]) => {
    const active = group.every((e) => exts.includes(e))
    setExts(active ? exts.filter((e) => !group.includes(e)) : [...new Set([...exts, ...group])])
  }

  const save = async () => {
    const n = name.trim() || '未命名智能文件夹'
    const conds: SmartConditions = {}
    if (keyword.trim()) conds.keyword = keyword.trim()
    if (tagIds.length > 0) conds.tagIds = tagIds
    if (exts.length > 0) conds.exts = exts
    if (starMin > 0) conds.starMin = starMin
    if (Number(minW) > 0) conds.minW = Number(minW)
    if (Number(maxW) > 0) conds.maxW = Number(maxW)
    if (Number(minSizeKB) > 0) conds.minSizeKB = Number(minSizeKB)
    if (Number(maxSizeKB) > 0) conds.maxSizeKB = Number(maxSizeKB)
    if (withinDays > 0) conds.withinDays = withinDays
    if (untagged) conds.untagged = true
    if (shape) conds.shape = shape as SmartConditions['shape']
    if (colorCountMax > 0) conds.colorCountMax = colorCountMax
    if (color) {
      conds.color = color
      conds.colorTolerance = 45
    }
    if (editFolder) {
      await window.api.updateSmartFolder(editFolder.id, n, JSON.stringify(conds))
    } else {
      await window.api.createFolder(n, null, 1, JSON.stringify(conds))
    }
    await useLibraryStore.getState().refreshFolders()
    await useLibraryStore.getState().refreshAssets()
    onClose()
  }

  return (
    <div
      className="anim-overlay overlay fixed inset-0 z-[400] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editFolder ? '编辑智能文件夹' : '新建智能文件夹'}
        className="anim-dialog dialog flex max-h-[calc(100vh-32px)] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="shrink-0 border-b border-[var(--border)] px-5 pb-4 pt-5 text-[15px] font-semibold">
          {editFolder ? '编辑智能文件夹' : '新建智能文件夹'}
        </h2>

        <div className="modal-scroll min-h-0 overflow-y-auto px-5 py-4">
          <Section title="名称">
            <input
              autoFocus
              aria-label="智能文件夹名称"
              className="field-input w-full"
              placeholder="智能文件夹名称…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Section>

          <Section title="关键词（名称/注释包含）">
            <input
              aria-label="关键词"
              className="field-input w-full"
              placeholder="可选…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Section>

          {tags.length > 0 && (
            <Section title="包含标签（同时满足）">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <Chip key={t.id} active={tagIds.includes(t.id)} onClick={() => toggleTag(t.id)}>
                    {t.name}
                  </Chip>
                ))}
              </div>
            </Section>
          )}

        <Section title="格式">
          <div className="flex flex-wrap gap-1.5">
            {EXT_GROUPS.map((g) => (
              <Chip
                key={g.label}
                active={g.exts.some((e) => exts.includes(e))}
                onClick={() => toggleExts(g.exts)}
              >
                {g.label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="最低星级">
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <Chip key={n} active={starMin === n} onClick={() => setStarMin(n)}>
                {n === 0 ? '不限' : `${n}★+`}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="宽度范围（px）">
          <div className="flex items-center gap-2">
            <input
              aria-label="最小宽度"
              className="field-input w-24"
              placeholder="最小"
              value={minW}
              onChange={(e) => setMinW(e.target.value.replace(/\D/g, ''))}
            />
            <span className="text-[var(--text-dim)]">—</span>
            <input
              aria-label="最大宽度"
              className="field-input w-24"
              placeholder="最大"
              value={maxW}
              onChange={(e) => setMaxW(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        </Section>

        <Section title="文件大小范围（KB）">
          <div className="flex items-center gap-2">
            <input
              aria-label="最小文件大小"
              className="field-input w-24"
              placeholder="最小"
              value={minSizeKB}
              onChange={(e) => setMinSizeKB(e.target.value.replace(/\D/g, ''))}
            />
            <span className="text-[var(--text-dim)]">—</span>
            <input
              aria-label="最大文件大小"
              className="field-input w-24"
              placeholder="最大"
              value={maxSizeKB}
              onChange={(e) => setMaxSizeKB(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        </Section>

        <Section title="导入时间">
          <div className="flex gap-1">
            {[
              { v: 0, label: '不限' },
              { v: 7, label: '近 7 天' },
              { v: 30, label: '近 30 天' },
              { v: 90, label: '近 90 天' },
              { v: 365, label: '近一年' }
            ].map((o) => (
              <Chip key={o.v} active={withinDays === o.v} onClick={() => setWithinDays(o.v)}>
                {o.label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="构图">
          <div className="flex gap-1">
            {[
              { v: '', label: '不限' },
              { v: 'landscape', label: '横图' },
              { v: 'portrait', label: '竖图' },
              { v: 'square', label: '方形' }
            ].map((o) => (
              <Chip key={o.v} active={shape === o.v} onClick={() => setShape(o.v as typeof shape)}>
                {o.label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="颜色数量">
          <div className="flex gap-1">
            {[
              { v: 0, label: '不限' },
              { v: 1, label: '≤ 1' },
              { v: 2, label: '≤ 2' },
              { v: 3, label: '≤ 3' }
            ].map((o) => (
              <Chip key={o.v} active={colorCountMax === o.v} onClick={() => setColorCountMax(o.v)}>
                {o.label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="其他">
          <Chip active={untagged} onClick={() => setUntagged(!untagged)}>
            只看未打标签
          </Chip>
        </Section>

        <Section title="主色调">
          <div className="flex items-center gap-1.5">
            {QUICK_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`颜色 ${c}`}
                aria-pressed={color === c}
                className="h-6 w-6 rounded-full border-2 transition-transform duration-100 hover:scale-110"
                style={{ background: c, borderColor: color === c ? '#fff' : 'transparent' }}
                onClick={() => setColor(color === c ? undefined : c)}
              />
            ))}
            {color && (
              <button
                className="ml-1 rounded bg-[var(--bg-hover)] px-2 py-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text-main)]"
                onClick={() => setColor(undefined)}
              >
                清除
              </button>
            )}
          </div>
        </Section>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
