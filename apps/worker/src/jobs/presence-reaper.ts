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

const STALE_SECONDS = 90

export const handlePresenceReaper: JobHandler = async (_job, { prisma, log }) => {
  const cutoff = new Date(Date.now() - STALE_SECONDS * 1000)
  const result = await prisma.presenceSession.updateMany({
    where: {
      endedAt: null,
      heartbeatAt: { lt: cutoff },
    },
    data: {
      status: 'ended',
      endedAt: new Date(),
    },
  })

  if (result.count > 0) {
    log.info({ reaped: result.count, cutoff: cutoff.toISOString() }, 'presence sessions reaped')
  } else {
    log.debug({ cutoff: cutoff.toISOString() }, 'presence reaper: no stale sessions')
  }
  return { reaped: result.count }
}
