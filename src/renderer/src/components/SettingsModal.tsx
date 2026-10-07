import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useLibraryStore } from '../stores/libraryStore'
import { SHORTCUT_DEFS, eventToKeys, loadShortcuts, saveShortcut } from '../shortcuts'
import { applyTheme, THEMES, useTheme } from '../theme'
import type { AppSettings, Tag } from '@shared/types'
import UserGuide from './UserGuide'
import RestoreDialog from './RestoreDialog'

/** AI 提供商预置（里程碑 178）：一键填 Base URL + 建议模型（OpenCode Go/Zen 为 OpenAI 兼容网关） */
const AI_PROVIDERS: { name: string; baseUrl: string; models: string[] }[] = [
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4v-flash', 'glm-4v-plus'] },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro'] },
  { name: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go/v1', models: ['glm-5.3-flash', 'grok-4.7', 'kimi-k3', 'deepseek-v4-pro', 'minimax-m3', 'qwen3.8-max', 'mimo-v2.6-pro'] },
  { name: 'OpenCode Zen', baseUrl: 'https://opencode.ai/zen/v1', models: ['gpt-5.5', 'claude-opus-5', 'gemini-3.1-pro', 'grok-4.7'] },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-vl-max', 'qwen-vl-plus'] },
  { name: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['llava', 'moondream'] }
]

type SettingsPage = 'preferences' | 'guide'

