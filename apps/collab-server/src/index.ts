// Yjs collaborative editing sidecar — Phase 2.3 of docs/pivot-plan.md.
//
// Each document editor in the Module A UI opens a websocket to this
// server, scoped to its documentId as the "room". The server:
//   - validates the incoming session cookie (auth hook)
//   - keeps one Y.Doc per room in memory
//   - relays Yjs sync + awareness messages between all clients in the
//     room
//   - persists the room's HTML back to the API when the last client
//     leaves (last-cursor-out), via the existing PATCH endpoint
//
// NOT y-websocket's bundled server — we hand-roll the ws relay so we
// can plug the cookie-auth hook + the DB-persistence callback. The
// wire protocol is still the standard y-protocols sync + awareness,
// so clients can use the stock `y-websocket` provider.
//
// Env (set via /opt/platform/env/collab.env on the VPS):
//   COLLAB_PORT                     default 1234
//   COLLAB_HOST                     default 127.0.0.1 (behind nginx)
//   API_BASE_URL                    e.g. http://127.0.0.1:3011 — used to
//                                   verify sessions + persist HTML
//   COLLAB_SKIP_AUTH                '1' to bypass auth (dev only; refuses
//                                   to start when NODE_ENV=production)
//   COLLAB_PERSIST_DEBOUNCE_MS      default 30000 — min interval between
//                                   HTML snapshots back to the API
//   LOG_LEVEL                       default 'info'

import { WebSocketServer, WebSocket } from 'ws'
import { parse as parseCookie } from 'cookie'
import { IncomingMessage } from 'node:http'
import pino from 'pino'
import { Room, type PersistArgs } from './room.js'
import { verifySession, type SessionIdentity } from './auth.js'
import { persistToApi } from './persistence.js'

const PORT          = Number(process.env.COLLAB_PORT ?? '1234')
const HOST          = process.env.COLLAB_HOST ?? '127.0.0.1'
const API_BASE_URL  = process.env.API_BASE_URL ?? 'http://127.0.0.1:3011'
const SKIP_AUTH     = process.env.COLLAB_SKIP_AUTH === '1'
const DEBOUNCE_MS   = Number(process.env.COLLAB_PERSIST_DEBOUNCE_MS ?? '30000')
const SESSION_COOKIE_NAME = 'aurora_session'

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production'
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true } },
})

if (SKIP_AUTH && process.env.NODE_ENV === 'production') {
  log.fatal('COLLAB_SKIP_AUTH=1 is set in production — refusing to start.')
  process.exit(1)
}

// --- Room registry --------------------------------------------------------

const rooms = new Map<string, Room>()

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId)
  if (!room) {
    room = new Room(roomId, {
      log: log.child({ room: roomId }),
      debounceMs: DEBOUNCE_MS,
      persist: (args: PersistArgs) => persistToApi(API_BASE_URL, args, log),
      onEmpty: () => {
        // Last client left — flush any pending persistence, then evict.
        void room!.flushAndClose().then(() => {
          rooms.delete(roomId)
          log.info({ room: roomId }, 'room evicted')
        })
      },
    })
    rooms.set(roomId, room)
    log.info({ room: roomId }, 'room created')
  }
  return room
}

// --- WebSocket server -----------------------------------------------------

const wss = new WebSocketServer({ host: HOST, port: PORT })

wss.on('listening', () => {
  log.info({ host: HOST, port: PORT, skipAuth: SKIP_AUTH }, 'collab-server listening')
})

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
  const url = req.url ?? '/'

  // Route shape: /docs/<documentId>/sections/<sectionId>
  // The documentId+sectionId pair identifies the room; the API-side
  // persistence callback uses both to PATCH the right section.
  const match = url.match(/^\/docs\/([^/]+)\/sections\/([^/]+)(?:\?.*)?$/)
  if (!match) {
    log.warn({ url }, 'rejecting connection — unknown URL shape')
    ws.close(1008, 'invalid_url')
    return
  }
  const [, documentId, sectionId] = match
  const roomId = `${documentId}:${sectionId}`

  // --- Auth gate ---
  let identity: SessionIdentity | null = null
  if (SKIP_AUTH) {
    identity = { userId: 'anonymous', name: 'Anonymous', email: 'anon@localhost' }
  } else {
    const cookies = parseCookie(req.headers.cookie ?? '')
    const token = cookies[SESSION_COOKIE_NAME]
    if (!token) {
      log.warn({ roomId }, 'rejecting connection — no session cookie')
      ws.close(1008, 'auth_required')
      return
    }
    try {
      identity = await verifySession(API_BASE_URL, token)
    } catch (err) {
      log.warn({ roomId, err }, 'rejecting connection — session verification failed')
      ws.close(1008, 'auth_failed')
      return
    }
  }

  const room = getOrCreateRoom(roomId)
  room.addConnection(ws, identity, { documentId, sectionId })
})

// Graceful shutdown — flush all rooms + close websockets.
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down collab-server')
  wss.close()
  const flushes: Promise<void>[] = []
  for (const room of rooms.values()) flushes.push(room.flushAndClose())
  await Promise.all(flushes)
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT',  () => void shutdown('SIGINT'))
