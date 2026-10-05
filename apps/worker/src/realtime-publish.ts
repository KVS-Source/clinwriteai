// Worker → API realtime bridge publisher.
//
// Workers push messages onto the `aurora:realtime` Redis pub/sub channel.
// The API's realtime plugin subscribes to the same channel and forwards
// each message to the appropriate Socket.io room, so UIs see worker-side
// events (like the presence reaper closing a session) in real time
// without round-tripping through the DB.
//
// Scope: single channel with a discriminated-union payload. If we need
// per-tenant isolation later, split channels by tenant. Payload shape
// must match what apps/api/src/modules/platform/realtime/plugin.ts
// subscribes to.

import type { Redis } from 'ioredis'

export const REALTIME_CHANNEL = 'aurora:realtime'

export type RealtimeEvent =
  | {
      kind: 'presence_reaped'
      documentId: string
      sessionIds: string[]
      at: string
    }

export async function publishRealtimeEvent(redis: Redis, event: RealtimeEvent): Promise<void> {
  await redis.publish(REALTIME_CHANNEL, JSON.stringify(event))
}
