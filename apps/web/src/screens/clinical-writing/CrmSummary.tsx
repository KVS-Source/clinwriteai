// Read-only summary of the document's last completed CRM meeting, for an Approver in the Approver View:
// what the meeting decided on each comment, so they have it in front of them when they Approve & E-sign.
// Approvers have no CRM tab once the meeting is over; this is their record of it.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Comment } from '@platform/types'
import { crmApi } from '../../api/crm'

const TYPE_KEY: Record<string, string> = {
  accept:                   'page.reviewer_view.crm_summary_accept',
  accept_with_modification: 'page.reviewer_view.crm_summary_accept_mod',
  reject:                   'page.reviewer_view.crm_summary_reject',
}

export function CrmSummary({ documentId, comments }: { documentId: string; comments: Comment[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: meetings = [] } = useQuery({
    queryKey: ['crm-meetings', documentId],
    queryFn:  () => crmApi.getMeetings(documentId),
  })
  // The meeting that sent the document to signature: the newest completed one not held during authoring.
  const meeting = meetings
    .filter(m => m.status === 'complete' && !m.heldDuringAuthoring)
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))[0]
  const { data: resolutions = [] } = useQuery({
    queryKey: ['crm-resolutions', meeting?.id],
    queryFn:  () => crmApi.listResolutions(meeting!.id),
    enabled:  !!meeting,
    retry:    false,
  })
  if (!meeting) return null

  const people = new Map([meeting.chair, ...meeting.attendees].map(p => [p.userId, p.name]))
  const commentById = new Map(comments.map(c => [c.id, c]))
  const count = (type: string) => resolutions.filter(r => r.resolutionType === type).length
  const day = (meeting.endedAt ?? meeting.date).slice(0, 10)

  return (
    <div className="flex-none border-b border-slate-200 bg-slate-50 px-6 py-2 text-[13px] text-slate-700" data-crm-summary>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-slate-900">{t('page.reviewer_view.crm_summary_title', { ref: meeting.meetingRef })}</span>
        <span>{t('page.reviewer_view.crm_summary_held', { date: day, chair: meeting.chair.name })}</span>
        <span>{t('page.reviewer_view.crm_summary_counts', { total: resolutions.length, accept: count('accept'), mod: count('accept_with_modification'), reject: count('reject') })}</span>
        {resolutions.length > 0 && (
          <button type="button" onClick={() => setOpen(o => !o)} className="font-semibold text-blue-700 hover:underline" data-action="toggle-crm-summary">
            {open ? t('page.reviewer_view.crm_summary_hide') : t('page.reviewer_view.crm_summary_show')}
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {resolutions.map(r => {
            const c = commentById.get(r.commentId)
            return (
              <li key={r.id} className="rounded-md border border-slate-200 bg-white p-2" data-crm-summary-item={r.commentId}>
                <p className="text-[12px] text-slate-500">
                  {r.commentId}{c ? ` · ${c.sectionRef} · ${c.reviewerName}` : ''} · <span className="font-semibold text-slate-800">{t(TYPE_KEY[r.resolutionType] ?? r.resolutionType)}</span>
                </p>
                {c && <p className="mt-1 text-slate-700">{c.text.length > 240 ? `${c.text.slice(0, 240)}…` : c.text}</p>}
                <p className="mt-1 text-slate-900">{r.resolutionNote}</p>
                <p className="mt-1 text-[11px] text-slate-400">{t('page.reviewer_view.crm_summary_by', { name: people.get(r.resolvedBy) ?? r.resolvedBy })}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
