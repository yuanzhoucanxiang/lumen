import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { useLibraryStore } from '../stores/libraryStore'
import type { AgentAssetBrief, AgentChatTurn } from '@shared/types'

interface AgentMsg {
  role: 'user' | 'assistant'
  text: string
  assets?: AgentAssetBrief[]
  total?: number
  truncated?: boolean
  error?: boolean
}

/** 空态示例提示（点击填入输入框） */
const EXAMPLES = [
  '最近一周导入的竖构图',
  '还没打过标签的素材',
  'AI 助手导入的图',
  '帮我找星标 4 星以上的横图'
]

/** IPC 错误消息去掉 Electron 包装前缀，给用户看干净的原因 */
function cleanError(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^Error:\s*/, '')
}

/**
 * 找图助手（里程碑 161）：右侧对话抽屉——自然语言多轮找图。
 * 只读：模型输出结构化条件 -> 主进程查库 -> 结果缩略图直接预览。
 * 多轮上下文由本组件持有（assistant 项回传模型原始 JSON，保持条件连续性）。
 */
export default function AgentPanel() {
  const openPreview = useLibraryStore((s) => s.openPreview)
  const closeAgentPanel = useLibraryStore((s) => s.closeAgentPanel)
  const [messages, setMessages] = useState<AgentMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const historyRef = useRef<AgentChatTurn[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = async (preset?: string) => {
    const q = (preset ?? input).trim()
    if (!q || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const r = await window.api.agentChat(historyRef.current, q)
      // assistant 历史回传模型原始输出（含条件 JSON），下一轮才能在此条件上继续调整
      historyRef.current = [
        ...historyRef.current,
        { role: 'user' as const, content: q },
        { role: 'assistant' as const, content: r.raw || r.reply }
      ].slice(-20)
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: r.reply, assets: r.assets, total: r.total, truncated: r.truncated }
      ])
    } catch (e) {
      const msg = cleanError(e)
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: msg.includes('未配置 AI')
            ? `${msg}（设置 → AI 智能处理 里填写 Base URL / 模型 / API Key 后即可使用）`
            : `出错了：${msg}`,
          error: true
        }
      ])
    } finally {
      setBusy(false)
    }
  }

  const clearChat = () => {
    historyRef.current = []
    setMessages([])
  }

  return (
    <aside
      className="anim-slide-left fixed right-0 top-0 z-[140] flex h-full w-[384px] flex-col border-l border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl"
      aria-label="找图助手"
      data-testid="agent-panel"
    >
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Icon name="chat" size={13} className="text-[var(--accent-text)]" />
          <span className="text-[12px] font-medium">找图助手</span>
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
                  onClick={() => void send(ex)}
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
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
            }}
          />
          <button
            className="btn-ghost shrink-0 disabled:opacity-40"
            disabled={busy || !input.trim()}
            onClick={() => void send()}
          >
            发送
          </button>
        </div>
      </footer>
    </aside>
  )
}
