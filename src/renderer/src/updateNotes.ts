/**
 * 更新说明（release notes）解析——纯函数，供 UpdateNotes 组件渲染（里程碑 175/176）。
 *
 * 推荐格式（**零特殊符号**，release.cjs 自动草稿即此格式）：
 *   新功能
 *   助手看图追问：……
 *   助手视觉重排：……
 *
 *   优化
 *   界面贴合三套主题……
 *
 * 规则：空行分隔分类区块；区块内**首行是分类标题，其余行是条目**——不需要任何符号。
 *
 * 兼容旧格式（历史发布）：
 *   - markdown 标题 `#`/`##` 前缀剥离；`# LUMEN vX.Y.Z` 版本行整行跳过（卡片已显示版本号）
 *   - `·` / `•` / `- ` / `* ` 条目符识别（有此符时以符号分行，其余行作标题）
 *   - 单行区块 → 说明段落（引言等，正文样式）
 */

export interface NotesBlock {
  kind: 'title' | 'paragraph'
  text: string
  items: string[]
}

const BULLET_RE = /^(?:·|•|[-*]\s)\s*/
const HEADING_RE = /^#{1,6}\s*/

export function parseUpdateNotes(notes: string): NotesBlock[] {
  // 1. 归一：剥标题符、跳版本行、去空行 → 按空行/标题行切块
  //    （`# 标题` 本身是块边界：旧格式里标题间可无空行，见 v0.8.35 手写说明）
  const blocks: string[][] = []
  let cur: string[] = []
  const flush = (): void => {
    if (cur.length > 0) {
      blocks.push(cur)
      cur = []
    }
  }
  for (const raw of notes.split('\n')) {
    let line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (HEADING_RE.test(line)) {
      line = line.replace(HEADING_RE, '').trim()
      if (!line) continue
      if (/^LUMEN\b/i.test(line)) continue // 版本标题行：卡片顶部已显示版本号
      flush() // 标题行开启新块
      cur.push(line)
      continue
    }
    cur.push(line)
  }
  flush()

  // 2. 逐块解析
  const out: NotesBlock[] = []
  for (const lines of blocks) {
    const bulletCount = lines.filter((l) => BULLET_RE.test(l)).length
    if (bulletCount > 0) {
      // 带条目符的格式：首个非条目行作标题，条目行去符后为条目；其余非条目行并入条目（不丢内容）
      const nonBullets = lines.filter((l) => !BULLET_RE.test(l))
      const title = nonBullets[0] ?? ''
      const items = [
        ...lines.filter((l) => BULLET_RE.test(l)).map((l) => l.replace(BULLET_RE, '').trim()),
        ...nonBullets.slice(1)
      ].filter(Boolean)
      out.push({ kind: title ? 'title' : 'paragraph', text: title, items })
    } else if (lines.length === 1) {
      // 单行区块：说明段落（引言等）
      out.push({ kind: 'paragraph', text: lines[0], items: [] })
    } else {
      // 零符号格式：首行分类，其余行条目
      out.push({ kind: 'title', text: lines[0], items: lines.slice(1) })
    }
  }
  return out.filter((b) => b.text || b.items.length > 0)
}
