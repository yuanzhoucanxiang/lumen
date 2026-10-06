import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { useLibraryStore, type AgentMsg } from '../stores/libraryStore'

/** 空态示例提示（点击直接发送） */
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
  const [input, setInput] = useState('')
  const [smartSaveFor, setSmartSaveFor] = useState<number | null>(null)
  const [smartName, setSmartName] = useState('')
  const [rerankBusy, setRerankBusy] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
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
    void useLibraryStore.getState().agentSend(q)
  }

  const clearChat = () => {
    setSmartSaveFor(null)
    useLibraryStore.getState().agentClearChat()
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

  /** 把本轮条件存成智能文件夹（结果自动更新，可长期复用） */
  const saveSmart = async (m: AgentMsg) => {
    if (!m.smart) return
    const name = smartName.trim() || '助手收藏'
    try {
      await window.api.createFolder(name, null, 1, JSON.stringify(m.smart))
      await useLibraryStore.getState().refreshFolders()
      useLibraryStore.getState().showToast(`已创建智能文件夹「${name}」`)
      setSmartSaveFor(null)
    } catch (e) {
      useLibraryStore.getState().showToast(`创建失败：${String((e as Error)?.message ?? e)}`)
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

  return (
    <aside
      className="anim-slide-left fixed right-0 top-0 z-[140] flex h-full w-[384px] flex-col border-l border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl"
      aria-label="找图助手"
      data-testid="agent-panel"
    >
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Icon name="assistant" size={13} className="text-[var(--accent-text)]" />
          <span className="text-[12px] font-medium">助手</span>
          <span className="text-[10px] text-[var(--text-faint)]">对话式找图</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
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
                  ? 'max-w-[85%] rounded-lg rounded-br-sm bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] leading-[1.6]'
                  : 'max-w-[92%] rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 text-[12px] leading-[1.6]'
              }
            >
              <div className={m.error ? 'text-red-400' : ''}>{m.text}</div>

              {m.assets && m.assets.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {m.assets.slice(0, 9).map((a) => (
                    <button
                      key={a.id}
                      className="relative aspect-square overflow-hidden rounded-sm border border-[var(--border)] transition-colors duration-100 hover:border-[var(--accent)]"
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
                  )}
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
            正在理解你的描述…
          </div>
        )}
      </div>

      <footer className="border-t border-[var(--border)] p-2">
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
          <button
            className="btn-ghost shrink-0 disabled:opacity-40"
            disabled={busy || !input.trim()}
            onClick={() => send()}
          >
            发送
          </button>
        </div>
      </footer>
    </aside>
  )
}
