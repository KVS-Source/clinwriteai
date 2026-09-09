import { create } from 'zustand'

export interface WCAGFailure {
  id:       string
  criterion: string
  severity: 'must-fix' | 'should-fix' | 'note'
  slide:    string
  detail:   string
  fixed:    boolean
}

export interface WCAGResult {
  runAt:    string
  passed:   boolean
  score:    number
  failures: WCAGFailure[]
}

export interface LocaleTarget {
  code:    string
  label:   string
  enabled: boolean
  status:  'not-started' | 'translating' | 'in-review' | 'approved'
}

interface FormattingStore {
  wcagResult:         WCAGResult | null
  locales:            LocaleTarget[]
  channels:           string[]
  isRunningWCAG:      boolean
  setWCAGResult:      (r: WCAGResult | null) => void
  setLocales:         (l: LocaleTarget[]) => void
  toggleLocale:       (code: string) => void
  setChannels:        (c: string[]) => void
  setRunningWCAG:     (v: boolean) => void
  markFailureFixed:   (id: string) => void
}

export const useFormattingStore = create<FormattingStore>(set => ({
  wcagResult:    null,
  locales:       [],
  channels:      [],
  isRunningWCAG: false,
  setWCAGResult:  (wcagResult)    => set({ wcagResult }),
  setLocales:     (locales)       => set({ locales }),
  toggleLocale:   (code)          => set(s => ({
    locales: s.locales.map(l => l.code === code ? { ...l, enabled: !l.enabled } : l),
  })),
  setChannels:    (channels)      => set({ channels }),
  setRunningWCAG: (isRunningWCAG) => set({ isRunningWCAG }),
  markFailureFixed: (id)          => set(s => {
    if (!s.wcagResult) return {}
    return {
      wcagResult: {
        ...s.wcagResult,
        failures: s.wcagResult.failures.map(f => f.id === id ? { ...f, fixed: true } : f),
      },
    }
  }),
}))
