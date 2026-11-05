/**
 * 标签名治理（里程碑 219）：归一化、近重复建议、Agent 建标签策略规划。
 *
 * 背景：标签表此前只有 name 的精确 UNIQUE，`AI生成`/`AI 生成`/`AI-生成` 会各建一个；
 * Agent 每次导入按语境造词，标签数上千后侧栏和检索都会变噪声。这里把"判重口径"
 * 收敛成同一个纯函数，主进程建标签/Agent 导入/健康报告都复用它。
 */

/** 归一化口径：NFKC（全角→半角）、英文小写、去掉空白与常见分隔符/标点。
 *  展示名仍保留创建时的原始写法，只有判重与匹配用这个键。 */
export function normalizeTagName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[‐‑‒–—―ー－\-_~·•・.,，、:：;；!！?？'"“”‘’()（）[\]【】<>《》/\\|]+/g, '')
    .slice(0, 60)
}

/** 编辑距离（只用于短标签的近似建议；超过阈值提前退出） */
function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev = new Array(b.length + 1)
  const cur = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]
  }
  return prev[b.length]
}

/** 给一个"未知标签名"找最接近的已有标签（最多 limit 个），用于 Agent 复用提示与健康报告 */
export function suggestSimilarTagNames(
  name: string,
  existing: readonly { name: string; aliases?: string[] }[],
  limit = 3
): string[] {
  const norm = normalizeTagName(name)
  if (!norm) return []
  const scored: { name: string; score: number }[] = []
  for (const t of existing) {
    // 别名也参与比较：合并时记下的旧名字，输入后仍会指向同一个标签（里程碑 221）
    let best = 0
    for (const candidate of [t.name, ...(t.aliases ?? [])]) {
      const other = normalizeTagName(candidate)
      if (!other || other === norm) continue
      let score = 0
      if (other.includes(norm) || norm.includes(other)) {
        // 包含关系：越接近越长越可信（「奇幻」vs「奇幻场景」）
        score = 60 + Math.round((Math.min(norm.length, other.length) / Math.max(norm.length, other.length)) * 30)
      } else {
        // 近形只认 1 个字符的差异：2 字中文词间距离 2 基本是两个无关词（奇幻/人物），不该提示
        const dist = editDistance(norm, other, 1)
        if (dist <= 1 && Math.min(norm.length, other.length) >= 2) score = 50 - dist * 10
      }
      if (score > best) best = score
    }
    if (best > 0) scored.push({ name: t.name, score: best })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, limit)
    .map((s) => s.name)
}

export interface AgentTagPlan {
  /** 本次实际要应用（已存在或新建）的标签名（规范为库里的写法） */
  apply: string[]
  /** 本次新建的标签名 */
  create: string[]
  /** 因额度不足没有创建、需要 Agent 改复用或询问用户的标签 */
  unknown: { name: string; suggestions: string[] }[]
}

/**
 * Agent 建标签策略规划（纯函数）：
 * - 已存在（精确或归一命中）→ 复用库里的规范写法，不新建；
 * - 未知标签：额度为正则新建，0 = 只复用（全部转 unknown），-1 = 不限制；
 * - unknown 附近似候选，Agent 可以据此改复用或回来问用户。
 */
export function planAgentTags(
  names: readonly string[],
  existing: readonly { name: string; aliases?: string[] }[],
  quota: number
): AgentTagPlan {
  const byNorm = new Map<string, string>()
  for (const t of existing) {
    // 名字与别名都映射到同一个标签（里程碑 221）：合并/改名后的旧写法仍能复用
    for (const candidate of [t.name, ...(t.aliases ?? [])]) {
      const norm = normalizeTagName(candidate)
      if (norm && !byNorm.has(norm)) byNorm.set(norm, t.name)
    }
  }
  const apply: string[] = []
  const create: string[] = []
  const unknown: { name: string; suggestions: string[] }[] = []
  const seen = new Set<string>()
  let createdCount = 0
  const unlimited = quota < 0
  for (const raw of names) {
    const name = String(raw ?? '').trim()
    const norm = normalizeTagName(name)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    const hit = byNorm.get(norm)
    if (hit) {
      if (!apply.includes(hit)) apply.push(hit)
      continue
    }
    if (unlimited || createdCount < quota) {
      apply.push(name)
      create.push(name)
      byNorm.set(norm, name)
      createdCount++
    } else {
      unknown.push({ name, suggestions: suggestSimilarTagNames(name, existing) })
    }
  }
  return { apply, create, unknown }
}
