// "Return to authoring" — a Reviewer (C), QC (Q) or Approver (A) sends the whole
// document back one stage, with a required note. The API (POST
// /documents/:id/raci/:raciId/reject) moves it to In Authoring, takes a new
// version snapshot, cancels any open signature chain and starts a new round.
//
// Shown only while the document is in review, in a CRM or awaiting signature, and
// only to someone holding C, Q or A on it. The per-section "Return for revision"
// verdict is different: it flags one section and leaves the document where it is.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { raciApi, type DocumentRaciRow } from '../../api/raci'
import { ApiError } from '../../api/client'
import { useCurrentUser } from '../../hooks'
import { fromSQLEnum } from '../../utils/enumConvert'
import type { Document, DocumentStatus } from '@platform/types'

const RETURNABLE_STATUSES = new Set(['in-review', 'crm-in-progress', 'pending-signature'])

// The caller's row to return the document with: an Approver's row while awaiting
// signature, otherwise a Reviewer's, then QC's.
function pickRow(rows: DocumentRaciRow[], userId: string | undefined, status: string): DocumentRaciRow | undefined {
  const mine = rows.filter(r => r.userId === userId && !r.removedAt && !r.rejectedAt)
  const order = status === 'pending-signature' ? ['A', 'C', 'Q'] : ['C', 'Q', 'A']
  for (const letter of order) {
    const row = mine.find(r => r.letter === letter)
    if (row) return row
  }
  return undefined
}

export function ReturnToAuthoring({ documentId, status, onReturned }: {
  documentId: string
  status: string
  onReturned: (versionNumber: string) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: me } = useCurrentUser()
  const raci = useQuery({
    queryKey: ['document-raci', documentId],
    queryFn:  () => raciApi.list(documentId),
    retry:    false,
  })
  const row = useMemo(() => pickRow(raci.data ?? [], me?.id, status), [raci.data, me?.id, status])

  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  const returnMut = useMutation({
    mutationFn: () => raciApi.reject(documentId, row!.id, { note: note.trim() }),
    onSuccess: (res) => {
      setOpen(false)
      setNote('')
      // Put the new status in the cache at once: a screen that changes route next
      // (E-Signature → editor) would otherwise be redirected by the tab guard on the
      // old "awaiting signature" status before the refetch lands.
      const newStatus = fromSQLEnum(res.document.status) as DocumentStatus
      qc.setQueryData<Document>(['document', documentId], old => (old ? { ...old, status: newStatus } : old))
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      qc.invalidateQueries({ queryKey: ['document-raci', documentId] })
      qc.invalidateQueries({ queryKey: ['documents'] })
      onReturned(res.version.versionNumber)
    },
  })

  if (!RETURNABLE_STATUSES.has(status) || !row) return null

  const errorMessage = returnMut.error instanceof ApiError && returnMut.error.status === 409
    ? t('page.reviewer_view.return_doc_not_returnable')
    : returnMut.isError ? t('page.reviewer_view.return_doc_failed') : null

  return (
    <>
      <button
        type="button"
        onClick={() => { returnMut.reset(); setOpen(true) }}
        data-action="return-to-authoring"
        className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90"
        style={{ backgroundColor: '#FEF2F2', color: '#B91C1C', borderColor: '#FECACA' }}
      >
        {t('page.reviewer_view.return_doc_button')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="return-doc-title" data-return-dialog>
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="return-doc-title" className="text-[15px] font-bold text-slate-900">{t('page.reviewer_view.return_doc_title')}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{t('page.reviewer_view.return_doc_explainer')}</p>
            <label htmlFor="return-doc-note" className="mt-4 block text-[12px] font-semibold text-slate-700">
              {t('page.reviewer_view.return_doc_note_label')}<span className="ml-0.5 text-red-600" aria-hidden="true">*</span>
            </label>
            <textarea
              id="return-doc-note"
              value={note}
              onChange={e => setNote(e.currentTarget.value)}
              rows={4}
              maxLength={2000}
              required
              autoFocus
              placeholder={t('page.reviewer_view.return_doc_note_placeholder')}
              className="mt-1 w-full resize-none rounded-md border border-slate-300 px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
              data-input="return-note"
            />
            {errorMessage && <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700" role="alert">{errorMessage}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={returnMut.isPending}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {t('button.cancel')}
              </button>
              <button
                type="button"
                onClick={() => returnMut.mutate()}
                disabled={!note.trim() || returnMut.isPending}
                className="rounded-md bg-red-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                data-action="confirm-return"
              >
                {returnMut.isPending ? t('page.reviewer_view.return_doc_returning') : t('page.reviewer_view.return_doc_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
