import { useQuery } from '@tanstack/react-query'
import { raciApi } from '../api/raci'

// Whether the signed-in user may edit this document (its authors only — the
// server rule behind the RACI editor and every content route). undefined until
// the answer arrives, so callers can tell "not yet known" from "view only".
export function useCanEditDocument(documentId: string | undefined): boolean | undefined {
  const { data } = useQuery({
    queryKey:  ['document-raci-can-edit', documentId],
    queryFn:   () => raciApi.canEdit(documentId!),
    enabled:   !!documentId,
    staleTime: 30_000,
  })
  return data?.canEdit
}
