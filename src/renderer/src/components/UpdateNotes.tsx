import type { ReactNode } from 'react'

/**
 * 更新说明（release notes）分类分点渲染。
 *
 * 约定格式（GitHub Release body 按此书写）：
 *   ✨ 新功能
 *   · 侧栏分区折叠
 *   · 支持格式筛选
 *
 *   🐛 修复
 *   · 修复导出覆盖同名文件
 *
 *   ⚙️ 优化
 *   · 导入速度提升
 *
 * 解析规则：
 *   - 空行分隔分类区块
 *   - 非「·」开头的行视为分类标题（加粗 + 品牌色）
 *   - 「·」开头的行视为条目（圆点缩进）
 *   - 无法识别的文本原样显示
 */
export default function UpdateNotes({ notes }: { notes: string }) {
  const blocks = notes
    .split('\n')
    .reduce<{ title: string; items: string[] }[]>((acc, raw) => {
      const line = raw.trimEnd()
      if (!line.trim()) return acc // 空行：结束当前区块
      if (line.trimStart().startsWith('·')) {
        const items = acc.length > 0 ? acc : [{ title: '', items: [] }]
        const last = items[items.length - 1]
        if (last.items.length === 0 && last.title === '') {
          // 条目出现在最前（无分类标题）
        }
        last.items.push(line.trimStart().replace(/^·\s*/, ''))
        return acc.length > 0 ? acc : items
      }
      // 分类标题行
      acc.push({ title: line.trim(), items: [] })
      return acc
    }, [])

  if (blocks.length === 0) return null

  const renderBlock = (block: { title: string; items: string[] }, i: number): ReactNode => {
    // 无标题纯条目块：条目直接渲染
    if (!block.title) {
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
    return (
      <div key={i}>
        <div className="mb-0.5 mt-1 font-medium text-[var(--accent-text)] first:mt-0">
          {block.title}
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
