import { create } from 'zustand'
import type {
  IdeationProject, IdeationArtefact, IdeationContentCard, ClaimCurrencyCheck,
  IdeationStage,
} from '@platform/types'

interface IdeationStore {
  projects:             IdeationProject[]
  activeProjectId:      string | null
  activeArtefact:       IdeationArtefact | null
  cards:                IdeationContentCard[]
  claimCurrency:        ClaimCurrencyCheck | null
  stageFilter:          IdeationStage | 'all'
  setProjects:          (p: IdeationProject[]) => void
  setActiveProjectId:   (id: string | null) => void
  setActiveArtefact:    (a: IdeationArtefact | null) => void
  setCards:             (c: IdeationContentCard[]) => void
  setClaimCurrency:     (c: ClaimCurrencyCheck | null) => void
  setStageFilter:       (s: IdeationStage | 'all') => void
  updateCardStatuses:   (cardId: string, kolStatus?: 'pending' | 'approved' | 'rejected', maStatus?: 'pending' | 'approved' | 'rejected') => void
}

function deriveOverallStatus(kolStatus: 'pending' | 'approved' | 'rejected', maStatus: 'pending' | 'approved' | 'rejected'): IdeationContentCard['overallStatus'] {
  if (kolStatus === 'rejected' || maStatus === 'rejected') return 'rejected'
  if (kolStatus === 'approved' && maStatus === 'approved') return 'approved'
  if (kolStatus === 'approved' && maStatus === 'pending')  return 'reviewed'
  if (kolStatus === 'pending')                              return 'under-review'
  return 'uploaded'
}

export const useIdeationStore = create<IdeationStore>(set => ({
  projects:         [],
  activeProjectId:  null,
  activeArtefact:   null,
  cards:            [],
  claimCurrency:    null,
  stageFilter:      'all',
  setProjects:        (projects)        => set({ projects }),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  setActiveArtefact:  (activeArtefact)  => set({ activeArtefact }),
  setCards:           (cards)           => set({ cards }),
  setClaimCurrency:   (claimCurrency)   => set({ claimCurrency }),
  setStageFilter:     (stageFilter)     => set({ stageFilter }),
  updateCardStatuses: (cardId, kolStatus, maStatus) => set(s => ({
    cards: s.cards.map(c => {
      if (c.id !== cardId) return c
      const nextKol = kolStatus ?? c.kolStatus
      const nextMa  = maStatus  ?? c.maStatus
      return { ...c, kolStatus: nextKol, maStatus: nextMa, overallStatus: deriveOverallStatus(nextKol, nextMa) }
    }),
  })),
}))

export { deriveOverallStatus }
