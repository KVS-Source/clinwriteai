import { create } from 'zustand'
import type { ECTDNode, CTDModuleStatus } from '@platform/types'

interface PublishingLogEntry {
  at:      string
  nodeId:  string
  action:  'created' | 'updated' | 'signed' | 'compiled'
  by:      string
}

interface ECTDStore {
  nodes:            ECTDNode[]
  activeNodeId:     string | null
  publishingLog:    PublishingLogEntry[]
  isCompiling:      boolean
  compiledPct:      number
  setNodes:         (nodes: ECTDNode[]) => void
  setActiveNodeId:  (id: string | null) => void
  updateNodeStatus: (nodeId: string, status: CTDModuleStatus) => void
  appendLog:        (entry: PublishingLogEntry) => void
  setCompiling:     (v: boolean) => void
  setCompiledPct:   (pct: number) => void
}

export const useECTDStore = create<ECTDStore>(set => ({
  nodes:         [],
  activeNodeId:  null,
  publishingLog: [],
  isCompiling:   false,
  compiledPct:   0,
  setNodes:         (nodes)        => set({ nodes }),
  setActiveNodeId:  (activeNodeId) => set({ activeNodeId }),
  updateNodeStatus: (nodeId, status) => set(s => ({
    nodes: s.nodes.map(n => n.id === nodeId ? { ...n, status, lastUpdated: new Date().toISOString() } : n),
  })),
  appendLog:        (entry)        => set(s => ({ publishingLog: [entry, ...s.publishingLog] })),
  setCompiling:     (isCompiling)  => set({ isCompiling }),
  setCompiledPct:   (compiledPct)  => set({ compiledPct }),
}))
