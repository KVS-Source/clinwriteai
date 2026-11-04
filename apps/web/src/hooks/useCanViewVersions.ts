import { useQuery } from '@tanstack/react-query'
import { documentsApi } from '../api/documents'

// Whether the signed-in user may see this document's versions and compare them (PM, auditor,
// or the document's R or Q; the server rule behind the version routes). undefined until the
// answer arrives, so callers can tell "not yet known" from "no".
export function useCanViewVersions(documentId: string | undefined): boolean | undefined {
  const { data } = useQuery({
    queryKey:  ['document-version-access', documentId],
    queryFn:   () => documentsApi.getVersionAccess(documentId!),
    enabled:   !!documentId,
    staleTime: 30_000,
  })
  return data?.canView
}
