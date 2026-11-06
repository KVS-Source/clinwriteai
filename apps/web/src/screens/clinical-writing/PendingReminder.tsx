import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { raciApi, type RaciLetter } from '../../api/raci'
import { describeApiError } from '../../api'
import { MetaSection } from './detailPanelParts'

// "Waiting on": who still owes a submission, review, QC release or approval on this document, when each
// was last reminded, and a Send reminder button (CW-027). For the Author (R) only: for anyone else the
// list request is refused and nothing is shown. A person reminded in the last 24 hours is skipped.

const LETTER_KEY: Record<RaciLetter, string> = {
  R: 'page.document_detail_panel.letter_r',
  C: 'page.document_detail_panel.letter_c',
  Q: 'page.document_detail_panel.letter_q',
  A: 'page.document_detail_panel.letter_a',
  I: 'page.document_detail_panel.letter_i',
}

export function PendingReminder({ documentId, status }: { documentId: string; status: string | undefined }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [result, setResult] = useState<string | null>(null)
  const pending = useQuery({
    queryKey: ['document-pending', documentId, status],
    queryFn: () => raciApi.pending(documentId),
    retry: false,
  })
  const send = useMutation({
    mutationFn: () => raciApi.nudge(documentId),
    onSuccess: (r) => {
      const sent = r.decisions.filter(d => d.status === 'nudged').length
      const skipped = r.decisions.filter(d => d.status === 'throttled').length
      setResult(t('page.document_detail_panel.reminder_result', { sent, skipped }))
      void qc.invalidateQueries({ queryKey: ['document-pending', documentId] })
    },
    onError: (err) => setResult(describeApiError(err).message),
  })

  const people = pending.data?.pending ?? []
  if (pending.isError || people.length === 0) return null

  const hoursAgo = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000))
  const everyoneReminded = people.every(p => p.remindedAt)

  return (
    <MetaSection label={t('page.document_detail_panel.waiting_on')}>
      <ul className="flex flex-col gap-1.5" data-pending-list>
        {people.map(p => (
          <li key={p.userId} className="flex items-baseline justify-between gap-2 text-[13px]" data-pending-person={p.userId}>
            <span className="min-w-0 truncate font-semibold text-slate-900">{p.name}</span>
            <span className="flex-none text-[11px] text-slate-500">
              {t(LETTER_KEY[p.letter])}
              {p.remindedAt ? ` · ${t('page.document_detail_panel.reminded_ago', { hours: hoursAgo(p.remindedAt) })}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => { setResult(null); send.mutate() }}
        disabled={send.isPending || everyoneReminded}
        title={everyoneReminded ? t('page.document_detail_panel.reminder_all_recent') : undefined}
        data-action="send-reminder"
        className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >{send.isPending ? t('page.document_detail_panel.reminder_sending') : t('page.document_detail_panel.reminder_send')}</button>
      {result && <p className="mt-2 text-[12px] text-slate-600" role="status" data-reminder-result>{result}</p>}
    </MetaSection>
  )
}
