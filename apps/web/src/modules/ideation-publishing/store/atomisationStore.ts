import { create } from 'zustand'
import type { AtomisedContent, ChannelFormat } from '@platform/types'

interface AtomisationStore {
  adaptations:         AtomisedContent[]
  generatingChannels:  ChannelFormat[]
  setAdaptations:      (a: AtomisedContent[]) => void
  addAdaptation:       (a: AtomisedContent) => void
  updateAdaptation:    (id: string, patch: Partial<AtomisedContent>) => void
  setGenerating:       (channels: ChannelFormat[]) => void
  startGenerating:     (channel: ChannelFormat) => void
  finishGenerating:    (channel: ChannelFormat) => void
}

export const useAtomisationStore = create<AtomisationStore>(set => ({
  adaptations:        [],
  generatingChannels: [],
  setAdaptations:  (adaptations) => set({ adaptations }),
  addAdaptation:   (a) => set(s => ({ adaptations: [...s.adaptations, a] })),
  updateAdaptation: (id, patch) => set(s => ({
    adaptations: s.adaptations.map(a => a.id === id ? { ...a, ...patch } : a),
  })),
  setGenerating:   (generatingChannels) => set({ generatingChannels }),
  startGenerating: (channel) => set(s => ({
    generatingChannels: s.generatingChannels.includes(channel) ? s.generatingChannels : [...s.generatingChannels, channel],
  })),
  finishGenerating: (channel) => set(s => ({
    generatingChannels: s.generatingChannels.filter(c => c !== channel),
  })),
}))
