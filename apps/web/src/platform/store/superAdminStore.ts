// Super Admin store — GenBioCa-internal state (sPM05, sPM12, sPM18).
// Kept separate from Admin so a client Admin's store subscriptions cannot
// leak Super Admin state (rate cards, framework registry, cross-client config).
import { create } from 'zustand'
import type {
  PlatformConfig, RateCard, RegulatoryFramework, ReportDefinition, ModuleHealthScore,
} from '@platform/types'

interface SuperAdminStore {
  config:               PlatformConfig | null
  rateCards:            RateCard[]
  activeRateCardId:     string | null
  frameworks:           RegulatoryFramework[]
  reports:              ReportDefinition[]
  healthScores:         ModuleHealthScore[]

  setConfig:            (c: PlatformConfig | null) => void
  setRateCards:         (r: RateCard[]) => void
  addRateCard:          (r: RateCard) => void
  setActiveRateCardId:  (id: string | null) => void
  setFrameworks:        (f: RegulatoryFramework[]) => void
  upsertFramework:      (f: RegulatoryFramework) => void
  setReports:           (r: ReportDefinition[]) => void
  setHealthScores:      (h: ModuleHealthScore[]) => void
}

export const useSuperAdminStore = create<SuperAdminStore>(set => ({
  config:            null,
  rateCards:         [],
  activeRateCardId:  null,
  frameworks:        [],
  reports:           [],
  healthScores:      [],

  setConfig:            (config)           => set({ config }),
  setRateCards:         (rateCards)        => set({ rateCards }),
  addRateCard:          (r)                => set(s => ({ rateCards: [...s.rateCards, r] })),
  setActiveRateCardId:  (activeRateCardId) => set({ activeRateCardId }),
  setFrameworks:        (frameworks)       => set({ frameworks }),
  upsertFramework:      (f)                => set(s => ({
    frameworks: s.frameworks.some(x => x.id === f.id) ? s.frameworks.map(x => x.id === f.id ? f : x) : [...s.frameworks, f],
  })),
  setReports:           (reports)          => set({ reports }),
  setHealthScores:      (healthScores)     => set({ healthScores }),
}))
