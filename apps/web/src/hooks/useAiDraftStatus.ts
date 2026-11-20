// useAiDraftStatus — React Query wrapper around GET /documents/:id/ai-draft-status
// with conditional polling.
//
// Polls every 3s while the server-side state is in-flight
// (pending / drafting / validating). Stops polling once the state
// settles (complete / failed / null) — reduces load once there's
// nothing to watch.
//
// Also exposes a derived `summary` object so the chip + toast don't
// each have to recompute the same roll-ups.

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { aiDrafterApi, type AiDraftState, type AiDraftStatusResponse } from '../api/ai-drafter'

/** States that mean the worker chain is still running — keep polling. */
const IN_FLIGHT: ReadonlySet<AiDraftState> = new Set<AiDraftState>([
  'pending', 'drafting', 'validating',
])

export interface AiDraftSummary {
  /** True while the server chain is active (any in-flight state). */
  inFlight:         boolean
  /** 0-100 roll-up — 0 for null, so chips/badges can render without null guards. */
  confidence:       number
  /** True when confidenceOverall is set (first pass finished). */
  hasConfidence:    boolean
  /** 'green' at ≥85, 'amber' 60–84, 'rose' <60. Null when hasConfidence is false. */
  tone:             'green' | 'amber' | 'rose' | null
  totalSections:    number
  flaggedSections:  number
  /** 1-5 while running, final iteration number once settled. 0 before anything runs. */
  currentPass:      number
}

export function useAiDraftStatus(documentId: string | undefined): UseQueryResult<AiDraftStatusResponse> & { summary: AiDraftSummary } {
  const qc = useQueryClient()
  const result = useQuery<AiDraftStatusResponse>({
    queryKey: ['ai-draft-status', documentId],
    queryFn:  () => aiDrafterApi.status(documentId!),
    enabled:  !!documentId,
    // Poll while in-flight, stop otherwise. 3s is the tested cadence —
    // fast enough that the toast feels live, slow enough that a 20-user
    // tenant doesn't thrash the status endpoint.
    refetchInterval: (query) => {
      const state = query.state.data?.state
      if (state && IN_FLIGHT.has(state)) return 3_000
      return false
    },
    // Mild staleness so a quick nav back to the editor doesn't fire an
    // extra call — the polling interval covers freshness during drafts.
    staleTime: 2_000,
  })

  const data = result.data

  // Invalidate ['document', documentId] whenever we see the drafter has
  // written new content — the TBDs tab, the section list, and the editor
  // body all key off that query, so writers watching the drafter work see
  // sections stream in without clicking Refresh. Detected via:
  //   - any transition into a settled state (complete/failed/cancelled)
  //   - a change in the number of sections the status endpoint reports
  //     the drafter has touched (`sections.length` grows as the worker
  //     commits each one)
  // Debounced to once per unique signal so we don't re-render on every poll.
  const lastSignalRef = useRef<string | null>(null)
  useEffect(() => {
    if (!documentId || !data) return
    const signal = `${data.state}:${data.sections.length}:${data.lastPassNumber ?? 0}`
    if (signal === lastSignalRef.current) return
    lastSignalRef.current = signal
    void qc.invalidateQueries({ queryKey: ['document', documentId] })
  }, [documentId, data, qc])
  const inFlight = !!(data?.state && IN_FLIGHT.has(data.state))
  const confidenceOverall = data?.confidenceOverall ?? null
  const hasConfidence = confidenceOverall !== null
  const confidence = confidenceOverall ?? 0
  const tone: AiDraftSummary['tone'] = hasConfidence
    ? (confidence >= 85 ? 'green' : confidence >= 60 ? 'amber' : 'rose')
    : null
  const totalSections = data?.sections.length ?? 0
  const flaggedSections = data?.sections.filter(s => (s.flags?.length ?? 0) > 0).length ?? 0
  const currentPass = data?.lastPassNumber ?? 0

  const summary: AiDraftSummary = {
    inFlight, confidence, hasConfidence, tone,
    totalSections, flaggedSections, currentPass,
  }

  return { ...result, summary }
}
