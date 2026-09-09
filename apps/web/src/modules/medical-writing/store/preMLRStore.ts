import { create } from 'zustand'
import type { PreMLRResult, AgenticReport } from '@platform/types'

interface PreMLRStore {
  result:            PreMLRResult | null
  agenticReport:     AgenticReport | null
  isRunning:         boolean
  lastRunAt:         string | null
  setResult:         (result: PreMLRResult | null) => void
  setAgenticReport:  (report: AgenticReport | null) => void
  setRunning:        (running: boolean) => void
  setLastRunAt:      (at: string | null) => void
  acknowledgeIssue:  (issueId: string, acknowledgedBy: string) => void
}

export const usePreMLRStore = create<PreMLRStore>(set => ({
  result:        null,
  agenticReport: null,
  isRunning:     false,
  lastRunAt:     null,
  setResult:         (result)         => set({ result }),
  setAgenticReport:  (agenticReport)  => set({ agenticReport }),
  setRunning:        (isRunning)      => set({ isRunning }),
  setLastRunAt:      (lastRunAt)      => set({ lastRunAt }),
  acknowledgeIssue:  (issueId, by)    => set(s => {
    if (!s.result) return {}
    return {
      result: {
        ...s.result,
        issues: s.result.issues.map(i => i.id === issueId
          ? { ...i, acknowledged: true, acknowledgedBy: by, acknowledgedAt: new Date().toISOString() }
          : i),
      },
    }
  }),
}))
