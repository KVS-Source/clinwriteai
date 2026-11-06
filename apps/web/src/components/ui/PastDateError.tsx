// Shown under a date picker when the chosen date has already passed. Picking one is blocked by `min`, but
// a date can still be typed in, so the form also checks isPastDate before it lets you continue.

import { useTranslation } from 'react-i18next'
import { isPastDate } from '../../utils/formatDate'

export function PastDateError({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation()
  if (!isPastDate(value)) return null
  return <span className="text-[11px] font-semibold text-red-700" role="alert" data-date-past>{t('component.deadlines.past')}</span>
}
