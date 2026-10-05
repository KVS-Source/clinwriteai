// Presence session reaper — closes stale rows.
//
// Runs every 2 minutes. Flips any presence_session with heartbeatAt older
// than STALE_SECONDS and endedAt=null to status='ended' + endedAt=now.
// Matches the API's PRESENCE_STALE_SECONDS=90s window — this cron just
// catches the ones the client never explicitly closed (crashed tab,
// network blip, battery die).
//
// Idempotent: the WHERE clause makes a repeat run a no-op after the first
// pass. Concurrency=1 at the worker config level means two schedulers
// can't race.

import type { JobHandler } from './types.js'
import { publishRealtimeEvent } from '../realtime-publish.js'

const STALE_SECONDS = 90

export const handlePresenceReaper: JobHandler = async (_job, { prisma, log, redis }) => {
  const cutoff = new Date(Date.now() - STALE_SECONDS * 1000)
  const now = new Date()

  // Load the stale rows BEFORE the update so we have (documentId, sessionId)
  // tuples to broadcast. updateMany doesn't return the rows.
  const stale = await prisma.presenceSession.findMany({
    where: { endedAt: null, heartbeatAt: { lt: cutoff } },
    select: { id: true, documentId: true },
  })
  if (stale.length === 0) {
    log.debug({ cutoff: cutoff.toISOString() }, 'presence reaper: no stale sessions')
    return { reaped: 0 }
  }

  await prisma.presenceSession.updateMany({
    where: { id: { in: stale.map(s => s.id) } },
    data: { status: 'ended', endedAt: now },
  })

  // Group reaped sessions by documentId and publish one event per doc so
  // the API forwards a single Socket.io emit per room (not N emits).
  const byDoc = new Map<string, string[]>()
  for (const s of stale) {
    const list = byDoc.get(s.documentId) ?? []
    list.push(s.id)
    byDoc.set(s.documentId, list)
  }
  for (const [documentId, sessionIds] of byDoc) {
    try {
      await publishRealtimeEvent(redis, {
        kind: 'presence_reaped',
        documentId,
        sessionIds,
        at: now.toISOString(),
      })
    } catch (err) {
      // Pub/sub failure doesn't invalidate the DB write — clients polling
      // GET /presence will still see fresh state within 90s.
      log.warn({ err, documentId, sessionCount: sessionIds.length }, 'realtime publish failed')
    }
  }

  log.info({ reaped: stale.length, docs: byDoc.size, cutoff: cutoff.toISOString() }, 'presence sessions reaped')
  return { reaped: stale.length, docs: byDoc.size }
}
