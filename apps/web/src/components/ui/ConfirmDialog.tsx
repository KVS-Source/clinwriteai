// An in-app "are you sure?" box, in place of the browser's own window.confirm pop-up (which can't be styled, shows
// "localhost:5173 says" and looks out of place).
//
//   <ConfirmDialog open={asking} title="Retire this template?" message="…" confirmLabel="Retire" tone="danger"
//                  onConfirm={…} onCancel={() => setAsking(false)} />
//
// - Esc or a click on the dimmed background cancels. Focus starts on Cancel, so pressing Enter right away never
//   confirms something that can't be undone.
// - It sits above slide panels. It marks itself `data-slide-panel` so a panel that closes on an outside click does
//   not treat a click inside this box as "outside" and vanish before the click lands.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

interface Props {
  open:          boolean
  title:         string
  message?:      string
  confirmLabel?: string
  cancelLabel?:  string
  /** 'danger' = red confirm button, for things that can't be undone. */
  tone?:         'default' | 'danger'
  busy?:         boolean
  onConfirm:     () => void
  onCancel:      () => void
}

export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, tone = 'default', busy = false, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    // Capture phase + preventDefault: a slide panel underneath also listens for Esc, and must not close with us.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onCancel])

  if (!open) return null

  const danger = tone === 'danger'
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
      data-slide-panel data-confirm-dialog
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby={message ? 'confirm-dialog-message' : undefined}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <span aria-hidden="true"
            className={`mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full text-[18px] font-bold ${danger ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
            {danger ? '!' : '?'}
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="confirm-dialog-title" className="break-words text-[16px] font-semibold text-slate-900">{title}</h3>
            {message && <p id="confirm-dialog-message" className="mt-1.5 break-words text-[13px] leading-relaxed text-slate-600">{message}</p>}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} data-action="confirm-cancel"
            className="h-9 max-w-full whitespace-normal rounded-md border border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-50">
            {cancelLabel ?? t('button.cancel')}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} data-action="confirm-ok"
            className={`min-h-9 max-w-full break-words rounded-md px-4 py-1.5 text-[13px] font-semibold text-white focus:outline-none focus:ring-2 disabled:opacity-50 ${danger ? 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-300' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-300'}`}>
            {confirmLabel ?? t('button.confirm', { defaultValue: 'Confirm' })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
