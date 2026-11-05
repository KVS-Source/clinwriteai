import { useQuery } from '@tanstack/react-query'
import { raciApi, type DocumentRaciRow } from '../api/raci'
import { useCurrentUser } from './useCurrentUser'

// Which of the Editor and Reviewer View tabs the signed-in user gets on this document, from
// their RACI letters on it. An Author (R) writes, so Reviewer View is not theirs; a Reviewer
// (C) reviews, so the Editor is not theirs. Someone holding both letters, or a letter that
// puts them on both sides (Q, A), keeps both; so does anyone with no letter (PM, auditor).
// undefined while the answer is loading; a failed lookup leaves both tabs open (the server
// still decides what each screen may do).
export function useDocumentTabAccess(documentId: string | undefined): { editor: boolean; review: boolean } | undefined {
  const { data: me, isLoading: meLoading } = useCurrentUser()
  const { data: rows, isLoading: rowsLoading } = useQuery<DocumentRaciRow[]>({
    queryKey:  ['document-raci', documentId],
    queryFn:   () => raciApi.list(documentId!),
    enabled:   !!documentId && !!me?.id,
    staleTime: 30_000,
  })
  if (meLoading || (!!me?.id && rowsLoading)) return undefined
  const mine = new Set((rows ?? []).filter(r => r.userId === me?.id && !r.removedAt).map(r => r.letter))
  const author = mine.has('R')
  const reviewer = mine.has('C')
  const other = mine.has('Q') || mine.has('A')
  return {
    review: !(author && !reviewer && !other),
    editor: !(reviewer && !author && !other),
  }
}
