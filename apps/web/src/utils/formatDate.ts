import i18n from '../i18n'

const isJapanese = () => (i18n.language ?? '').startsWith('ja')

// Locale for a date shown to the user. In English the browser's own format is kept (undefined).
export const uiLocale = (): string | undefined => (isJapanese() ? 'ja-JP' : undefined)
// The same, for screens whose English format is day-month-year.
export const dateLocale = (): string => uiLocale() ?? 'en-GB'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The UTC date of a moment: '28 Oct 2026', or '2026年10月28日' in Japanese.
export const formatDateUtc = (d: Date): string =>
  isJapanese()
    ? d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

/** Today on the viewer's own calendar, as 'YYYY-MM-DD'. */
export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** A 'YYYY-MM-DD' from a date picker that has already passed. An empty one hasn't. */
export const isPastDate = (day: string | null | undefined): boolean => !!day && day < localToday()

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export const formatTimestamp = (iso: string): string =>
  new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

export const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}
