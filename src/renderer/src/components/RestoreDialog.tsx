import { useEffect, useState } from 'react'
import Icon from './Icon'
import ConfirmDialog from './ConfirmDialog'
import { useLibraryStore } from '../stores/libraryStore'
import type { DbBackupInfo, ZipBackupInfo } from '@shared/types'

/** 格式化字节大小 */
function fmtSize(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

/** 格式化本地时间(到分钟) */
function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 从备份恢复对话框:列出数据库快照(library.db.bak 系列)供回滚,
 * 自动全量 ZIP 只读展示+打开位置。恢复前经 ConfirmDialog 二次确认。
 */
export default function RestoreDialog({ onClose }: { onClose: () => void }) {
  const [dbBackups, setDbBackups] = useState<DbBackupInfo[]>([])
  const [zips, setZips] = useState<ZipBackupInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    void window.api.listDbBackups().then((list) => {
      setDbBackups(list)
      setSelected(list[0]?.path ?? null)
    })
    void window.api.listAutoZipBackups().then(setZips)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirming) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, confirming])

  const doRestore = async () => {
    if (!selected) return
    setRestoring(true)
    try {
      await window.api.restoreDatabase(selected)
      useLibraryStore.getState().showToast('数据库已从快照恢复')
      await useLibraryStore.getState().refreshAll()
      onClose()
    } catch (e) {
      useLibraryStore.getState().showToast(`恢复失败:${(e as Error).message}`)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div
      className="anim-overlay overlay fixed inset-0 z-[420] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="从备份恢复"
        className="anim-dialog dialog flex max-h-[calc(100vh-32px)] w-[520px] max-w-full flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold">从备份恢复</h2>
            <p className="mt-0.5 text-[11px] text-[var(--text-dim)]">
              用数据库快照覆盖当前库；恢复前会先把当前库存为现场文件（pre-restore），可随时找回。
            </p>
          </div>
          <button
            aria-label="关闭从备份恢复"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="modal-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 数据库快照 */}
          <section>
            <h3 className="section-title mb-2">数据库快照</h3>
            {dbBackups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-2.5 text-[12px] text-[var(--text-faint)]">
                还没有可用快照。每次启动/手动备份都会在库目录生成 library.db.bak（保留最近 3 代）。
              </p>
            ) : (
              <div className="space-y-1.5" role="radiogroup" aria-label="选择数据库快照">
                {dbBackups.map((b, i) => (
                  <button
                    key={b.path}
                    role="radio"
                    aria-checked={selected === b.path}
                    className={`flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[12px] transition-colors duration-100 ${
                      selected === b.path
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
                    }`}
                    onClick={() => setSelected(b.path)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {fmtTime(b.mtimeMs)}
                        <span className="ml-2 text-[10px] text-[var(--text-faint)]">
                          {i === 0 ? '最新' : `更早 ${i} 代`}
                        </span>
                      </span>
                      <span className="tnum mt-0.5 block text-[10.5px] text-[var(--text-faint)]">
                        {fmtSize(b.sizeBytes)} · {b.path.split(/[\\/]/).pop()}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 自动全量 ZIP(只读) */}
          <section>
            <h3 className="section-title mb-2">自动全量备份（ZIP，每周）</h3>
            {zips.length === 0 ? (
              <p className="text-[11.5px] text-[var(--text-faint)]">
                暂无自动全量备份。打包版每周自动生成一次，含原图与完整数据。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {zips.map((z) => (
                  <li
                    key={z.path}
                    className="flex items-center gap-2.5 rounded-md border border-[var(--border)] px-3 py-2 text-[12px]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block">{fmtTime(z.mtimeMs)}</span>
                      <span className="tnum mt-0.5 block text-[10.5px] text-[var(--text-faint)]">{fmtSize(z.sizeBytes)}</span>
                    </span>
                    <button
                      className="btn-ghost shrink-0 px-2 py-1 text-[11px]"
                      onClick={() => void window.api.revealBackup(z.path)}
                    >
                      打开位置
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
              全量 ZIP 含原图等完整数据，暂不支持应用内一键还原；需要时可在文件管理器中解压后替换素材库目录。
            </p>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <span className="text-[11px] leading-snug text-[var(--text-faint)]">
            恢复会关闭并重开数据库，界面将自动刷新。
          </span>
          <button
            className="btn-danger disabled:opacity-40"
            disabled={!selected || restoring}
            onClick={() => setConfirming(true)}
          >
            {restoring ? '恢复中…' : '恢复选中快照'}
          </button>
        </footer>

        {confirming && selected && (
          <ConfirmDialog
            title="确认恢复数据库？"
            message={`即将用所选快照覆盖当前素材库的数据库。\n\n· 当前库会先另存为 pre-restore 现场文件，误操作可找回\n· 恢复后素材列表、标签、白板引用将回到快照时点\n· 快照之后新导入的素材不会出现在列表中（原文件仍在磁盘）`}
            confirmLabel="确认恢复"
            danger
            onConfirm={() => void doRestore()}
            onClose={() => setConfirming(false)}
          />
        )}
      </div>
    </div>
  )
}
