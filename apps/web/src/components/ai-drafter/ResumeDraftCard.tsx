// "Resume drafting" for an AI draft that failed or was stopped. Starting again never loses what was drafted: the
// drafter keeps every section that already has text, gives those sections to the ones that depend on them, reuses
// the study fact sheet while the sources are the same, and drafts only the sections still empty
// (worker ai-initial-draft.ts). The server runs the usual pre-check first (POST /documents/:id/ai-draft/start).

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { aiDrafterApi, type AiDraftStatusResponse } from '../../api/ai-drafter'
import { ApiError } from '../../api/client'

export function ResumeDraftCard({ documentId, status }: { documentId: string; status: Pick<AiDraftStatusResponse, 'state' | 'draftedSections' | 'totalSections' | 'stopReason'> }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [started, setStarted] = useState(false)
  const start = useMutation({
    mutationFn: () => aiDrafterApi.startDraft(documentId),
    onSuccess: () => {
      setStarted(true)
      qc.invalidateQueries({ queryKey: ['ai-draft-status', documentId] })
      qc.invalidateQueries({ queryKey: ['ai-debug', documentId] })
      qc.invalidateQueries({ queryKey: ['ai-draft-preflight', documentId] })
    },
  })

  // A pre-check that still fails lists its issues; anything else gives the server's message.
  const problems: string[] = (() => {
    if (!(start.error instanceof ApiError)) return start.error ? [t('page.ai_drafting_report_panel.resume_blocked')] : []
    const body = start.error.body as { issues?: Array<{ message?: string }>; message?: string; error?: string } | null
    if (body?.issues?.length) return body.issues.map(i => i.message ?? '').filter(Boolean)
    return [body?.message ?? body?.error ?? `HTTP ${start.error.status}`]
  })()

  const failed = status.state === 'failed'
  return (
    <div
      className={`rounded-md border p-3 text-[12px] ${failed ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
      data-resume-draft={status.state ?? ''}
    >
      <p className="font-semibold">
        {failed ? t('page.ai_drafting_report_panel.resume_title_failed') : t('page.ai_drafting_report_panel.resume_title_cancelled')}
      </p>
      {typeof status.draftedSections === 'number' && typeof status.totalSections === 'number' && (
        <p className="mt-1" data-resume-kept>
          {t('page.ai_drafting_report_panel.resume_kept', { drafted: status.draftedSections, total: status.totalSections })}
        </p>
      )}
      {status.stopReason && (
        <p className="mt-1 break-words text-[11px] opacity-80" data-resume-reason>
          {t('page.ai_drafting_report_panel.resume_reason', { reason: status.stopReason.slice(0, 300) })}
        </p>
      )}
      <p className="mt-1 text-[11px] opacity-80">{t('page.ai_drafting_report_panel.resume_body')}</p>
      {problems.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-rose-800" role="alert">
          {problems.map(p => <li key={p}>{p}</li>)}
        </ul>
      )}
      {started && !start.isPending && !start.error && (
        <p className="mt-2 text-emerald-700" data-resume-started>{t('page.ai_drafting_report_panel.resume_started')}</p>
      )}
      <button
        type="button"
        onClick={() => start.mutate()}
        disabled={start.isPending}
        className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        data-action="resume-draft"
      >
        {start.isPending ? t('page.ai_drafting_report_panel.resume_starting') : t('page.ai_drafting_report_panel.resume_button')}
      </button>
    </div>
  )
}
