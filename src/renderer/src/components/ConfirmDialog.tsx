import { useEffect } from 'react'

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = true,
  onConfirm,
  onClose
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="anim-overlay overlay fixed inset-0 z-[500] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby="confirm-dialog-message"
        className="confirm-dialog anim-dialog dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="confirm-dialog__header">
          <h2 className="text-[15px] font-semibold">{title}</h2>
        </header>

        <div className="confirm-dialog__body modal-scroll">
          <p
            id="confirm-dialog-message"
            className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-dim)]"
          >
            {message}
          </p>
        </div>

        <footer className="confirm-dialog__actions">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            autoFocus
            className={danger ? 'btn-danger-solid' : 'btn-primary'}
            onClick={() => {
              void onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
