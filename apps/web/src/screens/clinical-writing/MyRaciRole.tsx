// Header chip(s) showing the signed-in user's RACI role(s) on this document —
// e.g. "Accountable (Approver)". Built from GET /documents/:id/raci (removed
// rows dropped); renders nothing when the user holds no role on the document.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { raciApi, type DocumentRaciRow, type RaciLetter } from '../../api/raci'
import { useCurrentUser } from '../../hooks/useCurrentUser'

const ROLE_KEY: Record<RaciLetter, { key: string; bg: string; fg: string }> = {
  R: { key: 'role_r', bg: '#DBEAFE', fg: '#1D4ED8' },
  A: { key: 'role_a', bg: '#F5F3FF', fg: '#7C3AED' },
  C: { key: 'role_c', bg: '#FEF3C7', fg: '#B45309' },
  Q: { key: 'role_q', bg: '#D1FAE5', fg: '#065F46' },
  I: { key: 'role_i', bg: '#F1F5F9', fg: '#475569' },
}
const ORDER: RaciLetter[] = ['R', 'A', 'C', 'Q', 'I']

export const documentRaciKey = (documentId: string) => ['document-raci', documentId] as const

// `userId` defaults to the signed-in session's user (/auth/me), so any screen can drop it in.
export function MyRaciRole({ documentId, userId: userIdProp }: { documentId: string; userId?: string | null }) {
  const { t } = useTranslation()
  const { data: me } = useCurrentUser()
  const userId = userIdProp ?? me?.id
  const { data: rows = [] } = useQuery<DocumentRaciRow[]>({
    queryKey: documentRaciKey(documentId),
    queryFn:  () => raciApi.list(documentId),
    enabled:  !!userId,
    staleTime: 30_000,
  })

  // One chip per letter; a letter held only on some sections says so in its tooltip.
  const mine = useMemo(() => {
    const active = rows.filter(r => r.userId === userId && !r.removedAt)
    return ORDER
      .map(letter => {
        const held = active.filter(r => r.letter === letter)
        if (held.length === 0) return null
        const wholeDoc = held.some(r => r.sectionId === null)
        return { letter, wholeDoc, sections: held.length }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [rows, userId])

  if (!userId || mine.length === 0) return null

  return (
    <div className="flex flex-none items-center gap-1.5" data-my-raci-role>
      {mine.map(roleEntry => {
        const roleMeta = ROLE_KEY[roleEntry.letter]
        const roleLabel = t(`page.my_raci_role.${roleMeta.key}`)
        return (
          <span
            key={roleEntry.letter}
            title={roleEntry.wholeDoc
              ? t('page.my_raci_role.whole_doc_tooltip', { role: roleLabel })
              : t('page.my_raci_role.sections_tooltip', { count: roleEntry.sections, role: roleLabel })}
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: roleMeta.bg, color: roleMeta.fg }}
          >
            {roleLabel}{roleEntry.wholeDoc ? '' : t('page.my_raci_role.section_suffix')}
          </span>
        )
      })}
    </div>
  )
}
