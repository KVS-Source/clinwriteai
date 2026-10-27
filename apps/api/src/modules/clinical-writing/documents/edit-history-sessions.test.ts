import { describe, expect, it } from 'vitest'
import {
  SESSION_IDLE_GAP_SECONDS,
  sessionizeHistory,
  type RawHistoryRow,
} from './edit-history-sessions.js'

function row(partial: Partial<RawHistoryRow> & Pick<RawHistoryRow, 'id' | 'actorId' | 'origin' | 'createdAt'>): RawHistoryRow {
  return {
    documentVersionId:  'ver-1',
    aiCallRecordId:     null,
    revertedFromId:     null,
    canRevert:          true,
    interveningCount:   0,
    interveningByActor: [],
    ...partial,
  }
}

const T = (iso: string) => new Date(iso)

describe('sessionizeHistory', () => {
  it('collapses consecutive manual saves by the same actor within the gap', async () => {
    // Three autosaves 20s apart = one session, newest first.
    const rows = [
      row({ id: 'r3', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:00:40Z') }),
      row({ id: 'r2', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:00:20Z') }),
      row({ id: 'r1', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:00:00Z') }),
    ]
    const sessions = sessionizeHistory(rows)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.sessionEntryCount).toBe(3)
    expect(sessions[0]!.id).toBe('r1')                                      // oldest id (revert target)
    expect(sessions[0]!.createdAt).toBe('2026-10-27T10:00:40.000Z')         // newest ts (display)
    expect(sessions[0]!.sessionStartedAt).toBe('2026-10-27T10:00:00.000Z')  // oldest ts
    expect(sessions[0]!.sessionRawRowIds).toEqual(['r3', 'r2', 'r1'])
  })

  it('starts a new session when the gap exceeds the configured idle', async () => {
    // 11-minute gap between r2 and r1 => two sessions.
    const rows = [
      row({ id: 'r3', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:11:30Z') }),
      row({ id: 'r2', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:11:00Z') }),
      row({ id: 'r1', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:00:00Z') }),
    ]
    const sessions = sessionizeHistory(rows)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]!.sessionEntryCount).toBe(2)
    expect(sessions[1]!.sessionEntryCount).toBe(1)
    expect(sessions[1]!.id).toBe('r1')
  })

  it('never collapses across different actors', async () => {
    const rows = [
      row({ id: 'r3', actorId: 'u2', origin: 'manual', createdAt: T('2026-10-27T10:00:30Z') }),
      row({ id: 'r2', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:00:20Z') }),
      row({ id: 'r1', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:00:00Z') }),
    ]
    const sessions = sessionizeHistory(rows)
    expect(sessions.map(s => [s.actorId, s.sessionEntryCount])).toEqual([
      ['u2', 1],
      ['u1', 2],
    ])
  })

  it('never collapses across different origins (ai vs manual)', async () => {
    const rows = [
      row({ id: 'r3', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:00:30Z') }),
      row({ id: 'r2', actorId: 'u1', origin: 'ai',     createdAt: T('2026-10-27T10:00:20Z') }),
      row({ id: 'r1', actorId: 'u1', origin: 'ai',     createdAt: T('2026-10-27T10:00:00Z') }),
    ]
    const sessions = sessionizeHistory(rows)
    expect(sessions.map(s => [s.origin, s.sessionEntryCount])).toEqual([
      ['manual', 1],
      ['ai',     2],
    ])
  })

  it("never collapses 'undo' or 'restore' rows — explicit user actions get their own row", async () => {
    const rows = [
      row({ id: 'r3', actorId: 'u1', origin: 'undo',   createdAt: T('2026-10-27T10:00:30Z') }),
      row({ id: 'r2', actorId: 'u1', origin: 'undo',   createdAt: T('2026-10-27T10:00:20Z') }),
      row({ id: 'r1', actorId: 'u1', origin: 'manual', createdAt: T('2026-10-27T10:00:00Z') }),
    ]
    const sessions = sessionizeHistory(rows)
    expect(sessions).toHaveLength(3)                       // r3, r2 each solo; r1 solo
    expect(sessions.map(s => s.id)).toEqual(['r3', 'r2', 'r1'])
  })

  it('returns the empty list on empty input', () => {
    expect(sessionizeHistory([])).toEqual([])
  })

  it('preserves AI metadata from any row in the session when the newest lacks it', () => {
    // Second row carries the aiModel; the first (newest) does not. Session
    // should inherit the metadata so UI can still show "AI model X".
    const rows = [
      row({ id: 'r2', actorId: 'u1', origin: 'ai', createdAt: T('2026-10-27T10:00:30Z'), aiModel: null,          aiIntent: null,       promptText: null }),
      row({ id: 'r1', actorId: 'u1', origin: 'ai', createdAt: T('2026-10-27T10:00:00Z'), aiModel: 'claude-test', aiIntent: 'tighten', promptText: 'tighten it' }),
    ]
    const [s] = sessionizeHistory(rows)
    expect(s!.aiModel).toBe('claude-test')
    expect(s!.aiIntent).toBe('tighten')
    expect(s!.promptText).toBe('tighten it')
  })

  it('exports a 10-minute default gap', () => {
    expect(SESSION_IDLE_GAP_SECONDS).toBe(600)
  })
})
