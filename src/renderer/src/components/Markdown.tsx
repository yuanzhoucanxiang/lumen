import type { ReactNode } from 'react'

/**
 * 极简 Markdown 渲染(不引第三方依赖,覆盖注释常用语法):
 * # 标题 / - 列表 / 1. 有序列表 / **加粗** / *斜体* / `行内代码` / [链接](url) / 换行段落
 */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // 依次解析: 行内代码 / 加粗 / 斜体 / 链接
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('`')) {
      nodes.push(
        <code key={`${keyBase}-c${i++}`} className="rounded-sm bg-[var(--bg-hover)] px-1 font-mono text-[11px]">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyBase}-b${i++}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={`${keyBase}-i${i++}`}>
          {token.slice(1, -1)}
        </em>
      )
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        nodes.push(
          <a
            key={`${keyBase}-l${i++}`}
            href={linkMatch[2]}
            className="text-[var(--accent)] underline decoration-dotted hover:opacity-70"
            onClick={(e) => {
              e.preventDefault()
              void window.api.openExternal(linkMatch![2])
            }}
          >
            {linkMatch[1]}
          </a>
        )
      } else {
        nodes.push(token)
      }
    }
    last = m.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let listItems: string[] = []
  let listKey = 0
  let ordered = false

  const flushList = () => {
    if (listItems.length === 0) return
    const items = listItems.map((item, idx) => (
      <li key={`li-${listKey}-${idx}`} className="leading-relaxed">
        {renderInline(item, `li-${listKey}-${idx}`)}
      </li>
    ))
    if (ordered) {
      blocks.push(
        <ol key={`ol-${listKey}`} className="mb-1 list-decimal space-y-0.5 pl-4 marker:text-[var(--text-faint)]">
          {items}
        </ol>
      )
    } else {
      blocks.push(
        <ul key={`ul-${listKey}`} className="mb-1 list-disc space-y-0.5 pl-4 marker:text-[var(--text-faint)]">
          {items}
        </ul>
      )
    }
    listKey++
    listItems = []
  }

  while (i < lines.length) {
    const line = lines[i]
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    const num = line.match(/^\s*\d+\.\s+(.+)$/)

    if (heading) {
      flushList()
      const level = heading[1].length
      const sizes = ['text-[13px]', 'text-[12px]', 'text-[12px]', 'text-[11px]']
      blocks.push(
        <div key={`h-${i}`} className={`${sizes[level - 1]} mb-0.5 font-semibold text-[var(--accent-text)]`}>
          {renderInline(heading[2], `h-${i}`)}
        </div>
      )
      i++
    } else if (bullet) {
      flushList()
      ordered = false
      while (i < lines.length) {
        const b = lines[i].match(/^\s*[-*]\s+(.+)$/)
        if (!b) break
        listItems.push(b[1])
        i++
      }
    } else if (num) {
      flushList()
      ordered = true
      while (i < lines.length) {
        const n = lines[i].match(/^\s*\d+\.\s+(.+)$/)
        if (!n) break
        listItems.push(n[1])
        i++
      }
    } else if (line.trim() === '') {
      flushList()
      i++
    } else {
      flushList()
      blocks.push(
        <p key={`p-${i}`} className="mb-1 leading-relaxed">
          {renderInline(line, `p-${i}`)}
        </p>
      )
      i++
    }
  }
  flushList()

  return <div className="text-[12px] text-[var(--text-main)]">{blocks}</div>
}
