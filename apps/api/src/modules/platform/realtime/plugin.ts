// Realtime Socket.io plugin — push channel for presence (and future
// collaboration features). Scope limited to presence for now; the
// surface is designed so additional event namespaces can land without
// a plugin rewrite.
//
// Authentication: on connect, verify the same JWT session cookie Fastify
// uses for REST. Rejected sockets never reach a room. The verified user
// is attached to socket.data so emits can filter per-user if needed.
//
// Multi-instance scaling: deferred. Single-instance only until the
// @socket.io/redis-adapter is wired. In practice this means a user
// connected to instance A won't see presence updates emitted from
// instance B. Fine for the single-VPS QA deployment; must land before
// prod horizontal scale.
//
// Rooms: 'doc:<documentId>' — joined on request from the client. No
// server-side ACL on join: the REST GET /documents/:id/presence already
// enforces who can see what; Socket.io is purely a push channel for the
// same payload. Documented inline so the gap is explicit.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifySocketIO from 'fastify-socket.io'
import { Server as SocketServer, type Socket } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { Redis } from 'ioredis'
import { SESSION_COOKIE_NAME, type SessionClaims } from '../../../auth/jwt.js'

// Shared channel name — must match apps/worker/src/realtime-publish.ts.
// Could extract to a shared package when either side grows another consumer.
const REALTIME_CHANNEL = 'aurora:realtime'

// Worker-side event shapes we expect to forward to Socket.io rooms.
// Keeping the discriminated union here mirrors what the worker publishes;
// adding a kind on the worker side needs a matching case here.
type WorkerRealtimeEvent =
  | {
      kind: 'presence_reaped'
      documentId: string
      sessionIds: string[]
      at: string
    }

/**
 * Minimal cookie-header parser. We only need to find one named cookie;
 * pulling in the full `cookie` or `@fastify/cookie` package would be the
 * same ~5 lines plus a type-definitions mismatch (parse isn't exported
 * from @fastify/cookie's .d.ts even though it exists at runtime).
 */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

export interface PresenceChangedPayload {
  documentId: string
  // When the REST route finishes a write, we broadcast one of these so
  // clients know to re-fetch the authoritative snapshot via GET /presence.
  // Keeping the payload a bare pointer (not the full snapshot) avoids a
  // consistency gap between the socket event and the DB — clients always
  // pull from the DB on cue.
  reason: 'joined' | 'heartbeat' | 'left' | 'reaped'
  sessionId: string
  userId: string
  sectionId: string
  at: string
}

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketServer
    emitPresenceChanged: (payload: PresenceChangedPayload) => void
  }
}

const realtimePlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifySocketIO, {
    cors: {
      origin: app.env.CORS_ORIGIN,
      credentials: app.env.CORS_CREDENTIALS,
    },
    // Keep ping interval generous enough that mobile browsers aren't
    // reconnecting during normal use, but short enough that a dead
    // connection is detected within ~a minute.
    pingInterval: 25_000,
    pingTimeout: 60_000,
  })

  // Cross-instance fanout via @socket.io/redis-adapter. On a single VPS
  // this is a no-op (one process = one adapter sees all its own emits).
  // When horizontal scale lands (N replicas behind a sticky LB), the
  // adapter publishes every emit onto a Redis pub/sub channel so other
  // replicas can forward it to their own connected sockets.
  //
  // Needs two separate Redis connections (pub + sub) because ioredis sub
  // mode is sticky. Both share the same URL as the queue plugin's main
  // connection but open their own sockets. Fire-and-forget — if Redis is
  // cold at boot, ioredis buffers and the adapter attaches on reconnect.
  const pubClient = new Redis(app.env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false })
  const subClient = pubClient.duplicate()
  pubClient.on('error', (err) => app.log.warn({ err: err.message }, 'socket.io adapter pub redis error'))
  subClient.on('error', (err) => app.log.warn({ err: err.message }, 'socket.io adapter sub redis error'))
  app.io.adapter(createAdapter(pubClient, subClient))

  app.io.use(async (socket: Socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME)
      if (!token) return next(new Error('no session cookie'))

      // Use the same @fastify/jwt verifier the REST layer uses so a
      // token revocation / expiry here matches REST behaviour.
      const claims = app.jwt.verify<SessionClaims>(token)
      const session = await app.prisma.session.findUnique({ where: { id: claims.jti } })
      if (!session || session.revokedAt || session.expiresAt < new Date()) {
        return next(new Error('session invalid'))
      }
      const user = await app.prisma.user.findUnique({ where: { id: claims.sub } })
      if (!user || user.status !== 'active') return next(new Error('user inactive'))

      socket.data.userId = user.id
      socket.data.role = user.role
      next()
    } catch (err) {
      next(err instanceof Error ? err : new Error('auth failed'))
    }
  })

  app.io.on('connection', (socket) => {
    const userId = socket.data.userId as string
    app.log.debug({ socketId: socket.id, userId }, 'socket connected')

    // Client calls this when the user opens a document. No server-side
    // ACL — mirroring the REST GET /presence check happens there, not here.
    socket.on('presence:join', (documentId: string, ack?: (ok: boolean) => void) => {
      if (typeof documentId !== 'string' || !documentId) {
        ack?.(false)
        return
      }
      void socket.join(`doc:${documentId}`)
      ack?.(true)
    })

    socket.on('presence:leave', (documentId: string, ack?: (ok: boolean) => void) => {
      if (typeof documentId !== 'string' || !documentId) {
        ack?.(false)
        return
      }
      void socket.leave(`doc:${documentId}`)
      ack?.(true)
    })

    socket.on('disconnect', (reason) => {
      app.log.debug({ socketId: socket.id, userId, reason }, 'socket disconnected')
    })
  })

  // Decorator the REST routes call after a presence write. Broadcasts to
  // every socket currently in the doc's room; recipients then re-fetch
  // the snapshot via GET /presence (keeps the DB authoritative).
  app.decorate('emitPresenceChanged', (payload: PresenceChangedPayload) => {
    app.io.to(`doc:${payload.documentId}`).emit('presence:changed', payload)
  })

  // --- Worker → Socket.io bridge ----------------------------------------
  // Dedicated Redis subscriber connection (ioredis sub mode is sticky — a
  // SUBSCRIBE'd connection can't do other commands). Shares the queue
  // plugin's connection string but opens its own socket.
  const subscriber = new Redis(app.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  })

  subscriber.on('error', (err) => {
    // Ioredis auto-reconnects. One log per error is enough; don't crash
    // the API if Redis blips.
    app.log.warn({ err: err.message }, 'realtime subscriber redis error')
  })

  // Fire-and-forget the SUBSCRIBE — mirrors the queue plugin's cron
  // registration pattern. Awaiting the subscribe would block plugin
  // boot past Fastify's 10s plugin-timeout window when Redis is cold.
  // ioredis buffers the subscribe command and replays it on reconnect,
  // so a late Redis startup still lands the subscription without a
  // plugin restart.
  void subscriber.subscribe(REALTIME_CHANNEL).catch((err) => {
    app.log.warn({ err: err?.message ?? String(err) }, 'realtime: SUBSCRIBE failed, will retry on reconnect')
  })

  subscriber.on('message', (channel, raw) => {
    if (channel !== REALTIME_CHANNEL) return
    let event: WorkerRealtimeEvent
    try {
      event = JSON.parse(raw) as WorkerRealtimeEvent
    } catch {
      app.log.warn({ raw }, 'realtime subscriber: malformed JSON on channel')
      return
    }
    switch (event.kind) {
      case 'presence_reaped': {
        // Fan one emit per reaped session into the doc's room. UIs re-fetch
        // GET /presence on 'presence:changed' — same contract as the
        // REST-emitted 'left' event.
        for (const sid of event.sessionIds) {
          app.io.to(`doc:${event.documentId}`).emit('presence:changed', {
            documentId: event.documentId,
            reason: 'reaped',
            sessionId: sid,
            userId: '',
            sectionId: '',
            at: event.at,
          } satisfies PresenceChangedPayload)
        }
        break
      }
      default: {
        // Future kinds — exhaustiveness check via never would be nice but
        // the API ships before the worker on some deploy windows, so
        // tolerate unknown kinds silently.
        app.log.debug({ event }, 'realtime subscriber: unknown event kind')
      }
    }
  })

  app.addHook('onClose', async () => {
    try {
      await subscriber.unsubscribe(REALTIME_CHANNEL)
    } catch {
      // ignore — connection may already be torn down
    }
    await subscriber.quit().catch(() => undefined)
    // Adapter pub/sub clients too — otherwise the process hangs waiting
    // for the ioredis sockets to close.
    await pubClient.quit().catch(() => undefined)
    await subClient.quit().catch(() => undefined)
  })
}

export default fp(realtimePlugin, {
  name: 'realtime',
  dependencies: ['prisma', 'auth'],
})
