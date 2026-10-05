// React Query hooks for the therapeutic-areas taxonomy.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { taxonomyApi, type TherapeuticArea } from '../api/taxonomy'

const taListKey = (opts: { tree?: boolean; includeArchived?: boolean } = {}) =>
  ['taxonomy', 'ta', 'list', !!opts.tree, !!opts.includeArchived] as const

const taOneKey = (code: string) => ['taxonomy', 'ta', code] as const

export function useTherapeuticAreas(opts: { tree?: boolean; includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: taListKey(opts),
    queryFn:  () => taxonomyApi.list(opts),
    staleTime: 5 * 60_000,   // TA list is near-static; cache 5min
  })
}

export function useTherapeuticArea(code: string | undefined) {
  return useQuery({
    queryKey: taOneKey(code ?? ''),
    queryFn:  () => taxonomyApi.get(code!),
    enabled:  !!code,
  })
}

export function useValidateTa(code: string | undefined) {
  return useQuery({
    queryKey: ['taxonomy', 'ta', 'validate', code ?? ''],
    queryFn:  () => taxonomyApi.validate(code!),
    enabled:  !!code && code.length >= 2,
    // Validation lookups are frequent during form entry; cache 30s so a
    // user typing + blurring the same code twice doesn't double-hit the API.
    staleTime: 30_000,
  })
}

export function useCreateTa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; label: string; parentCode?: string; description?: string }) =>
      taxonomyApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxonomy', 'ta', 'list'] }),
  })
}

export function useUpdateTa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, body }: { code: string; body: Partial<Pick<TherapeuticArea, 'label' | 'parentCode' | 'description' | 'status'>> }) =>
      taxonomyApi.update(code, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['taxonomy', 'ta', 'list'] })
      qc.invalidateQueries({ queryKey: taOneKey(vars.code) })
    },
  })
}

export function useArchiveTa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => taxonomyApi.archive(code),
    onSuccess: (_data, code) => {
      qc.invalidateQueries({ queryKey: ['taxonomy', 'ta', 'list'] })
      qc.invalidateQueries({ queryKey: taOneKey(code) })
    },
  })
}
