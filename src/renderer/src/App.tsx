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
import AiDialog from './components/AiDialog'
import BoardPanel from './components/BoardPanel'
import BoardReferencePanel from './components/BoardReferencePanel'
import ArchiveHeader from './components/ArchiveHeader'
import { loadShortcuts, matchesShortcut } from './shortcuts'
import type { UpdateStatus } from '@shared/types'

/** 素材库与白板面板之间的拖拽分隔条（照抄 MOTZ main-pane-resizer） */
function BoardResizer() {
  const setBoardViewWidth = useLibraryStore((s) => s.setBoardViewWidth)
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = useLibraryStore.getState().boardViewWidth
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(900, Math.max(280, startW - (ev.clientX - startX)))
      setBoardViewWidth(w)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  return (
    <div
      aria-label="拖动调整白板宽度"
      title="拖动调整白板宽度"
      className="w-1 shrink-0 cursor-col-resize border-x border-[var(--border)] bg-[var(--bg-panel)] transition-colors duration-100 hover:bg-[var(--accent-deep)]"
      onPointerDown={onPointerDown}
    />
  )
}

let clipListenerRegistered = false

export default function App() {
  const refreshAll = useLibraryStore((s) => s.refreshAll)
  const importFiles = useLibraryStore((s) => s.importFiles)
  const toast = useLibraryStore((s) => s.toast)
  const previewId = useLibraryStore((s) => s.previewId)
  const editorId = useLibraryStore((s) => s.editorId)
  const view = useLibraryStore((s) => s.view)
  const boardViewMode = useLibraryStore((s) => s.boardViewMode)
  const aiDialogOpen = useLibraryStore((s) => s.aiDialogOpen)
  const selection = useLibraryStore((s) => s.selection)
  const [dragOver, setDragOver] = useState(false)
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [updDismissed, setUpdDismissed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  /** 下载完成弹窗被暂时关闭后置 true,显示「已就绪」持久角标可随时重新打开 */
  const [updReadyHidden, setUpdReadyHidden] = useState(false)
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number; failed: number } | null>(null)

  // 立即下载更新（带反馈：失败 toast，下载中按钮禁用）
  const startDownload = async () => {
    setDownloading(true)
    try {
      await window.api.downloadUpdate()
      // 下载完成后主进程会推送 downloaded 状态,这里不额外处理
    } catch {
      useLibraryStore.getState().showToast('更新下载失败,请检查网络后重试')
    } finally {
      setDownloading(false)
    }
  }

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
        const msg = s.message ?? '网络异常'
        // 检查阶段 vs 下载阶段:下载失败时 lastStatus 是 downloading,主进程已标记
        useLibraryStore.getState().showToast(`更新失败：${msg}`)
      }
    })
    // AI 处理进度推送
    window.api.onAiProgress((p) => {
      setAiProgress(p)
      if (p.done >= p.total) {
        // 处理完成,2 秒后自动隐藏进度卡片
        setTimeout(() => setAiProgress(null), 2000)
      }
    })
  }, [refreshAll])

  // 键盘快捷键：Delete 删除、Ctrl+Z 撤销、Ctrl+A 全选、空格预览、1-5 评分、方向键移动
  // (预览/全选/撤销三个动作支持设置页自定义绑定)
  useEffect(() => {
    const readShortcuts = () => loadShortcuts()
    let sc = readShortcuts()
    const onShortcutsChanged = () => {
      sc = readShortcuts()
    }
    window.addEventListener('lumen:shortcuts', onShortcutsChanged)

    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const s = useLibraryStore.getState()
      // 白板全屏或焦点在画布内时素材库不可见/不活跃：
      // 库级快捷键(删除/撤销/全选/评分/方向键)让位给画布
      // (否则白板里按 Delete/Ctrl+A 会连带操作素材库选中项)
      const boardActive =
        s.boardViewMode === 'board' ||
        (typeof target.closest === 'function' && !!target.closest('[data-board-frame]'))
      if (boardActive) return
      if (e.key === 'Delete') {
        if (inInput) return
        void s.deleteSelection(s.view.type === 'trash')
      } else if (e.key === 'Escape') {
        s.openPreview(null)
        s.openEditor(null)
        s.setSelection([])
      } else if (matchesShortcut(e, sc.undoDelete)) {
        if (inInput) return
        e.preventDefault()
        void s.undoLast()
      } else if (matchesShortcut(e, sc.selectAll)) {
        if (inInput) return
        e.preventDefault()
        s.setSelection(s.assets.map((a) => a.id))
      } else if (matchesShortcut(e, sc.preview)) {
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
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('lumen:shortcuts', onShortcutsChanged)
    }
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
      className="archive-shell flex h-full flex-col"
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
        <main className="archive-workspace flex min-h-0 min-w-0 flex-1 flex-col" style={{ background: 'var(--bg-base)' }}>
          {boardViewMode === 'board' ? (
            <div className="board-workspace flex min-h-0 min-w-0 flex-1">
              <BoardReferencePanel />
              <BoardPanel />
            </div>
          ) : boardViewMode === 'split' ? (
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <ArchiveHeader />
                <Toolbar />
                <Gallery />
              </div>
              <BoardResizer />
              <BoardPanel />
            </div>
          ) : (
            // 纯素材库：白板关闭时不渲染分屏与白板面板
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ArchiveHeader />
              <Toolbar />
              <Gallery />
            </div>
          )}
        </main>
        {/* 白板全屏时素材详情面板无意义(库里没有可见选中项),隐藏让画布更宽 */}
        {boardViewMode !== 'board' && <Inspector />}
      </div>

      {previewId && <Preview />}
      {editorId && <Editor />}
      {aiDialogOpen && (
        <AiDialog
          selectionIds={selection}
          onClose={() => useLibraryStore.getState().closeAiDialog()}
        />
      )}
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

      {/* AI 处理进度卡片 */}
      {aiProgress && (
        <div className="anim-dialog menu fixed bottom-6 right-6 z-[190] w-72 p-3.5">
          <p className="text-[13px] font-medium">AI 智能处理中…</p>
          <p className="mt-1 flex justify-between text-[12px] text-[var(--text-dim)]">
            <span>
              {aiProgress.done} / {aiProgress.total}
            </span>
            {aiProgress.failed > 0 && <span className="text-red-400">失败 {aiProgress.failed}</span>}
          </p>
          <div className="mt-2 h-1 w-full bg-[var(--bg-active)]">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-200"
              style={{ width: `${aiProgress.total > 0 ? (aiProgress.done / aiProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* 更新提示卡片 */}
      {upd && (upd.state === 'available' || upd.state === 'downloading') && !updDismissed && (
        <div className="update-card anim-dialog menu fixed bottom-6 right-6 z-[190] w-72 p-3.5">
          {upd.state === 'available' ? (
            <>
              <p className="text-[13px] font-medium">
                发现新版本{' '}
                <span className="mono text-[var(--accent-text)]">v{upd.version}</span>
              </p>
              {upd.notes && (
                <div className="update-card__notes modal-scroll mt-2 max-h-28 overflow-y-auto border-l-2 border-[var(--accent-deep)] pl-2 text-[11px] leading-relaxed text-[var(--text-dim)]">
                  <UpdateNotes notes={upd.notes} />
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">下载后重启即可完成安装</p>
              <div className="mt-2.5 flex gap-2">
                <button
                  className="btn-primary flex-1 disabled:opacity-40"
                  disabled={downloading}
                  onClick={() => void startDownload()}
                >
                  {downloading ? '下载中…' : '立即下载'}
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

      {/* 下载完成：重启安装确认(关闭后保留「已就绪」角标可重新打开) */}
      {upd?.state === 'downloaded' && !updReadyHidden && (
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
          onClose={() => setUpdReadyHidden(true)}
        />
      )}

      {/* 更新已就绪持久角标：弹窗关闭后仍可随时重启安装 */}
      {upd?.state === 'downloaded' && updReadyHidden && (
        <button
          aria-label={`新版本 v${upd.version} 已就绪，点击重启安装`}
          className="anim-dialog menu fixed bottom-6 right-6 z-[190] flex items-center gap-2 px-3 py-2 text-[12px] transition-colors duration-100 hover:border-[var(--accent)]"
          onClick={() => setUpdReadyHidden(false)}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
          <span>
            新版本 <span className="mono text-[var(--accent-text)]">v{upd.version}</span> 已就绪
          </span>
          <span className="text-[var(--text-faint)]">重启安装 →</span>
        </button>
      )}
    </div>
  )
}
