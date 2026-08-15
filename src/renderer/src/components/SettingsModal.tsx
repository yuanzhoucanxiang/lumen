import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useLibraryStore } from '../stores/libraryStore'
import { SHORTCUT_DEFS, eventToKeys, loadShortcuts, saveShortcut } from '../shortcuts'
import { applyTheme, THEMES, useTheme } from '../theme'
import type { AppSettings } from '@shared/types'
import UserGuide from './UserGuide'

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

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
    void window.api.getAppVersion().then(setVersion)
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
    const next = await window.api.updateSettings(patch)
    setSettings(next)
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
        <section className="theme-settings" aria-labelledby="theme-settings-title">
          <div className="mb-2 flex items-end justify-between gap-4">
            <div>
              <div id="theme-settings-title" className="section-title">主题</div>
              <p className="mt-1 text-[11px] text-[var(--text-dim)]">切换完整的界面语言，包括字体、比例、组件轮廓与动效。</p>
            </div>
            <span className="mono shrink-0 text-[9px] tracking-[0.12em] text-[var(--text-faint)]">LIVE PREVIEW</span>
          </div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="界面主题">
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
        <div>
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
        <div>
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
        <div className="border-t border-[var(--border)] pt-4">
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
        <div className="border-t border-[var(--border)] pt-4">
          <div className="section-title mb-2">AI 智能处理</div>
          <div className="mb-2 text-[11px] text-[var(--text-dim)]">
            配置后可批量为素材自动生成文件名和标签（OpenAI 兼容格式，支持智谱 GLM-4V / 通义 / Ollama 等）。
          </div>
          <div className="space-y-2">
            <div>
              <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">Base URL</label>
              <input
                className="field-input w-full text-[12px]"
                value={settings.aiBaseUrl || ''}
                placeholder="https://open.bigmodel.cn/api/paas/v4"
                onChange={(e) => void update({ aiBaseUrl: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">模型</label>
              <input
                className="field-input w-full text-[12px]"
                value={settings.aiModel || ''}
                placeholder="glm-4v"
                onChange={(e) => void update({ aiModel: e.target.value })}
              />
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
        </div>

        {/* 快捷键 */}
        <div className="border-t border-[var(--border)] pt-4">
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

        {/* 关于 / 更新 */}
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
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
      </div>
    </div>
  )
}
