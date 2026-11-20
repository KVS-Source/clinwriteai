// E-Signature tab with no running chain. Nobody starts a chain by hand any more: signing starts by itself
// when the CRM is finished, Approvers first (Approve & E-sign), then everyone else. This says so, or, when
// the document awaits signature but the automatic start was blocked, why.

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { signaturesApi } from '../../api/signatures'

export function SigningNotStarted({ documentId }: { documentId: string }) {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['signature-start-status', documentId],
    queryFn:  () => signaturesApi.startStatus(documentId),
    retry:    false,
  })
  const awaiting = data?.status === 'pending_signature'

  return (
    <div className="flex max-w-3xl flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5" data-signing-not-started>
      <p className="text-sm font-bold text-slate-900">{t('page.e_signature.not_started_title')}</p>
      {awaiting && data?.blocked ? (<>
        <p className="text-[13px] text-slate-700">{t('page.e_signature.not_started_blocked')}</p>
        <p className="max-h-40 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900" data-signing-blocked-reason={data.blocked.error}>
          {data.blocked.message}
        </p>
        <p className="text-[12px] text-slate-500">{t('page.e_signature.not_started_blocked_next')}</p>
      </>) : (
        <p className="text-[13px] text-slate-700">{t('page.e_signature.not_started_body')}</p>
      )}
    </div>
  )
}
