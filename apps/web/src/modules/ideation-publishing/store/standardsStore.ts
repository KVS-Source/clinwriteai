import { create } from 'zustand'

export interface DOIRecord {
  id:            string
  cardId:        string
  doi:           string
  registeredAt:  string
  registeredBy:  string
}

export interface DublinCoreMetadata {
  cardId:         string
  dcTitle:        string
  dcCreator:      string
  dcSubject:      string
  dcDescription:  string
  dcDate:         string
  dcType:         string
  dcFormat:       string
  dcIdentifier?:  string
  dcRights:       string
  taggedAt:       string
}

export interface ORCIDVerification {
  authorName:    string
  orcid:         string
  verifiedAt:    string
  verifiedBy:    string
}

export interface WCAGResult {
  cardId:         string
  runAt:          string
  level:          'AA' | 'AAA'
  passed:         boolean
  score:          number
  failures:       { criterion: string; detail: string }[]
}

interface StandardsStore {
  doiRecords:       DOIRecord[]
  dublinCore:       DublinCoreMetadata[]
  orcidVerified:    ORCIDVerification[]
  wcagResults:      WCAGResult[]
  addDOI:           (r: DOIRecord) => void
  addDublinCore:    (m: DublinCoreMetadata) => void
  addORCID:         (v: ORCIDVerification) => void
  addWCAG:          (w: WCAGResult) => void
}

export const useStandardsStore = create<StandardsStore>(set => ({
  doiRecords:    [],
  dublinCore:    [],
  orcidVerified: [],
  wcagResults:   [],
  addDOI:        (r) => set(s => ({ doiRecords:    [...s.doiRecords, r]    })),
  addDublinCore: (m) => set(s => ({ dublinCore:    [...s.dublinCore, m]    })),
  addORCID:      (v) => set(s => ({ orcidVerified: [...s.orcidVerified, v] })),
  addWCAG:       (w) => set(s => ({ wcagResults:   [...s.wcagResults, w]   })),
}))
