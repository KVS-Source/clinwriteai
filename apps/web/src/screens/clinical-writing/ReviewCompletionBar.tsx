// ReviewCompletionBar — the review stage's own record in Reviewer View: who among the document's
// Reviewers (C) and QC (Q) has finished, and for someone still to finish, the button that says so.
// Completing is final (POST /documents/:id/raci/:raciId/complete, audited), hence the confirm step.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { raciApi, type DocumentRaciRow } from '../../api/raci'
import { ApiError } from '../../api/client'
import { useCurrentUser } from '../../hooks'
import { isReadOnlyRole } from '../../config/roles'
import { documentRaciKey } from './MyRaciRole'

const REVIEW_LETTERS = new Set(['C', 'Q'])

export function ReviewCompletionBar({ documentId, projectId }: { documentId: string; projectId?: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: me } = useCurrentUser()
  const [confirming, setConfirming] = useState(false)
  const [allDone, setAllDone] = useState(false)

  const { data: rows = [] } = useQuery({
    queryKey: documentRaciKey(documentId),
    queryFn:  () => raciApi.list(documentId),
    retry:    false,
  })

  const cohort = rows.filter(r => r.removedAt === null && REVIEW_LETTERS.has(r.letter))
  // Someone reviewing section by section holds several rows, and finishes them together.
  const mine = cohort.filter(r => r.userId === me?.id)
  const myOpen = mine.filter(r => r.reviewedAt === null && r.rejectedAt === null)
  const canAct = myOpen.length > 0 && !isReadOnlyRole(me?.role)
  const needsSignature = myOpen.some(r => r.signatureRequired)
  const isQc = myOpen.length > 0 && myOpen.every(r => r.letter === 'Q')

  const complete = useMutation({
    mutationFn: async () => {
      let last: Awaited<ReturnType<typeof raciApi.complete>> | null = null
      for (const row of myOpen) last = await raciApi.complete(documentId, row.id)
      return last
    },
    onSuccess: result => {
      setConfirming(false)
      if (result?.transition.cohortComplete) setAllDone(true)
    },
    onSettled: () => {
      // The last person finishing can move the document on, so status and tabs refresh too.
      qc.invalidateQueries({ queryKey: documentRaciKey(documentId) })
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      qc.invalidateQueries({ queryKey: ['document-audit', documentId] })
      if (projectId) qc.invalidateQueries({ queryKey: ['documents', projectId] })
    },
  })

  if (cohort.length === 0) return null

  const doneCount = cohort.filter(r => r.reviewedAt !== null).length
  const errorBody = complete.error instanceof ApiError ? complete.error.body as { message?: string; error?: string } | null : null

  return (
    <div className="flex flex-none flex-col gap-1.5 border-b border-slate-200 bg-white px-6 py-2.5" data-review-completion>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="whitespace-nowrap text-[12px] font-semibold text-slate-700" data-review-progress>
          {t('page.reviewer_view.review_progress', { done: doneCount, total: cohort.length })}
        </span>
        {cohort.map(row => <PersonChip key={row.id} row={row} />)}
        <div className="flex-1" />

        {canAct && !confirming && (
          <button
            type="button"
            onClick={() => { complete.reset(); setConfirming(true) }}
            disabled={needsSignature}
            title={needsSignature ? t('page.reviewer_view.complete_needs_signature') : undefined}
            className="whitespace-nowrap rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            data-action="complete-review"
          >
            {isQc ? t('page.reviewer_view.qc_complete') : t('page.reviewer_view.mark_review_done')}
          </button>
        )}
        {canAct && confirming && (
          <span className="flex items-center gap-2" data-review-confirm>
            <span className="text-[12px] text-slate-600">{t('page.reviewer_view.complete_confirm')}</span>
            <button
              type="button"
              onClick={() => complete.mutate()}
              disabled={complete.isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="confirm-complete-review"
            >
              {complete.isPending ? t('page.reviewer_view.completing') : t('page.reviewer_view.complete_confirm_yes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={complete.isPending}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
              data-action="cancel-complete-review"
            >
              {t('page.reviewer_view.cancel')}
            </button>
          </span>
        )}
      </div>

      {canAct && needsSignature && (
        <p className="text-[11px] text-amber-800" data-review-needs-signature>{t('page.reviewer_view.complete_needs_signature')}</p>
      )}
      {complete.isError && (
        <p role="alert" className="text-[12px] text-red-700" data-review-complete-error>
          {errorBody?.message ?? errorBody?.error ?? t('page.reviewer_view.complete_failed')}
        </p>
      )}
      {(allDone || (cohort.length > 0 && doneCount === cohort.length)) && (
        <p role="status" className="text-[12px] font-medium text-green-800" data-review-all-done>
          {t('page.reviewer_view.review_all_done')}
        </p>
      )}
    </div>
  )
}

function PersonChip({ row }: { row: DocumentRaciRow }) {
  const { t } = useTranslation()
  const done = row.reviewedAt !== null
  const rejected = !done && row.rejectedAt !== null
  const state = done ? 'done' : rejected ? 'rejected' : 'pending'
  const when = row.reviewedAt ? new Date(row.reviewedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${done ? 'border-green-200 bg-green-50 text-green-800' : rejected ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
      title={when ? t('page.reviewer_view.completed_at', { when }) : undefined}
      data-review-person={row.userId}
      data-review-state={state}
    >
      <span className="font-mono text-[10px] font-semibold">{row.letter === 'Q' ? t('page.reviewer_view.letter_qc') : t('page.reviewer_view.letter_reviewer')}</span>
      <span className="font-medium">{row.userName ?? row.userId}</span>
      <span>{done ? `✓ ${t('page.reviewer_view.state_done')}` : rejected ? t('page.reviewer_view.state_rejected') : t('page.reviewer_view.state_pending')}</span>
    </span>
  )
}
