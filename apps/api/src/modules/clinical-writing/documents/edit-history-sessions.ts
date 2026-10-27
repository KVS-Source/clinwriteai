// Edit-session rollup for the per-section history view (sPM-autosave).
//
// With autosave on, a 10-minute writing session produces one EditHistory row
// per debounce fire — fine for Revert granularity, overwhelming for display.
// This helper groups consecutive rows into "sessions" so the panel can show
// one row per writing burst and let the user Revert to the pre-burst state.
//
// Grouping rule — consecutive rows (reverse-chronological) coalesce into one
// session when ALL of:
//   1. Same actorId.
//   2. Same origin (manual OR ai — never cross origins, because the auditor
//      wants to see "the AI touched this run" distinctly from "a human was
//      typing"; also revert flows differ).
//   3. Gap between consecutive rows ≤ SESSION_IDLE_GAP_SECONDS (default 10m).
//
// 'undo' and 'restore' rows never collapse — each is an explicit user action
// and gets its own row no matter the gap.
//
// The returned session carries the OLDEST row's id (that's what Revert needs:
// restoring to its beforeHtml = the content before the whole burst) and the
// NEWEST row's timestamp (the display "when it ended"). sessionStartedAt
// captures the oldest ts for the range display.

export const SESSION_IDLE_GAP_SECONDS = 10 * 60

export interface RawHistoryRow {
  id:                 string
  actorId:            string
  actorName?:         string | null
  origin:             string
  createdAt:          Date | string
  documentVersionId:  string | null
  aiCallRecordId:     string | null
  revertedFromId:     string | null
  promptText?:        string | null
  aiIntent?:          string | null
  aiModel?:           string | null
  canRevert:          boolean
  interveningCount:   number
  interveningByActor: Array<{ actorId: string; actorName: string; count: number }>
}

export interface HistorySession extends RawHistoryRow {
  /** How many raw rows this session collapses — 1 = singleton, not actually collapsed. */
  sessionEntryCount: number
  /** ISO timestamp of the oldest row in the session (sessionStartedAt ≤ createdAt). */
  sessionStartedAt:  string
  /** Ids of every raw row in the session, newest first. Useful for debugging + per-row AI drilldown. */
  sessionRawRowIds:  string[]
}

function tsMs(v: Date | string): number {
  return (v instanceof Date ? v : new Date(v)).getTime()
}

function iso(v: Date | string): string {
  return (v instanceof Date ? v.toISOString() : v)
}

/**
 * Groups consecutive compatible rows into sessions. Input is expected
 * newest-first (as the history endpoint already returns). Output preserves
 * that order.
 */
export function sessionizeHistory(rows: RawHistoryRow[], opts: { gapSeconds?: number } = {}): HistorySession[] {
  const gapMs = (opts.gapSeconds ?? SESSION_IDLE_GAP_SECONDS) * 1000
  const sessions: HistorySession[] = []

  for (const row of rows) {
    const last = sessions[sessions.length - 1]
    const canCoalesce =
      !!last &&
      row.actorId === last.actorId &&
      row.origin === last.origin &&
      row.origin !== 'undo' &&
      row.origin !== 'restore' &&
      // rows come newest-first; the newer row (last) has a greater ts, so
      // gap = last.sessionStartedAt - row.createdAt. We keep collapsing as
      // long as adding `row` (older) extends the session no further back
      // than the configured gap.
      tsMs(last.sessionStartedAt) - tsMs(row.createdAt) <= gapMs

    if (canCoalesce && last) {
      // Extend the existing session backwards. The visible id becomes this
      // older row's id (so Revert targets the pre-session beforeHtml); the
      // display createdAt stays the newest; sessionStartedAt moves back.
      last.sessionEntryCount += 1
      last.sessionStartedAt = iso(row.createdAt)
      last.id = row.id
      last.canRevert = row.canRevert          // revert ability tracks the oldest row
      last.documentVersionId = row.documentVersionId
      last.aiCallRecordId = row.aiCallRecordId ?? last.aiCallRecordId
      last.promptText     = row.promptText    ?? last.promptText
      last.aiIntent       = row.aiIntent      ?? last.aiIntent
      last.aiModel        = row.aiModel       ?? last.aiModel
      last.sessionRawRowIds.push(row.id)
      continue
    }

    sessions.push({
      ...row,
      createdAt:         iso(row.createdAt),
      sessionEntryCount: 1,
      sessionStartedAt:  iso(row.createdAt),
      sessionRawRowIds:  [row.id],
    })
  }

  return sessions
}
