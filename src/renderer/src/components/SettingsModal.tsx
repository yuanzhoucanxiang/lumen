import { useEffect, useState } from 'react'
import Icon from './Icon'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<{ watchDirs: string[]; importMode: 'copy' | 'move' } | null>(null)
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)

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

  const update = async (patch: { watchDirs?: string[]; importMode?: 'copy' | 'move' }) => {
    const next = await window.api.updateSettings(patch)
    setSettings(next)
  }

  const addWatchDir = async () => {
    const dir = await window.api.chooseWatchDir()
    if (dir && settings && !settings.watchDirs.includes(dir)) {
      await update({ watchDirs: [...settings.watchDirs, dir] })
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
        aria-label="设置"
        className="anim-dialog dialog w-[480px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">设置</h2>
          <button
            aria-label="关闭设置"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        {/* 导入模式 */}
        <div className="mb-5">
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
        <div className="mb-2">
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

        {/* 关于 / 更新 */}
        <div className="mt-5 flex items-center justify-between border-t border-[var(--border)] pt-4">
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

        <div className="mt-5 flex justify-end">
          <button className="btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