/** 快捷键录制按钮：点击后按新键位保存，Esc 取消 */
function ShortcutRecorder({ actionId }: { actionId: string }) {
  const [binding, setBinding] = useState('')
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    setBinding(loadShortcuts()[actionId] ?? '')
  }, [actionId])

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      // 忽略纯修饰键
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
      const keys = eventToKeys(e)
      saveShortcut(actionId, keys)
      setBinding(keys)
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, actionId])

  return (
    <button
      aria-label={`修改快捷键 ${SHORTCUT_DEFS.find((d) => d.id === actionId)?.label}`}
      className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors duration-100 ${
        recording
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
          : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--border-strong)] hover:text-[var(--text-main)]'
      }`}
      onClick={() => setRecording(true)}
    >
      {recording ? '按下新键位…' : binding}
    </button>
  )
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  const [activePage, setActivePage] = useState<SettingsPage>('preferences')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [backing, setBacking] = useState(false)
  const [aiKeyInput, setAiKeyInput] = useState('')
  const [aiTesting, setAiTesting] = useState(false)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagSearch, setTagSearch] = useState('')
  const [restoreOpen, setRestoreOpen] = useState(false)
  /** 服务商档案（里程碑 179） */
  const [profileName, setProfileName] = useState('')
  const [profileDeletePending, setProfileDeletePending] = useState<string | null>(null)
  const [skillInstalling, setSkillInstalling] = useState(false)
  const [skillStatus, setSkillStatus] = useState<{ installed: boolean; upToDate: boolean } | null>(null)

  useEffect(() => {
    void window.api.agentSkillStatus().then(setSkillStatus).catch(() => setSkillStatus(null))
  }, [])

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
    void window.api.getAppVersion().then(setVersion)
    void window.api.listTags().then(setTags)
  }, [])

  const doCheck = async () => {
    setChecking(true)
    try {
      await window.api.checkUpdate()
    } finally {
      setChecking(false)
    }
  }

  const update = async (patch: Partial<AppSettings>) => {
    try {
      const next = await window.api.updateSettings(patch)
      setSettings(next)
    } catch (e) {
      useLibraryStore.getState().showToast(`设置保存失败: ${(e as Error).message}`)
      // 回读实际生效值，避免 UI 与主进程状态不一致
      void window.api.getSettings().then(setSettings)
    }
  }

  const addWatchDir = async () => {
    const dir = await window.api.chooseWatchDir()
    if (dir && settings && !settings.watchDirs.includes(dir)) {
      await update({ watchDirs: [...settings.watchDirs, dir] })
    }
  }

  const backupDb = async () => {
    setBacking(true)
    try {
      await window.api.backupDatabase()
      useLibraryStore.getState().showToast('数据库已备份')
    } catch {
      useLibraryStore.getState().showToast('备份失败,请查看日志')
    } finally {
      setBacking(false)
    }
  }

  const backupZip = async () => {
    setBacking(true)
    try {
      const r = await window.api.backupLibraryToZip()
      if (r) useLibraryStore.getState().showToast(`已备份 ${r.count} 个文件到 ${r.target}`)
    } catch {
      useLibraryStore.getState().showToast('备份失败,请查看日志')
    } finally {
      setBacking(false)
    }
  }

  // 保存 AI key(输入框非空时保存,空串清除)
  const saveAiKey = async () => {
    await update({ aiApiKey: aiKeyInput })
    setAiKeyInput('')
    useLibraryStore.getState().showToast(aiKeyInput ? 'API Key 已保存' : 'API Key 已清除')
  }

  const testAi = async () => {
    if (!settings) return
    setAiTesting(true)
    try {
      // 测试时用输入框的 key(若填了)否则用已保存的 key
      const key = aiKeyInput || ''
      if (!key && !settings.aiHasKey) {
        useLibraryStore.getState().showToast('请先填写 API Key')
        return
      }
      const r = await window.api.aiTestKey({
        baseUrl: settings.aiBaseUrl || 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: key,
        model: settings.aiModel || 'glm-4v'
      })
      useLibraryStore.getState().showToast(r.ok ? '连接成功' : `连接失败:${r.message}`)
    } finally {
      setAiTesting(false)
    }
  }

  /** 保存当前 AI 配置为服务商档案（同名更新） */
  const saveProfile = async () => {
    try {
      setSettings(await window.api.aiProfileSave(profileName.trim()))
      setProfileName('')
      useLibraryStore.getState().showToast('已保存该服务商配置')
    } catch (e) {
      useLibraryStore.getState().showToast(`保存失败：${(e as Error).message}`)
    }
  }

  /** 切换到已保存的服务商（不用重填 Key） */
  const activateProfile = async (name: string) => {
    try {
      setSettings(await window.api.aiProfileActivate(name))
      setAiKeyInput('')
      useLibraryStore.getState().showToast(`已切换到「${name}」`)
    } catch (e) {
      useLibraryStore.getState().showToast(`切换失败：${(e as Error).message}`)
    }
  }

  /** 删除档案（两次点击确认，防误删带 Key 的配置） */
  const deleteProfile = async (name: string) => {
    if (profileDeletePending !== name) {
      setProfileDeletePending(name)
      return
    }
    setProfileDeletePending(null)
    try {
      setSettings(await window.api.aiProfileDelete(name))
      useLibraryStore.getState().showToast(`已删除「${name}」`)
    } catch (e) {
      useLibraryStore.getState().showToast(`删除失败：${(e as Error).message}`)
    }
  }

  /** 一键安装 lumen 技能到本机 agent 技能目录(设置 → Agent 接入) */
  const installSkill = async () => {
    setSkillInstalling(true)
    try {
      const r = await window.api.installAgentSkill()
      useLibraryStore.getState().showToast(r.installed.length === 1 ? `技能已安装到 ${r.installed[0]}` : `技能已安装到 ${r.installed.length} 个 Agent 目录`)
    } catch {
      useLibraryStore.getState().showToast('技能安装失败，请查看日志')
    } finally {
      setSkillInstalling(false)
    }
  }

  /** AI 优先标签：勾选/取消（复用标签 priority 标记，与标签管理里的 ⭐ 同步） */
  const togglePriority = async (id: number, on: boolean) => {
    await window.api.setTagPriority(id, on ? 1 : 0)
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, priority: on ? 1 : 0 } : t)))
    useLibraryStore.getState().showToast(on ? '已加入 AI 优先标签' : '已移出 AI 优先标签')
  }

  const priorityTags = tags
    .filter((t) => t.priority === 1)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const kw = tagSearch.trim().toLowerCase()
  const candidateTags = tags
    .filter((t) => t.priority !== 1)
    .filter((t) => !kw || t.name.toLowerCase().includes(kw))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))

  if (!settings) return null

  return (
    <div
      className="anim-overlay overlay fixed inset-0 z-[400] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="设置与帮助"
        className="settings-sheet settings-hub anim-dialog dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-hub__header">
          <div>
            <span className="settings-hub__kicker mono">LUMEN / CONTROL ROOM</span>
            <h2>设置与帮助</h2>
          </div>
          <button
            aria-label="关闭设置与帮助"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        <div className="settings-hub__body">
          <aside className="settings-hub__nav" aria-label="设置页面">
            <button
              className={activePage === 'preferences' ? 'is-active' : ''}
              aria-current={activePage === 'preferences' ? 'page' : undefined}
              onClick={() => setActivePage('preferences')}
            >
              <Icon name="settings" size={15} />
              <span>
                <strong>偏好设置</strong>
                <small>主题 · 导入 · AI</small>
              </span>
            </button>
            <button
              className={activePage === 'guide' ? 'is-active' : ''}
              aria-current={activePage === 'guide' ? 'page' : undefined}
              onClick={() => setActivePage('guide')}
            >
              <Icon name="library" size={15} />
              <span>
                <strong>使用说明</strong>
                <small>9 章完整教程</small>
              </span>
            </button>

            <div className="settings-hub__nav-foot">
              <span className="mono">LOCAL MANUAL</span>
              <small>教程已内置，可离线阅读</small>
            </div>
          </aside>

          <section className="settings-hub__content">
          {activePage === 'preferences' ? (
          /* 可滚动内容区（高度超出时内部滚动，标题与底部按钮固定） */
          <div className="settings-preferences modal-scroll min-h-0 flex-1 space-y-5 overflow-y-auto">
        {/* 主题 */}
        <section className="settings-module theme-settings" data-code="00 / INTERFACE" aria-labelledby="theme-settings-title">
          <div className="mb-2 flex items-end justify-between gap-4">
            <div>
              <div id="theme-settings-title" className="section-title">主题</div>
              <p className="mt-1 text-[11px] text-[var(--text-dim)]">切换完整的界面语言，包括字体、比例、组件轮廓与动效。</p>
            </div>
            <span className="mono shrink-0 text-[9px] tracking-[0.12em] text-[var(--text-faint)]">LIVE PREVIEW</span>
          </div>
          <div className="theme-choice-grid grid gap-2" role="radiogroup" aria-label="界面主题">
            {THEMES.map((item) => {
              const active = theme === item.id
              return (
                <button
                  key={item.id}
                  role="radio"
                  aria-checked={active}
                  className={`theme-choice ${active ? 'is-active' : ''}`}
                  onClick={() => {
                    applyTheme(item.id)
                    useLibraryStore.getState().showToast(`已切换到「${item.name}」`)
                  }}
                >
                  <span className="theme-choice__preview" data-preview-theme={item.id} aria-hidden="true">
                    <span className="theme-choice__rail" />
                    <span className="theme-choice__head" />
                    <span className="theme-choice__card one" />
                    <span className="theme-choice__card two" />
                    <span className="theme-choice__signal" />
                  </span>
                  <span className="flex items-start justify-between gap-3">
                    <span>
                      <strong className="block text-[12px] font-semibold text-[var(--text-main)]">{item.name}</strong>
                      <span className="mono mt-0.5 block text-[9px] tracking-[0.12em] text-[var(--text-faint)]">{item.code}</span>
                    </span>
                    {item.standard && <span className="theme-choice__standard">默认标准</span>}
                  </span>
                  <span className="mt-2 block text-left text-[10.5px] leading-[1.55] text-[var(--text-dim)]">{item.description}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* 导入模式 */}
        <div className="settings-module" data-code="01 / INGEST">
          <div className="section-title mb-2">导入方式</div>
          <div className="flex gap-2" role="radiogroup" aria-label="导入方式">
            <button
              role="radio"
              aria-checked={settings.importMode === 'copy'}
              className={`flex-1 rounded-sm border px-3 py-2.5 text-left text-[12px] transition-colors duration-100 ${
                settings.importMode === 'copy'
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => void update({ importMode: 'copy' })}
            >
              <div className="font-medium">复制文件（推荐）</div>
              <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">保留原文件，复制一份到素材库</div>
            </button>
            <button
              role="radio"
              aria-checked={settings.importMode === 'move'}
              className={`flex-1 rounded-sm border px-3 py-2.5 text-left text-[12px] transition-colors duration-100 ${
                settings.importMode === 'move'
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => void update({ importMode: 'move' })}
            >
              <div className="font-medium">移动文件</div>
              <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">导入后删除原位置的文件</div>
            </button>
          </div>
        </div>

        {/* 监控文件夹 */}
        <div className="settings-module" data-code="02 / WATCH">
          <div className="mb-2 flex items-center justify-between">
            <div className="section-title">监控文件夹（自动导入）</div>
            <button
              className="flex items-center gap-1 rounded-md bg-[var(--bg-hover)] px-2.5 py-1 text-[11px] transition-colors duration-100 hover:bg-[var(--bg-active)] hover:text-[var(--accent-text)]"
              onClick={() => void addWatchDir()}
            >
              <Icon name="plus" size={11} strokeWidth={2.2} />
              添加
            </button>
          </div>
          <div className="space-y-1.5">
            {settings.watchDirs.map((d) => (
              <div
                key={d}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 text-[12px]"
              >
                <Icon name="folder" size={13} className="shrink-0 text-[var(--text-faint)]" />
                <span className="min-w-0 truncate" title={d}>
                  {d}
                </span>
                <button
                  aria-label={`移除监控目录 ${d}`}
                  className="ml-auto flex items-center text-[var(--text-dim)] hover:text-red-400"
                  onClick={() => void update({ watchDirs: settings.watchDirs.filter((x) => x !== d) })}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
            {settings.watchDirs.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border-strong)] px-2.5 py-2.5 text-[11px] text-[var(--text-faint)]">
                可同时监控多个文件夹；每个文件夹（含子目录）中新增的图片/视频会自动导入素材库
              </div>
            )}
          </div>
        </div>

        {/* 备份 */}
        <div className="settings-module border-t border-[var(--border)] pt-4" data-code="03 / ARCHIVE">
          <div className="section-title mb-2">备份</div>
          <div className="mb-2 text-[11px] text-[var(--text-dim)]">
            启动时已自动备份数据库；也可手动备份数据库或导出完整库（含原图）为 ZIP。
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost disabled:opacity-40"
              disabled={backing}
              onClick={() => void backupDb()}
            >
              {backing ? '处理中…' : '备份数据库'}
            </button>
            <button
              className="btn-ghost disabled:opacity-40"
              disabled={backing}
              onClick={() => void backupZip()}
            >
              {backing ? '处理中…' : '导出完整库 ZIP'}
            </button>
            <button className="btn-ghost" onClick={() => setRestoreOpen(true)}>
              从备份恢复…
            </button>
            <button
              className="btn-ghost"
              onClick={async () => {
                const p = await window.api.exportLogs()
                if (p) useLibraryStore.getState().showToast(`日志已导出到 ${p}`)
              }}
            >
              导出运行日志
            </button>
          </div>
        </div>

        {/* AI 智能处理 */}
        <div className="settings-module border-t border-[var(--border)] pt-4" data-code="04 / MODEL">
          <div className="section-title mb-2">AI 智能处理</div>
          <div className="mb-2 text-[11px] text-[var(--text-dim)]">
            配置后可批量为素材自动生成文件名和标签（OpenAI 兼容格式，支持智谱 GLM-4V / 通义 / Ollama 等）。
          </div>
          <div className="space-y-2">
            <div>
              <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">快速选择服务商</label>
              <div className="flex flex-wrap gap-1.5">
                {AI_PROVIDERS.map((p) => (
                  <button
                    key={p.name}
                    className={`rounded-sm border px-2 py-0.5 text-[11px] transition-colors duration-100 ${
                      (settings.aiBaseUrl || '').startsWith(p.baseUrl)
                        ? 'border-[var(--accent)] text-[var(--accent-text)]'
                        : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent-text)]'
                    }`}
                    title={p.baseUrl}
                    onClick={() =>
                      void update({
                        aiBaseUrl: p.baseUrl,
                        ...(p.models.includes(settings.aiModel || '') ? {} : { aiModel: p.models[0] })
                      })
                    }
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  className="field-input min-w-0 flex-1 text-[12px]"
                  placeholder="服务商名称（留空按 Base URL 自动命名）"
                  aria-label="服务商档案名称"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
                <button className="btn-ghost shrink-0" onClick={() => void saveProfile()}>
                  保存当前配置
                </button>
              </div>
            </div>
            {(settings.aiProfiles?.length ?? 0) > 0 && (
              <div>
                <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">
                  已保存的服务商（点击切换，不用重填 Key；切换前可先保存当前配置）
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(settings.aiProfiles ?? []).map((p) => {
                    const active =
                      (settings.aiBaseUrl || '').startsWith(p.baseUrl) && (settings.aiModel || '') === p.model
                    return (
                      <span
                        key={p.name}
                        className={`flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] ${
                          active
                            ? 'border-[var(--accent)] text-[var(--accent-text)]'
                            : 'border-[var(--border)] text-[var(--text-dim)]'
                        }`}
                      >
                        <button
                          className="flex items-center gap-1 transition-colors duration-100 hover:text-[var(--accent-text)]"
                          title={`${p.baseUrl} · ${p.model}${p.hasKey ? ` · Key ···${p.keyTail}` : ' · 无 Key'}`}
                          onClick={() => void activateProfile(p.name)}
                        >
                          {active && <Icon name="check" size={10} />}
                          {p.name}
                        </button>
                        <button
                          className={`flex text-[10px] transition-colors duration-100 ${
                            profileDeletePending === p.name
                              ? 'text-red-400'
                              : 'text-[var(--text-faint)] hover:text-red-400'
                          }`}
                          aria-label={`删除服务商 ${p.name}`}
                          title={profileDeletePending === p.name ? '再点一次确认删除' : '删除该服务商档案'}
                          onClick={() => void deleteProfile(p.name)}
                        >
                          {profileDeletePending === p.name ? '确认删除' : '×'}
                        </button>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
            <div>
              <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">Base URL</label>
              <input
                className="field-input w-full text-[12px]"
                value={settings.aiBaseUrl || ''}
                placeholder="https://open.bigmodel.cn/api/paas/v4"
                list="ai-baseurl-presets"
                onChange={(e) => void update({ aiBaseUrl: e.target.value })}
              />
              <datalist id="ai-baseurl-presets">
                {AI_PROVIDERS.map((p) => (
                  <option key={p.baseUrl} value={p.baseUrl} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">模型</label>
              <input
                className="field-input w-full text-[12px]"
                value={settings.aiModel || ''}
                placeholder="glm-4v"
                list="ai-model-presets"
                onChange={(e) => void update({ aiModel: e.target.value })}
              />
              {/* 常见视觉模型预设(可自由输入,不限于列表) */}
              <datalist id="ai-model-presets">
                {[...new Set(AI_PROVIDERS.flatMap((p) => p.models))].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">
                API Key{settings.aiHasKey && <span className="ml-1 text-[var(--accent-text)]">（已配置 ···{settings.aiKeyTail}）</span>}
              </label>
              <div className="flex gap-2">
                <input
                  className="field-input flex-1 text-[12px]"
                  type="password"
                  value={aiKeyInput}
                  placeholder={settings.aiHasKey ? '输入新 Key 覆盖（留空不变）' : '粘贴 API Key'}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                />
                <button
                  className="btn-ghost shrink-0 disabled:opacity-40"
                  disabled={!aiKeyInput}
                  onClick={() => void saveAiKey()}
                >
                  保存
                </button>
              </div>
            </div>
            <button
              className="btn-ghost disabled:opacity-40"
              disabled={aiTesting || (!aiKeyInput && !settings.aiHasKey)}
              onClick={() => void testAi()}
            >
              {aiTesting ? '测试中…' : '测试连接'}
            </button>
          </div>

          {/* AI 优先标签（大标签） */}
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] text-[var(--text-dim)]">
                AI 优先标签（大标签）
                {priorityTags.length > 0 && (
                  <span className="ml-1 text-[var(--accent-text)]">已选 {priorityTags.length} 个</span>
                )}
              </label>
            </div>
            <p className="mb-2 text-[10.5px] leading-[1.5] text-[var(--text-faint)]">
              AI 打标签时，内容匹配到这些标签就优先选用。此处与「标签管理」里的 ⭐ 是同一标记，两处同步；建议选 3-8 个。
            </p>
            {priorityTags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {priorityTags.map((t) => (
                  <span key={t.id} className="ai-priority-chip" style={t.color ? { borderColor: t.color } : undefined}>
                    <span className="max-w-[140px] truncate">{t.name}</span>
                    <button
                      aria-label={`移出优先标签 ${t.name}`}
                      className="flex text-[var(--text-faint)] transition-colors hover:text-red-400"
                      onClick={() => void togglePriority(t.id, false)}
                    >
                      <Icon name="close" size={10} strokeWidth={2.4} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              className="field-input mb-1.5 w-full text-[12px]"
              aria-label="搜索AI优先标签"
              value={tagSearch}
              placeholder="搜索标签，点击加入优先列表…"
              onChange={(e) => setTagSearch(e.target.value)}
            />
            <div className="ai-priority-pool">
              {candidateTags.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--border-strong)] px-2.5 py-2 text-[11px] text-[var(--text-faint)]">
                  {tags.length === 0 ? '还没有标签，可先在「标签管理」中新建' : '没有匹配的标签'}
                </div>
              ) : (
                candidateTags.map((t) => (
                  <button key={t.id} className="ai-priority-option" onClick={() => void togglePriority(t.id, true)}>
                    <span className="min-w-0 flex-1 truncate text-left">{t.name}</span>
                    {t.count > 0 && <span className="tnum shrink-0 text-[10px] text-[var(--text-faint)]">{t.count}</span>}
                    <Icon name="plus" size={11} className="shrink-0 text-[var(--text-faint)]" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 快捷键 */}
        <div className="settings-module border-t border-[var(--border)] pt-4" data-code="05 / INPUT">
          <div className="section-title mb-2">快捷键</div>
          <div className="space-y-1.5">
            {SHORTCUT_DEFS.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--text-dim)]">{d.label}</span>
                <ShortcutRecorder actionId={d.id} />
              </div>
            ))}
          </div>
        </div>

        {/* Agent 接入 */}
        <div className="settings-module border-t border-[var(--border)] pt-4" data-code="06 / AGENT">
          <div className="section-title mb-2">Agent 接入</div>
          <div className="mb-2 text-[11px] text-[var(--text-dim)]">
            LUMEN 自带一套「lumen」技能，AI 助手（如 ZCode、Claude Code）装上后即可把散落各处的图片批量收进素材库，自动打标签、归文件夹。不使用 AI 助手可忽略本节。
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost disabled:opacity-40" disabled={skillInstalling} onClick={() => void installSkill()}>
              {skillInstalling ? '安装中…' : skillStatus?.installed && !skillStatus.upToDate ? '更新技能' : '安装技能到本机 Agent'}
            </button>
            <button className="btn-ghost" onClick={() => void window.api.openAgentSkillFolder()}>
              打开技能文件夹
            </button>
          </div>
          {skillStatus && (
            <div className="mt-1.5 text-[10.5px] leading-[1.5]">
              {skillStatus.installed ? (
                skillStatus.upToDate ? (
                  <span className="text-[var(--accent-text)]">技能已安装，版本最新</span>
                ) : (
                  <span className="text-[var(--warning, #e0a83c)]">技能有新版本，点「更新技能」即可</span>
                )
              ) : (
                <span className="text-[var(--text-faint)]">尚未安装</span>
              )}
            </div>
          )}
          <div className="mt-1.5 text-[10.5px] leading-[1.5] text-[var(--text-faint)]">
            安装到 ~/.agents/skills/lumen（检测到 Claude Code 时同步写入 ~/.claude/skills/lumen）；
            用了其他 AI 工具可打开技能文件夹手动复制。LUMEN 更新后可重新安装获取新版技能。
            Agent 导入的素材默认归入「Agent 导入」文件夹，与您自己的素材分开。
          </div>
        </div>

        {/* 关于 / 更新 */}
        <div className="settings-module flex items-center justify-between border-t border-[var(--border)] pt-4" data-code="07 / SYSTEM">
          <div>
            <div className="section-title mb-1">关于</div>
            <div className="mono text-[12px] text-[var(--text-dim)]">
              LUMEN <span className="tnum">v{version}</span>
            </div>
          </div>
          <button
            className="btn-ghost disabled:opacity-40"
            disabled={checking}
            onClick={() => void doCheck()}
          >
            {checking ? '检查中…' : '检查更新'}
          </button>
        </div>
          </div>
          ) : (
            <UserGuide />
          )}
          </section>
        </div>

        <div className="settings-hub__footer">
          <span className="mono">{activePage === 'guide' ? 'USER MANUAL / OFFLINE' : `LUMEN v${version}`}</span>
          <button className="btn-primary" onClick={onClose}>
            完成
          </button>
        </div>

        {restoreOpen && <RestoreDialog onClose={() => setRestoreOpen(false)} />}
      </div>
    </div>
  )
}
