import { useQuery } from '@tanstack/react-query'
import { documentsApi } from '../api/documents'

// Whether the signed-in user may see this document's checklist (PM, auditor, or the
// document's R, C, Q or A; the server rule behind the checklist route). undefined until
// the answer arrives, so callers can tell "not yet known" from "no".
export function useCanViewChecklist(documentId: string | undefined): boolean | undefined {
  const { data } = useQuery({
    queryKey:  ['document-checklist-access', documentId],
    queryFn:   () => documentsApi.getChecklistAccess(documentId!),
    enabled:   !!documentId,
    staleTime: 30_000,
  })
  return data?.canView
}
