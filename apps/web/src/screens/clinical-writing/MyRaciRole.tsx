// Header chip(s) showing the signed-in user's RACI role(s) on this document —
// e.g. "Accountable (Approver)". Built from GET /documents/:id/raci (removed
// rows dropped); renders nothing when the user holds no role on the document.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { raciApi, type DocumentRaciRow, type RaciLetter } from '../../api/raci'
import { useCurrentUser } from '../../hooks/useCurrentUser'

const ROLE: Record<RaciLetter, { label: string; bg: string; fg: string }> = {
  R: { label: 'Responsible (Author)',   bg: '#DBEAFE', fg: '#1D4ED8' },
  A: { label: 'Accountable (Approver)', bg: '#F5F3FF', fg: '#7C3AED' },
  C: { label: 'Consulted (Reviewer)',   bg: '#FEF3C7', fg: '#B45309' },
  Q: { label: 'QC (Release)',           bg: '#D1FAE5', fg: '#065F46' },
  I: { label: 'Informed',               bg: '#F1F5F9', fg: '#475569' },
}
const ORDER: RaciLetter[] = ['R', 'A', 'C', 'Q', 'I']

export const documentRaciKey = (documentId: string) => ['document-raci', documentId] as const

// `userId` defaults to the signed-in session's user (/auth/me), so any screen can drop it in.
export function MyRaciRole({ documentId, userId: userIdProp }: { documentId: string; userId?: string | null }) {
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
      {mine.map(m => (
        <span
          key={m.letter}
          title={m.wholeDoc
            ? `Your RACI role on this document: ${ROLE[m.letter].label}`
            : `Your RACI role on ${m.sections} section${m.sections === 1 ? '' : 's'} of this document: ${ROLE[m.letter].label}`}
          className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ backgroundColor: ROLE[m.letter].bg, color: ROLE[m.letter].fg }}
        >
          {ROLE[m.letter].label}{m.wholeDoc ? '' : ' · section'}
        </span>
      ))}
    </div>
  )
}
