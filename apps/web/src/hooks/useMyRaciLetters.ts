import { useQuery } from '@tanstack/react-query'
import { raciApi, type DocumentRaciRow, type RaciLetter } from '../api/raci'
import { useCurrentUser } from './useCurrentUser'

// The RACI letters the signed-in user holds on this document (an active row, whole-document or section).
// undefined while loading. Shares its query with the "my role" chip and the tab access check.
export function useMyRaciLetters(documentId: string | undefined): ReadonlySet<RaciLetter> | undefined {
  const { data: me } = useCurrentUser()
  const { data: rows, isLoading } = useQuery<DocumentRaciRow[]>({
    queryKey: ['document-raci', documentId],
    queryFn: () => raciApi.list(documentId!),
    enabled: !!documentId && !!me?.id,
    staleTime: 30_000,
  })
  if (!documentId || !me?.id || isLoading) return undefined
  return new Set((rows ?? []).filter(r => r.userId === me.id && !r.removedAt).map(r => r.letter))
}
