import { useQuery } from '@tanstack/react-query'
import { documentsApi } from '../api/documents'

// What the signed-in user may do with this project's source documents. undefined until
// the answer arrives, so callers can tell "not yet known" from "not allowed".
export function useSourceAccess(projectId: string | undefined): { canView: boolean; canUpload: boolean } | undefined {
  const { data } = useQuery({
    queryKey:  ['source-document-access', projectId],
    queryFn:   () => documentsApi.getSourceAccess(projectId!),
    enabled:   !!projectId,
    staleTime: 30_000,
  })
  return data
}
