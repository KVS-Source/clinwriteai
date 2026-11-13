import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Document } from '@platform/types'
import { platformApi, type LibraryAutoPushStatus } from '../../platform/api/platformApi'
import { formatDate } from '../../utils/formatDate'

// A signed document goes into the Master Library by itself when its signature chain completes (API:
// apps/api/src/modules/platform/library/auto-push.ts) — there is no push button any more. These show what
// happened: added (with a link to the entry), still waiting for the final version, or skipped / failed (a
// warning; the reason is also on the document's audit trail).

export function useLibraryAutoPush(document: Pick<Document, 'id' | 'status'> | null | undefined) {
  const signed = document?.status === 'signed'
  return useQuery({
    queryKey: ['library-auto-push', document?.id],
    queryFn: () => platformApi.libraryAutoPushStatus(document!.id),
    enabled: !!document && signed,
    retry: false,
    staleTime: 60_000,
  })
}

const entryLink = (s: Extract<LibraryAutoPushStatus, { state: 'pushed' }>) => `/master-library/documents?item=${encodeURIComponent(s.entry.id)}`

/** The small line in the Final Document's signed banner: "Added to Master Library on <date> · Open". */
export function LibraryStatusLine({ status }: { status: LibraryAutoPushStatus | undefined }) {
  const { t } = useTranslation()
  if (!status) return null
  if (status.state === 'pushed') {
    return (
      <span className="flex flex-none items-center gap-1.5 whitespace-nowrap text-[12px]" style={{ color: '#15803D' }} data-library-status="pushed">
        <span aria-hidden>·</span>
        {t('page.library_push.added_on', { date: formatDate(status.entry.addedAt) })}
        <Link to={entryLink(status)} className="font-semibold underline hover:opacity-80" data-library-entry-link>
          {t('page.library_push.open_entry')}
        </Link>
      </span>
    )
  }
  if (status.state === 'waiting') {
    return (
      <span className="flex-none whitespace-nowrap text-[12px]" style={{ color: '#15803D' }} data-library-status="waiting">
        · {t('page.library_push.waiting')}
      </span>
    )
  }
  return null
}

/** Amber row under the signed banner when the document could not be added (skipped or failed). */
export function LibraryPushWarning({ status }: { status: LibraryAutoPushStatus | undefined }) {
  const { t } = useTranslation()
  if (!status || (status.state !== 'skipped' && status.state !== 'failed')) return null
  const missing = status.state === 'skipped' && status.reason === 'missing_tags'
    ? (status.missing ?? []).map(m => t(`page.library_push.tag_${m}`, { defaultValue: m.replace(/_/g, ' ') })).join(', ')
    : ''
  const message = status.state === 'failed'
    ? t('page.library_push.warning_failed')
    : status.reason === 'missing_tags' ? t('page.library_push.warning_missing_tags', { tags: missing })
      : status.reason === 'no_content' ? t('page.library_push.warning_no_content')
        : t('page.library_push.warning_other', { reason: status.reason })
  return (
    <div className="flex flex-none items-center gap-2 border-b border-amber-200 bg-amber-50 px-8 py-2 text-[13px] text-amber-900" role="status" data-library-warning={status.state}>
      <span aria-hidden>⚠</span>
      <span>{message} {t('page.library_push.warning_logged')}</span>
    </div>
  )
}

/** "In Master Library" pill (document side panel), a link to the entry. */
export function LibraryBadge({ document }: { document: Pick<Document, 'id' | 'status'> }) {
  const { t } = useTranslation()
  const { data } = useLibraryAutoPush(document)
  if (data?.state !== 'pushed') return null
  return (
    <Link to={entryLink(data)}
      className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold hover:opacity-80"
      style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}
      title={t('page.library_push.added_on', { date: formatDate(data.entry.addedAt) })}
      data-library-badge>
      {t('page.library_push.badge_document')}
    </Link>
  )
}
