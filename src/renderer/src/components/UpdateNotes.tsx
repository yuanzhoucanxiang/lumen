import type { ReactNode } from 'react'
import { parseUpdateNotes, type NotesBlock } from '../updateNotes'

/**
 * 更新说明（release notes）分类分点渲染。
 * 解析规则见 ../updateNotes.ts（容错 markdown 标题/多种条目符/引言段落，里程碑 175）。
 */
export default function UpdateNotes({ notes }: { notes: string }) {
  const blocks = parseUpdateNotes(notes)
  if (blocks.length === 0) return null

  const renderBlock = (block: NotesBlock, i: number): ReactNode => {
    // 说明段落（引言等）：正文样式，不加粗不高亮
    if (block.kind === 'paragraph' && !block.text) {
      return (
        <div key={i} className="space-y-0.5">
          {block.items.map((it, j) => (
            <div key={j} className="flex gap-1.5">
              <span className="shrink-0 text-[var(--accent-text)]">·</span>
              <span>{it}</span>
            </div>
          ))}
        </div>
      )
    }
    if (block.kind === 'paragraph') {
      return (
        <div key={i}>
          <div className="text-[var(--text-dim)]">{block.text}</div>
          {block.items.length > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {block.items.map((it, j) => (
                <div key={j} className="flex gap-1.5">
                  <span className="shrink-0 text-[var(--accent-text)]">·</span>
                  <span>{it}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }
    return (
      <div key={i}>
        <div className="mb-0.5 mt-1 font-medium text-[var(--accent-text)] first:mt-0">
          {block.text}
        </div>
        <div className="space-y-0.5">
          {block.items.map((it, j) => (
            <div key={j} className="flex gap-1.5">
              <span className="shrink-0 text-[var(--accent-text)]">·</span>
              <span>{it}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return <div className="space-y-1">{blocks.map(renderBlock)}</div>
}
