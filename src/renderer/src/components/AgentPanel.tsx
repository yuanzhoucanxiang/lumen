import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { useLibraryStore, type AgentMsg } from '../stores/libraryStore'
import type { AgentOpView } from '@shared/types'

/** 空态示例提示（点击直接发送） */
const ACTION_CN: Record<string, string> = {
  import: '导入',
  tag: '打标签',
  untag: '摘标签',
  folder: '归档',
  star: '星级',
  board: '上板',
  note: '备注'
}

const EXAMPLES = [
  '最近一周导入的竖构图',
  '还没打过标签的素材',
  'AI 助手导入的图',
  '帮我找星标 4 星以上的横图'
]

/**
 * 助手面板（里程碑 161/163）：右侧对话抽屉——自然语言多轮找图 + 结果沉淀。
 * 只读检索：模型输出结构化条件 -> 主进程查库 -> 结果缩略图直接预览；
 * 沉淀动作：「在素材库中查看」（全量结果铺进图库，可用图库全部能力继续操作）、
 * 「存为智能文件夹」（把本轮条件存成可复用的活查询）。
 * 对话状态在 store（关闭面板/切换视图不丢）。
 */
export default function AgentPanel() {
  const openPreview = useLibraryStore((s) => s.openPreview)
  const closeAgentPanel = useLibraryStore((s) => s.closeAgentPanel)
  const messages = useLibraryStore((s) => s.agentMessages)
  const busy = useLibraryStore((s) => s.agentBusy)
  const tags = useLibraryStore((s) => s.tags)
  const [input, setInput] = useState('')
  const [smartSaveFor, setSmartSaveFor] = useState<number | null>(null)
  const [smartName, setSmartName] = useState('')
  const [tagFor, setTagFor] = useState<number | null>(null)
  const [tagName, setTagName] = useState('')
  const [rerankBusy, setRerankBusy] = useState<number | null>(null)
  const [rerankProgress, setRerankProgress] = useState('')
  /** 模型流式输出的尾部预览(等待时让"AI 在说话"可感知) */
  const [streamTail, setStreamTail] = useState('')
  /** 看图追问开关:开启后追问附带最近一轮结果的缩略图(上限 6 张) */
  const [attachImages, setAttachImages] = useState(false)
  /** 视图:对话 / 操作记录(里程碑 171) */
  const [view, setView] = useState<'chat' | 'ops'>('chat')
  const [ops, setOps] = useState<AgentOpView[] | null>(null)
  const [undoing, setUndoing] = useState<number | null>(null)
  /** 记录卡片展开的明细(里程碑 172):查看/单独回退每个受影响项 */
  const [expandedOps, setExpandedOps] = useState<Set<number>>(new Set())
  /** 展开的归纳组(里程碑 174):默认收起,展开看单条操作 */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  // 流式增量订阅:busy 期间显示模型输出尾部
  useEffect(() => {
    const off = window.api.onAgentDelta((p) => setStreamTail(p.text.slice(-80)))
    return () => {
      off()
      setStreamTail('')
    }
  }, [])

  // 视觉重排进度:主进程经 ai:searchProgress 推送,重排中在按钮下方显示
  useEffect(() => {
    const off = window.api.onAiSearchProgress((p) => {
      if (rerankBusy !== null) setRerankProgress(p.phase)
    })
    return () => {
      off()
      setRerankProgress('')
    }
  }, [rerankBusy])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = (preset?: string) => {
    const q = (preset ?? input).trim()
    if (!q || busy) return
    setInput('')
    // 看图追问:开启附图时带上最近一轮结果的素材 id(上限 6),发完自动关闭(控制多模态成本)
    const lastAssets = [...messages].reverse().find((m) => m.role === 'assistant' && m.assets?.length)?.assets
    const imageIds = attachImages && lastAssets ? lastAssets.slice(0, 6).map((a) => a.id) : undefined
    if (attachImages) setAttachImages(false)
    void useLibraryStore.getState().agentSend(q, imageIds)
  }

  const clearChat = () => {
    setSmartSaveFor(null)
    useLibraryStore.getState().agentClearChat()
  }

  /** 两级归纳（里程碑 174）：先按批次键（同请求）归纳，无键记录按（分钟+动作）归并。
   *  组卡片默认收起，展开看单条操作，单条再展开看逐项素材。 */
  const opGroups = useMemo(() => {
    // 第一层：按批次键(同一次请求的多条记录)归纳——多操作批次保持独立成组
    const batches = new Map<string, AgentOpView[]>()
    const singles: AgentOpView[] = []
    for (const op of ops ?? []) {
      if (op.groupKey) {
        const arr = batches.get(op.groupKey)
        if (arr) arr.push(op)
        else batches.set(op.groupKey, [op])
      } else {
        singles.push(op)
      }
    }
    const groups: { key: string; ops: AgentOpView[] }[] = [...batches.entries()].map(([key, groupOps]) => ({
      key,
      ops: groupOps
    }))
    // 批次里只有一条的也进入归并池（单独请求常见于逐次导入）
    const toMerge: AgentOpView[] = [...singles]
    for (const [key, groupOps] of [...batches.entries()]) {
      if (groupOps.length === 1) {
        toMerge.push(groupOps[0])
        groups.splice(
          groups.findIndex((g) => g.key === key),
          1
        )
      }
    }
    // 第二层：单条记录按(分钟+动作)归并——同分钟的同类单次操作收敛成一行，避免列表拥挤
    const merged = new Map<string, AgentOpView[]>()
    for (const op of toMerge) {
      const key = `${Math.floor(op.ts / 60000)}|${op.action}`
      const arr = merged.get(key)
      if (arr) arr.push(op)
      else merged.set(key, [op])
    }
    for (const [key, groupOps] of merged.entries()) groups.push({ key, ops: groupOps })
    groups.sort((a, b) => (b.ops[0]?.ts ?? 0) - (a.ops[0]?.ts ?? 0))
    return groups.map((g) => ({
      key: g.key,
      ops: g.ops,
      undoneOps: g.ops.filter((o) => o.undone).length,
      ts: g.ops[0]?.ts ?? 0,
      action: g.ops[0]?.action ?? ''
    }))
  }, [ops])

  /** 组级回退：逐条撤掉组内记录的剩余项 */
  const undoGroup = async (groupKey: string, groupOps: AgentOpView[]) => {
    setUndoing(-1)
    try {
      let okCount = 0
      const msgs: string[] = []
      for (const op of groupOps) {
        if (op.undone || !op.undoable) continue
        const r = await window.api.agentUndoOp(op.id)
        if (r.ok) okCount++
        else if (!r.message.includes('已回退过')) msgs.push(r.message)
      }
      useLibraryStore.getState().showToast(
        okCount > 0 ? `已回退该组 ${okCount} 项操作${msgs.length > 0 ? `（${msgs.length} 项未成功）` : ''}` : msgs[0] ?? '没有可回退的操作'
      )
      setOps(await window.api.agentOpsList(50))
      void useLibraryStore.getState().refreshAll()
      void useLibraryStore.getState().refreshTags()
      void useLibraryStore.getState().refreshFolders()
      void groupKey
    } catch (e) {
      useLibraryStore.getState().showToast(`回退失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setUndoing(null)
    }
  }

  /** 加载操作记录（切到记录视图时） */
  useEffect(() => {
    if (view !== 'ops') return
    let alive = true
    void (async () => {
      try {
        const list = await window.api.agentOpsList(50)
        if (alive) setOps(list)
      } catch {
        if (alive) setOps([])
      }
    })()
    return () => {
      alive = false
    }
  }, [view])

  /** 回退一条操作（itemIds 给了则只回退其中指定项，里程碑 172 逐项回退） */
  const undo = async (id: number, itemIds?: string[]) => {
    setUndoing(id)
    try {
      const r = await window.api.agentUndoOp(id, itemIds)
      useLibraryStore.getState().showToast(r.message)
      if (r.ok) {
        setOps(await window.api.agentOpsList(50))
        void useLibraryStore.getState().refreshAll()
        void useLibraryStore.getState().refreshTags()
        void useLibraryStore.getState().refreshFolders()
      }
    } catch (e) {
      useLibraryStore.getState().showToast(`回退失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setUndoing(null)
    }
  }

  /** 把本轮全量结果铺进图库（用图库已有能力继续：批量打标签/导出/上板等） */
  const viewInLibrary = async (m: AgentMsg) => {
    if (!m.conditions || !m.query) return
    try {
      const assets = await window.api.agentSearchFull(m.conditions)
      if (assets.length === 0) {
        useLibraryStore.getState().showToast('没有可查看的素材（结果可能已变化）')
        return
      }
      const st = useLibraryStore.getState()
      st.setAiSearchPending(m.query)
      st.setAiSearchResults(m.query, assets)
      st.showToast(`已在素材库中显示 ${assets.length} 个结果`)
    } catch (e) {
      useLibraryStore.getState().showToast(`打开失败：${String((e as Error)?.message ?? e)}`)
    }
  }

  /** 把本轮条件存成智能文件夹（结果自动更新，可长期复用）；存好跳转到该文件夹让用户立刻看到 */
  const saveSmart = async (m: AgentMsg) => {
    if (!m.smart) return
    const name = smartName.trim() || '助手收藏'
    try {
      const created = await window.api.createFolder(name, null, 1, JSON.stringify(m.smart))
      await useLibraryStore.getState().refreshFolders()
      useLibraryStore.getState().showToast(`已创建智能文件夹「${name}」`)
      setSmartSaveFor(null)
      if (created?.id) {
        useLibraryStore.getState().setView({ type: 'folder', id: created.id })
        closeAgentPanel()
      }
    } catch (e) {
      useLibraryStore.getState().showToast(`创建失败：${String((e as Error)?.message ?? e)}`)
    }
  }

  /** 按本轮条件给全部命中素材打标签（可撤销写操作：标签可随时移除） */
  const tagResults = async (index: number, m: AgentMsg) => {
    if (!m.conditions) return
    const name = tagName.trim()
    if (!name) return
    try {
      const r = await window.api.agentTag(m.conditions, name)
      await useLibraryStore.getState().refreshTags()
      useLibraryStore.getState().showToast(
        r.tagged > 0 ? `已为 ${r.tagged} 个素材打上「${name}」标签` : '没有命中的素材可打标签（结果可能已变化）'
      )
      if (r.tagged > 0) setTagFor(null)
    } catch (e) {
      useLibraryStore.getState().showToast(`打标签失败：${String((e as Error)?.message ?? e)}`)
    }
  }

  /** AI 视觉重排（里程碑 164）：按查询意图对结果做视觉相关性排序（处理"感觉像XX"类查询） */
  const rerank = async (index: number, m: AgentMsg) => {
    if (rerankBusy !== null || !m.assets || m.assets.length < 2) return
    setRerankBusy(index)
    try {
      const query = m.query ?? messages[index - 1]?.text ?? ''
      const ranked = await window.api.agentRerank(query, m.assets.map((a) => a.id))
      if (ranked.length === 0) {
        useLibraryStore.getState().showToast('视觉重排失败，已保留原顺序')
      } else {
        useLibraryStore.getState().agentApplyRerank(index, ranked)
        useLibraryStore.getState().showToast('已按视觉相关性重排')
      }
    } catch (e) {
      useLibraryStore.getState().showToast(`视觉重排失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setRerankBusy(null)
    }
  }

  /** 单条操作卡片（里程碑 171/172）：进度 + 全部回退 + 逐项明细展开 */
  const renderOpCard = (op: AgentOpView) => (
            <div
              key={op.id}
              className="agent-op-card rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 text-[11.5px]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className={`min-w-0 flex-1 leading-[1.6] ${op.undone ? 'text-[var(--text-faint)] line-through' : ''}`}>
                  {op.summary}
                </span>
                {op.undone ? (
                  <span className="shrink-0 rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)]">
                    已回退
                  </span>
                ) : op.undoable && op.items.length > 0 ? (
                  <button
                    className="shrink-0 rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)] disabled:opacity-40"
                    disabled={undoing !== null}
                    title={op.items.length > 1 ? '回退这条操作剩余的全部项' : '回退这条操作'}
                    onClick={() => void undo(op.id)}
                  >
                    {undoing === op.id ? '回退中…' : '全部回退'}
                  </button>
                ) : (
                  <span className="shrink-0 rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)]" title="移动导入的源文件已删除，无法回退">
                    不可回退
                  </span>
                )}
              </div>
              <div className="tnum mt-1 flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
                <span>
                  {new Date(op.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {' · '}
                  {op.action}
                  {op.items.length > 0
                    ? ` · 已回退 ${op.undoneCount}/${op.items.length}`
                    : op.affected > 0
                      ? ` · ${op.affected} 个素材`
                      : ''}
                </span>
                {op.items.length > 1 && (
                  <button
                    className="flex items-center gap-0.5 text-[10px] text-[var(--text-dim)] transition-colors hover:text-[var(--accent-text)]"
                    aria-expanded={expandedOps.has(op.id)}
                    onClick={() =>
                      setExpandedOps((prev) => {
                        const next = new Set(prev)
                        if (next.has(op.id)) next.delete(op.id)
                        else next.add(op.id)
                        return next
                      })
                    }
                  >
                    <Icon name="chevronDown" size={9} className={expandedOps.has(op.id) ? '' : '-rotate-90'} />
                    {expandedOps.has(op.id) ? '收起明细' : '展开明细'}
                  </button>
                )}
              </div>

              {/* 逐项明细（里程碑 172）：每个受影响的素材可单独回退 */}
              {expandedOps.has(op.id) && op.items.length > 0 && (
                <div className="mt-1.5 space-y-1 border-t border-[var(--border)] pt-1.5">
                  {op.items.map((it) => (
                    <div key={it.id} className="agent-op-item flex items-center gap-1.5">
                      {(it.assetId ?? it.id) && /^[0-9a-f]{16}$/i.test(it.assetId ?? it.id) ? (
                        <img
                          src={window.api.thumbnailUrl(it.assetId ?? it.id)}
                          alt=""
                          loading="lazy"
                          draggable={false}
                          className="h-6 w-6 shrink-0 rounded-sm border border-[var(--border)] object-cover"
                        />
                      ) : (
                        <span className="h-6 w-6 shrink-0 rounded-sm border border-[var(--border)]" aria-hidden="true" />
                      )}
                      <span className={`min-w-0 flex-1 truncate text-[10.5px] ${it.undone ? 'text-[var(--text-faint)] line-through' : ''}`} title={it.name}>
                        {it.name}
                      </span>
                      {!it.undone && op.undoable ? (
                        <button
                          className="shrink-0 text-[10px] text-[var(--text-dim)] transition-colors hover:text-[var(--accent-text)] disabled:opacity-40"
                          disabled={undoing !== null}
                          onClick={() => void undo(op.id, [it.id])}
                        >
                          撤销
                        </button>
                      ) : (
                        <span className="shrink-0 text-[10px] text-[var(--text-faint)]">已撤销</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
  )

  return (
    <aside
      className="agent-panel anim-slide-left fixed right-0 top-0 z-[140] flex h-full w-[384px] flex-col border-l border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl"
      aria-label="找图助手"
      data-testid="agent-panel"
    >
      <header className="agent-panel__header flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Icon name="assistant" size={13} className="text-[var(--accent-text)]" />
          <span className="text-[12px] font-medium">助手</span>
          <span className="agent-panel__kicker text-[10px] text-[var(--text-faint)]">对话式找图</span>
        </div>
        <div className="flex items-center gap-1">
          {/* 视图切换:对话 / 操作记录(里程碑 171) */}
          <button
            className={`btn-ghost px-1.5 py-1 ${view === 'ops' ? 'text-[var(--accent-text)]' : ''}`}
            title={view === 'ops' ? '返回对话' : 'Agent 操作记录（可回退）'}
            aria-label="操作记录"
            aria-pressed={view === 'ops'}
            onClick={() => setView((v) => (v === 'ops' ? 'chat' : 'ops'))}
          >
            <Icon name={view === 'ops' ? 'arrowLeft' : 'listRows'} size={12} />
          </button>
          {view === 'chat' && messages.length > 0 && (
            <button
              className="btn-ghost px-1.5 py-1"
              title="清空对话"
              aria-label="清空对话"
              onClick={clearChat}
            >
              <Icon name="trash" size={12} />
            </button>
          )}
          <button
            className="btn-ghost px-1.5 py-1"
            title="关闭"
            aria-label="关闭找图助手"
            onClick={closeAgentPanel}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      </header>

      {view === 'ops' ? (
        /* 操作记录视图（里程碑 171）：Agent 写操作审计 + 一键回退 */
        <div className="agent-ops flex-1 space-y-2 overflow-y-auto px-3 py-3" data-testid="agent-ops">
          <div className="agent-ops__intro rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-2.5 text-[11px] leading-[1.6] text-[var(--text-dim)]">
            AI 助手通过本地接口做过的改动都记在这里，点「回退」可撤销（一次性）。
          </div>
          {ops === null && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-faint)]">
              <Icon name="rotate" size={12} className="animate-spin" />
              加载中…
            </div>
          )}
          {ops !== null && ops.length === 0 && (
            <div className="text-[11.5px] text-[var(--text-faint)]">暂无操作记录</div>
          )}
          {opGroups.map((g) =>
            g.ops.length === 1 ? (
              renderOpCard(g.ops[0])
            ) : (
              /* 归纳组卡片（里程碑 174）：默认收起，展开看单条操作 */
              <div
                key={g.key}
                className="agent-op-card agent-op-group rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 text-[11.5px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`min-w-0 flex-1 leading-[1.6] ${g.undoneOps === g.ops.length ? 'text-[var(--text-faint)] line-through' : ''}`}>
                    {ACTION_CN[g.action] ?? g.action} ×{g.ops.length} 项操作
                  </span>
                  {g.undoneOps === g.ops.length ? (
                    <span className="shrink-0 rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)]">
                      已回退
                    </span>
                  ) : (
                    <button
                      className="shrink-0 rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)] disabled:opacity-40"
                      disabled={undoing !== null}
                      title="回退该组全部操作的剩余项"
                      onClick={() => void undoGroup(g.key, g.ops)}
                    >
                      {undoing === -1 ? '回退中…' : '全部回退'}
                    </button>
                  )}
                </div>
                <div className="tnum mt-1 flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
                  <span>
                    {new Date(g.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {' · 已回退 '}
                    {g.undoneOps}/{g.ops.length} 项
                  </span>
                  <button
                    className="flex items-center gap-0.5 text-[10px] text-[var(--text-dim)] transition-colors hover:text-[var(--accent-text)]"
                    aria-expanded={expandedGroups.has(g.key)}
                    onClick={() =>
                      setExpandedGroups((prev) => {
                        const next = new Set(prev)
                        if (next.has(g.key)) next.delete(g.key)
                        else next.add(g.key)
                        return next
                      })
                    }
                  >
                    <Icon name="chevronDown" size={9} className={expandedGroups.has(g.key) ? '' : '-rotate-90'} />
                    {expandedGroups.has(g.key) ? '收起操作' : `展开 ${g.ops.length} 条操作`}
                  </button>
                </div>
                {expandedGroups.has(g.key) && (
                  <div className="mt-1.5 space-y-1.5 border-t border-[var(--border)] pt-1.5">
                    {g.ops.map((op) => renderOpCard(op))}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      ) : (
      <>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-3 text-[11.5px] leading-[1.7] text-[var(--text-dim)]">
              用一句话描述你想找的素材——支持画面内容、时间、构图、星级、标签、导入来源等条件，
              还可以接着追问收窄（比如「再换成竖图」）。
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
                  onClick={() => send(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'agent-bubble agent-bubble--user max-w-[85%] rounded-lg rounded-br-sm bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] leading-[1.6]'
                  : 'agent-bubble agent-bubble--assistant max-w-[92%] rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 text-[12px] leading-[1.6]'
              }
            >
              <div className={m.error ? 'text-red-400' : ''}>{m.text}</div>

              {/* 错误重试（里程碑 167）：网络/服务抖动后一键重发上一次提问 */}
              {m.error && m.role === 'assistant' && (() => {
                const lastUser = [...messages.slice(0, i)].reverse().find((x) => x.role === 'user')?.text
                return lastUser ? (
                  <button
                    className="mt-1.5 flex items-center gap-1 rounded-sm border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)] disabled:opacity-40"
                    disabled={busy}
                    onClick={() => send(lastUser)}
                  >
                    <Icon name="rotate" size={10} />
                    重试
                  </button>
                ) : null
              })()}

              {m.assets && m.assets.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {m.assets.slice(0, 9).map((a) => (
                    <button
                      key={a.id}
                      className="agent-asset-cell relative aspect-square overflow-hidden rounded-sm border border-[var(--border)] transition-colors duration-100 hover:border-[var(--accent)]"
                      title={`${a.name}（点击预览）`}
                      onClick={() => openPreview(a.id)}
                    >
                      <img
                        src={window.api.thumbnailUrl(a.id)}
                        alt={a.name}
                        loading="lazy"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                      {typeof a.score === 'number' && (
                        <span className="tnum absolute right-0.5 top-0.5 rounded-sm bg-black/70 px-1 text-[9px] leading-[13px] text-white">
                          {a.score}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {m.assets && m.assets.length === 0 && !m.error && m.text && m.total === 0 && (
                <div className="mt-1 text-[11px] text-[var(--text-faint)]">
                  没有找到匹配的素材，换个说法或放宽条件试试
                </div>
              )}

              {typeof m.total === 'number' && m.total > 0 && (
                <div className="tnum mt-1 text-[10.5px] text-[var(--text-faint)]">
                  共 {m.total}
                  {m.truncated ? '+' : ''} 个
                  {(m.assets?.length ?? 0) < m.total ? `，展示前 ${m.assets?.length} 个` : ''}
                  （点击缩略图预览）
                </div>
              )}

              {/* 沉淀动作：结果铺进图库 / 条件存为智能文件夹（里程碑 163） */}
              {m.role === 'assistant' && !m.error && m.total !== undefined && m.total > 0 && m.conditions && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    className="rounded-sm border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
                    onClick={() => void viewInLibrary(m)}
                  >
                    在素材库中查看
                  </button>
                  {/* AI 视觉重排（里程碑 164）："感觉像 XX"类意图无法结构化，用视觉模型对已有结果重排 */}
                  {m.assets && m.assets.length >= 2 && (
                    <span className="flex items-center gap-1.5">
                      <button
                        className="flex items-center gap-1 rounded-sm border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)] disabled:opacity-40"
                        disabled={rerankBusy === i || busy}
                        title="用视觉模型按你的描述对结果重新排序"
                        onClick={() => void rerank(i, m)}
                      >
                        <Icon
                          name="rotate"
                          size={10}
                          className={rerankBusy === i ? 'animate-spin' : ''}
                        />
                        视觉重排
                      </button>
                      {rerankBusy === i && rerankProgress && (
                        <span className="text-[10.5px] text-[var(--text-faint)]">{rerankProgress}</span>
                      )}
                    </span>
                  )}
                  {/* 打标签（里程碑 166）：给本轮全部命中素材打标签，可撤销写操作 */}
                  {m.conditions && m.total !== undefined && m.total > 0 &&
                    (tagFor === i ? (
                      <span className="flex items-center gap-1">
                        <input
                          className="field-input w-[132px] px-1.5 py-0.5 text-[11px]"
                          placeholder="标签名称"
                          aria-label="标签名称"
                          list="agent-tag-suggestions"
                          value={tagName}
                          autoFocus
                          onChange={(e) => setTagName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void tagResults(i, m)
                            if (e.key === 'Escape') setTagFor(null)
                          }}
                        />
                        <datalist id="agent-tag-suggestions">
                          {tags.map((t) => (
                            <option key={t.id} value={t.name} />
                          ))}
                        </datalist>
                        <button
                          className="rounded-sm border border-[var(--accent)] px-2 py-0.5 text-[11px] text-[var(--accent-text)] disabled:opacity-40"
                          disabled={!tagName.trim()}
                          onClick={() => void tagResults(i, m)}
                        >
                          打上
                        </button>
                        <button
                          className="px-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-main)]"
                          aria-label="取消"
                          onClick={() => setTagFor(null)}
                        >
                          ×
                        </button>
                      </span>
                    ) : (
                      <button
                        className="rounded-sm border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
                        onClick={() => {
                          setTagFor(i)
                          setTagName('')
                        }}
                      >
                        打标签
                      </button>
                    ))}
                  {m.smart &&
                    (smartSaveFor === i ? (
                      <span className="flex items-center gap-1">
                        <input
                          className="field-input w-[132px] px-1.5 py-0.5 text-[11px]"
                          placeholder="智能文件夹名称"
                          aria-label="智能文件夹名称"
                          value={smartName}
                          autoFocus
                          onChange={(e) => setSmartName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveSmart(m)
                            if (e.key === 'Escape') setSmartSaveFor(null)
                          }}
                        />
                        <button
                          className="rounded-sm border border-[var(--accent)] px-2 py-0.5 text-[11px] text-[var(--accent-text)]"
                          onClick={() => void saveSmart(m)}
                        >
                          保存
                        </button>
                        <button
                          className="px-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-main)]"
                          aria-label="取消"
                          onClick={() => setSmartSaveFor(null)}
                        >
                          ×
                        </button>
                      </span>
                    ) : (
                      <button
                        className="rounded-sm border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
                        onClick={() => {
                          setSmartSaveFor(i)
                          setSmartName(m.query ?? '助手收藏')
                        }}
                      >
                        存为智能文件夹
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-faint)]">
            <Icon name="rotate" size={12} className="animate-spin" />
            {streamTail ? (
              <span className="mono min-w-0 flex-1 truncate" title={streamTail}>
                {streamTail}
              </span>
            ) : (
              '正在理解你的描述…'
            )}
          </div>
        )}
      </div>

      <footer className="agent-panel__composer border-t border-[var(--border)] p-2">
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            className="field-input min-w-0 flex-1 text-[12px]"
            placeholder="描述你想找的素材，回车发送"
            aria-label="找图助手输入框"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) send()
            }}
          />
          {/* 看图追问开关:开启后追问附带最近一轮结果的缩略图(有结果时才可用) */}
          {(() => {
            const hasLastAssets = [...messages].reverse().some((m) => m.role === 'assistant' && m.assets?.length)
            if (!hasLastAssets) return null
            return (
              <button
                className={`shrink-0 rounded-sm border px-2 text-[11px] transition-colors duration-100 disabled:opacity-40 ${
                  attachImages
                    ? 'border-[var(--accent)] text-[var(--accent-text)]'
                    : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent-text)]'
                }`}
                disabled={busy}
                title="开启后，下一条追问会附带最近一轮结果的缩略图给 AI 看"
                aria-pressed={attachImages}
                onClick={() => setAttachImages((v) => !v)}
              >
                <Icon name="eye" size={12} />
              </button>
            )
          })()}
          <button
            className="btn-ghost shrink-0 disabled:opacity-40"
            disabled={busy || !input.trim()}
            onClick={() => send()}
          >
            发送
          </button>
        </div>
      </footer>
      </>
      )}
    </aside>
  )
}
