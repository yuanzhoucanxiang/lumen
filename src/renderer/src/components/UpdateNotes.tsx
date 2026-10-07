import type { ReactNode } from 'react'
import { parseUpdateNotes, type NotesBlock } from '../updateNotes'

/**
 * 更新说明（release notes）分类分点渲染——零特殊符号（里程碑 176）。
 * 分类标题 + 纯文本条目（无圆点无符号）；解析规则见 ../updateNotes.ts。
 */
export default function UpdateNotes({ notes }: { notes: string }) {
  const blocks = parseUpdateNotes(notes)
  if (blocks.length === 0) return null

  const renderItems = (items: string[]): ReactNode => (
    <div className="space-y-0.5">
      {items.map((it, j) => (
        <div key={j}>{it}</div>
      ))}
    </div>
  )

  const renderBlock = (block: NotesBlock, i: number): ReactNode => {
    if (block.kind === 'paragraph') {
      return (
        <div key={i}>
          {block.text && <div className="text-[var(--text-dim)]">{block.text}</div>}
          {block.items.length > 0 && <div className={block.text ? 'mt-0.5' : ''}>{renderItems(block.items)}</div>}
        </div>
      )
    }
    return (
      <div key={i}>
        <div className="mb-0.5 mt-1 font-medium text-[var(--accent-text)] first:mt-0">{block.text}</div>
        {renderItems(block.items)}
      </div>
    )
  }

  return <div className="space-y-1">{blocks.map(renderBlock)}</div>
}
