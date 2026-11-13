// "Approve document" — the Approver's (A) whole-document approval in the Approver View, with an
// optional comment. It is recorded as an approve verdict against the whole document (the same
// verdict record "Approve section" uses, so it shows in Comments and the audit trail); the comment,
// if any, is its text. Rejecting is the sibling button, ReturnToAuthoring, which needs a comment.
//
// Shown only to someone whose only part on the document is Approver, while it is in review or a CRM.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { documentsApi } from '../../api'
import { ApiError } from '../../api/client'

// Stored as the verdict's section reference, so it is not translated.
export const APPROVE_DOCUMENT_REF = 'Document'

export function ApproveDocument({ documentId, alreadyApproved, onApproved }: {
  documentId: string
  alreadyApproved: boolean
  onApproved: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')

  const approveMut = useMutation({
    mutationFn: () => documentsApi.addComment(documentId, {
      sectionRef: APPROVE_DOCUMENT_REF,
      text:       comment.trim(),
      severity:   'query',
      verdict:    'approve',
    }),
    onSuccess: () => {
      setOpen(false)
      setComment('')
      qc.invalidateQueries({ queryKey: ['comments', documentId] })
      qc.invalidateQueries({ queryKey: ['project-comments'] })
      qc.invalidateQueries({ queryKey: ['document-audit', documentId] })
      onApproved()
    },
  })

  const errorMessage = approveMut.isError
    ? ((approveMut.error as ApiError | null)?.body as { message?: string } | null)?.message ?? t('page.reviewer_view.approve_document_failed')
    : null

  return (
    <>
      <button
        type="button"
        onClick={() => { approveMut.reset(); setOpen(true) }}
        disabled={alreadyApproved}
        data-action="approve-document"
        className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}
      >
        {alreadyApproved ? t('page.reviewer_view.approved_document_by_you') : t('page.reviewer_view.approve_document')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="approve-doc-title" data-approve-dialog>
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="approve-doc-title" className="text-[15px] font-bold text-slate-900">{t('page.reviewer_view.approve_document_title')}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{t('page.reviewer_view.approve_document_explainer')}</p>
            <label htmlFor="approve-doc-comment" className="mt-4 block text-[12px] font-semibold text-slate-700">
              {t('page.reviewer_view.approve_document_comment_label')}
            </label>
            <textarea
              id="approve-doc-comment"
              value={comment}
              onChange={e => setComment(e.currentTarget.value)}
              rows={4}
              maxLength={2000}
              autoFocus
              placeholder={t('page.reviewer_view.approve_document_comment_placeholder')}
              className="mt-1 w-full resize-none rounded-md border border-slate-300 px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100"
              data-input="approve-comment"
            />
            {errorMessage && <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700" role="alert">{errorMessage}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={approveMut.isPending}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {t('button.cancel')}
              </button>
              <button
                type="button"
                onClick={() => approveMut.mutate()}
                disabled={approveMut.isPending}
                className="rounded-md bg-green-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                data-action="confirm-approve-document"
              >
                {approveMut.isPending ? t('page.reviewer_view.approve_document_approving') : t('page.reviewer_view.approve_document_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
