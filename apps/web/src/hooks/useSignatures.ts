// React Query hooks for the Part 11 e-signature chain.
//
// All hooks return the same shape as @tanstack/react-query — components
// destructure { data, isLoading, mutate } as usual. Mutations auto-invalidate
// the related chain query so UI stays in sync without manual
// queryClient.invalidateQueries() calls at the component level.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { signaturesApi, type InitiateChainBody, type SignRecordBody } from '../api'

const chainsKey = (documentId: string) => ['signatures', 'chains', documentId] as const
const chainKey  = (chainId: string) => ['signatures', 'chain', chainId] as const

export function useSignatureChains(documentId: string) {
  return useQuery({
    queryKey: chainsKey(documentId),
    queryFn:  () => signaturesApi.listChains(documentId),
    enabled:  !!documentId,
  })
}

export function useSignatureChain(chainId: string | undefined) {
  return useQuery({
    queryKey: chainKey(chainId ?? ''),
    queryFn:  () => signaturesApi.getChain(chainId!),
    enabled:  !!chainId,
  })
}

export function useInitiateSignatureChain(documentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InitiateChainBody) => signaturesApi.initiateChain(documentId, body),
    onSuccess: (chain) => {
      qc.invalidateQueries({ queryKey: chainsKey(documentId) })
      qc.setQueryData(chainKey(chain.id), chain)
    },
  })
}

export function useSignRecord(opts: { chainId: string; documentId: string }) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ recordId, body }: { recordId: string; body: SignRecordBody }) =>
      signaturesApi.signRecord(recordId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chainKey(opts.chainId) })
      qc.invalidateQueries({ queryKey: chainsKey(opts.documentId) })
    },
  })
}

export function useCancelSignatureChain(opts: { chainId: string; documentId: string }) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cancelReason: string) => signaturesApi.cancelChain(opts.chainId, cancelReason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chainKey(opts.chainId) })
      qc.invalidateQueries({ queryKey: chainsKey(opts.documentId) })
    },
  })
}
