import { useEffect, useState } from 'react'
import { useLibraryStore } from './stores/libraryStore'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import Gallery from './components/Gallery'
import Inspector from './components/Inspector'
import Preview from './components/Preview'
import Editor from './components/Editor'
import ScrambleText from './components/ScrambleText'
import ConfirmDialog from './components/ConfirmDialog'
import UpdateNotes from './components/UpdateNotes'
import type { UpdateStatus } from '@shared/types'

let clipListenerRegistered = false

export default function App() {
  const refreshAll = useLibraryStore((s) => s.refreshAll)
  const importFiles = useLibraryStore((s) => s.importFiles)
  const toast = useLibraryStore((s) => s.toast)
  const previewId = useLibraryStore((s) => s.previewId)
  const editorId = useLibraryStore((s) => s.editorId)
  const [dragOver, setDragOver] = useState(false)
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [updDismissed, setUpdDismissed] = useState(false)

  useEffect(() => {
    void refreshAll()
    // 浏览器剪藏导入后自动刷新
    if (!clipListenerRegistered) {
      clipListenerRegistered = true
      window.api.onClipImported((count) => {
        useLibraryStore.getState().showToast(`剪藏成功：已导入 ${count} 张图片`)
        void useLibraryStore.getState().refreshAll()
      })
    }
    // 自动更新状态
    window.api.onUpdateStatus((s) => {
      setUpd(s)
      if (s.state === 'available') setUpdDismissed(false)
      if (s.state === 'none') useLibraryStore.getState().showToast('已是最新版本')
      if (s.state === 'dev') useLibraryStore.getState().showToast('开发模式不检查更新')
      if (s.state === 'error') {
        useLibraryStore.getState().showToast(`更新检查失败：${s.message ?? '网络异常'}`)
      }
    })
  }, [refreshAll])

  // 键盘快捷键：Delete 删除、Ctrl+Z 撤销、Ctrl+A 全选、空格预览、1-5 评分、方向键移动
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const s = useLibraryStore.getState()
      if (e.key === 'Delete') {
        if (inInput) return
        void s.deleteSelection(s.view.type === 'trash')
      } else if (e.key === 'Escape') {
        s.openPreview(null)
        s.openEditor(null)
        s.setSelection([])
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (inInput) return
        e.preventDefault()
        void s.undoLast()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (inInput) return
        e.preventDefault()
        s.setSelection(s.assets.map((a) => a.id))
      } else if (e.key === ' ') {
        if (inInput) return
        e.preventDefault()
        if (s.selection.length === 1) s.openPreview(s.selection[0])
      } else if (/^[1-5]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        if (inInput) return
        const id = s.selection[0]
        if (id) {
          const star = Number(e.key)
          void window.api.updateAsset(id, { star })
          s.updateAssetLocal(id, { star })
        }
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        if (inInput) return
        const list = s.assets
        if (list.length === 0) return
        e.preventDefault()
        const curId = s.selection[s.selection.length - 1]
        const idx = list.findIndex((a) => a.id === curId)
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
        const next = idx === -1 ? 0 : Math.min(Math.max(idx + dir, 0), list.length - 1)
        s.setSelection([list[next].id])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Ctrl+V 粘贴图片/截图导入
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length > 0) {
        e.preventDefault()
        void importFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [importFiles])

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) void importFiles(files)
      }}
    >
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg-base)' }}>
          <Toolbar />
          <Gallery />
        </main>
        <Inspector />
      </div>

      {previewId && <Preview />}
      {editorId && <Editor />}
      {dragOver && (
        <div className="drag-over-overlay">
          <div className="drag-over-card flex flex-col items-center gap-3 rounded-2xl px-12 py-8 text-[15px] font-medium text-[var(--accent-text)]">
            <svg
              aria-hidden="true"
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3.5V15m0 0 4.2-4.2M12 15 7.8 10.8" />
              <path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            释放文件以导入到素材库
          </div>
        </div>
      )}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="anim-toast menu fixed bottom-6 left-1/2 z-[200] px-5 py-2.5 text-[13px]"
        >
          <ScrambleText text={toast} speed={18} />
        </div>
      )}

      {/* 更新提示卡片 */}
      {upd && (upd.state === 'available' || upd.state === 'downloading') && !updDismissed && (
        <div className="anim-dialog menu fixed bottom-6 right-6 z-[190] w-72 p-3.5">
          {upd.state === 'available' ? (
            <>
              <p className="text-[13px] font-medium">
                发现新版本{' '}
                <span className="mono text-[var(--accent-text)]">v{upd.version}</span>
              </p>
              {upd.notes && (
                <div className="modal-scroll mt-2 max-h-28 overflow-y-auto border-l-2 border-[var(--accent-deep)] pl-2 text-[11px] leading-relaxed text-[var(--text-dim)]">
                  <UpdateNotes notes={upd.notes} />
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">下载后重启即可完成安装</p>
              <div className="mt-2.5 flex gap-2">
                <button
                  className="btn-primary flex-1"
                  onClick={() => void window.api.downloadUpdate()}
                >
                  立即下载
                </button>
                <button className="btn-ghost" onClick={() => setUpdDismissed(true)}>
                  稍后
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="flex justify-between text-[12px] text-[var(--text-dim)]">
                <span>正在下载更新…</span>
                <span className="mono tnum">{upd.percent ?? 0}%</span>
              </p>
              <div className="mt-2 h-1 w-full bg-[var(--bg-active)]">
                <div
                  className="h-full bg-[var(--accent)] transition-all duration-200"
                  style={{ width: `${upd.percent ?? 0}%` }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* 下载完成：重启安装确认 */}
      {upd?.state === 'downloaded' && (
        <ConfirmDialog
          title={`新版本 v${upd.version} 已就绪`}
          message={
            upd.notes
              ? `更新内容：\n${upd.notes
                  .split('\n')
                  .map((l) => (l.trimStart().startsWith('·') ? `   ${l.trim()}` : l))
                  .join('\n')}\n\n更新已下载完成，重启应用后立即生效。`
              : '更新已下载完成，重启应用后立即生效。'
          }
          confirmLabel="重启安装"
          danger={false}
          onConfirm={() => window.api.installUpdate()}
          onClose={() => setUpd(null)}
        />
      )}
    </div>
  )
}
