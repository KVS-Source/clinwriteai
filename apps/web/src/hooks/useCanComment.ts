import { useQuery } from '@tanstack/react-query'
import { documentsApi } from '../api/documents'

// Whether the signed-in user may add comments on this document (R, C, Q or A; the
// server rule behind the comment route). undefined until the answer arrives, so
// screens can leave the composer out rather than flash it at someone who can't use it.
export function useCanComment(documentId: string | undefined): boolean | undefined {
  const { data } = useQuery({
    queryKey:  ['document-comment-access', documentId],
    queryFn:   () => documentsApi.getCommentAccess(documentId!),
    enabled:   !!documentId,
    staleTime: 30_000,
  })
  return data?.canAdd
}
