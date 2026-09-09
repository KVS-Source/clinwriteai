import { create } from 'zustand'
import type { KOLSession } from '@platform/types'

interface KOLStore {
  session:                  KOLSession | null
  transcriptText:           string
  insightsReportText:       string | null
  messagingFramework:       string[]
  isGeneratingInsights:     boolean
  setSession:               (s: KOLSession | null) => void
  setTranscriptText:        (t: string) => void
  setInsightsReportText:    (t: string | null) => void
  setMessagingFramework:    (m: string[]) => void
  setGeneratingInsights:    (v: boolean) => void
}

export const useKOLStore = create<KOLStore>(set => ({
  session:              null,
  transcriptText:       '',
  insightsReportText:   null,
  messagingFramework:   [],
  isGeneratingInsights: false,
  setSession:              (session)              => set({ session }),
  setTranscriptText:       (transcriptText)       => set({ transcriptText }),
  setInsightsReportText:   (insightsReportText)   => set({ insightsReportText }),
  setMessagingFramework:   (messagingFramework)   => set({ messagingFramework }),
  setGeneratingInsights:   (isGeneratingInsights) => set({ isGeneratingInsights }),
}))
