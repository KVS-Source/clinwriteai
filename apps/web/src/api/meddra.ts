import { api } from './client'
import type { MedDRATerm } from '@platform/types'

export const meddraApi = {
  search: (q: string, version = '27.0') =>
    api.get<{ version: string; results: MedDRATerm[] }>(
      `/meddra/search?q=${encodeURIComponent(q)}&version=${version}`,
    ),
}
