import { useQuery } from '@tanstack/react-query'
import { raciApi, type DocumentRaciRow } from '../api/raci'
import { useCurrentUser } from './useCurrentUser'

// Which of the Editor and Reviewer View tabs the signed-in user gets on this document, from
// their RACI letters on it (action table rows 6-14).
//  - Editor: the Author (R) only. Reviewer (C), QC (Q) and Approver (A) have no authoring
//    rights at any stage; their actions (review done, QC released, return, comments,
//    checklist) all live in Reviewer View. So anyone holding C, Q or A without R gets no Editor.
//  - Reviewer View: everyone except a pure Author (R with no C/Q/A).
//  - No letter at all (PM, auditor, admin, Informed): both tabs, read-only as the screens decide.
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
  return tabAccessForLetters(mine)
}

/** The tab rule on its own, from a user's active RACI letters on the document. */
export function tabAccessForLetters(letters: ReadonlySet<string>): { editor: boolean; review: boolean } {
  const author = letters.has('R')
  const reviewSide = letters.has('C') || letters.has('Q') || letters.has('A')
  return {
    editor: author || !reviewSide,
    review: reviewSide || !author,
  }
}
