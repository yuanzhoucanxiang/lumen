/**
 * 更新说明（release notes）解析——纯函数，供 UpdateNotes 组件渲染（里程碑 175）。
 *
 * 约定格式（release.cjs 自动草稿即此格式）：
 *   分类标题（一行）
 *   · 条目
 *   · 条目
 *   （空行分隔分类区块）
 *
 * 容错：真实发布里作者可能手写 markdown（`# LUMEN v0.8.35` / `## ✨ 新功能` / `- 条目` /
 * 引言段落），早期版本会把 `#`、`##` 原样当标题渲染出来。这里统一归一：
 *   - `#{1,6}` 前缀剥掉；`# LUMEN vX.Y.Z` 版本行整行跳过（卡片本身已显示版本号）
 *   - `·` / `•` / `- ` / `* ` 都视作条目
 *   - 裸行：下一非空行是条目 → 分类标题；否则 → 说明段落（正文样式，不加粗不高亮）
 */

export interface NotesBlock {
  kind: 'title' | 'paragraph'
  text: string
  items: string[]
}

const BULLET_RE = /^(?:·|•|[-*]\s)\s*/
const HEADING_RE = /^#{1,6}\s*/

export function parseUpdateNotes(notes: string): NotesBlock[] {
  const lines = notes.split('\n')
  const blocks: NotesBlock[] = []
  const isBullet = (s: string): boolean => BULLET_RE.test(s.trimStart())
  /** 该行之后第一个非空行是否是条目（用于区分「分类标题」与「说明段落」） */
  const nextNonEmptyIsBullet = (from: number): boolean => {
    for (let i = from + 1; i < lines.length; i++) {
      const t = lines[i].trim()
      if (!t) continue
      return isBullet(t)
    }
    return false
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    let line = raw.trim()
    if (!line) continue

    if (isBullet(line)) {
      // 条目：挂到最近的区块（无区块时建无标题块）
      const text = line.replace(BULLET_RE, '').trim()
      if (text) {
        if (blocks.length === 0) blocks.push({ kind: 'paragraph', text: '', items: [] })
        blocks[blocks.length - 1].items.push(text)
      }
      continue
    }

    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      line = line.replace(HEADING_RE, '').trim()
      if (!line) continue
      // 版本标题行跳过（卡片顶部已显示版本号）
      if (/^LUMEN\b/i.test(line)) continue
      blocks.push({ kind: 'title', text: line, items: [] })
      continue
    }

    // 裸行：后随条目 → 标题；否则视为段落（引言等正文）
    blocks.push({
      kind: nextNonEmptyIsBullet(i) ? 'title' : 'paragraph',
      text: line,
      items: []
    })
  }

  // 丢弃空块（无标题也无条目）
  return blocks.filter((b) => b.text || b.items.length > 0)
}
