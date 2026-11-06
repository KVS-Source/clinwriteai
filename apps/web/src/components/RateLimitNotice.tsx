// A notice while the API is asking us to slow down (429). Reads are retried by api/client.ts, so the page
// carries on by itself; a refused save has to be tried again by the user, so it says that instead.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RATE_LIMIT_EVENT, type RateLimitDetail } from '../api/client'

export function RateLimitNotice() {
  const { t } = useTranslation()
  const [notice, setNotice] = useState<RateLimitDetail | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<RateLimitDetail>).detail
      clearTimeout(timer)
      setNotice(detail)
      // A retry ending clears it right away; otherwise it goes when the wait is over.
      timer = setTimeout(() => setNotice(null), (detail.seconds + 1) * 1000)
    }
    const onCleared = () => { clearTimeout(timer); setNotice(null) }
    window.addEventListener(RATE_LIMIT_EVENT, onEvent)
    window.addEventListener(`${RATE_LIMIT_EVENT}:cleared`, onCleared)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(RATE_LIMIT_EVENT, onEvent)
      window.removeEventListener(`${RATE_LIMIT_EVENT}:cleared`, onCleared)
    }
  }, [])

  if (!notice) return null
  return (
    <div
      role="status"
      data-rate-limit-notice={notice.retrying ? 'retrying' : 'try-again'}
      className="fixed left-1/2 top-4 z-[100] -translate-x-1/2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-900 shadow-lg"
    >
      {notice.retrying ? t('component.rate_limit.retrying') : t('component.rate_limit.try_again', { seconds: notice.seconds })}
    </div>
  )
}
