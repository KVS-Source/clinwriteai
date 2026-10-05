# ADR 0011: Realtime push — Socket.io + Redis pub/sub bridge

**Status**: Accepted
**Date**: 2026-10-05
**Owner**: Platform engineering
**Deciders**: Platform engineering
**Supersedes**: —
**Superseded by**: —

## Context

Module A ships section-level presence (who's editing what, right now). The
REST layer alone (Batch 13) gives polling clients a snapshot — fine, but
sub-second avatar updates need a push channel. Additionally, worker-side
events (presence reaper closing a session) can't reach the browser without
some kind of API ↔ worker bridge.

Three paths were available:
1. Browser long-polling the API /presence endpoint every 2s. Trivial to
   ship; expensive at scale; avatars lag by polling interval.
2. Server-Sent Events (SSE) from the API to the browser. One-way push,
   simpler than websockets.
3. Full websocket channel via Socket.io, with Redis pub/sub bridging the
   worker side.

## Decision

Socket.io on the API (via `fastify-socket.io`) with Redis pub/sub as the
worker ↔ API bridge. Cookie/JWT-authed connections, per-document rooms,
`presence:changed` as the single event name clients subscribe to. Payload
is a bare pointer — clients re-fetch GET /presence on cue, keeping DB
authoritative.

Multi-instance scaling via `@socket.io/redis-adapter` is deferred — single
VPS doesn't need it. The pub/sub bridge is already Redis-backed so wiring
the adapter is a one-line change at that point.

Shipped as commits 5d84e92 (Socket.io push), 58d748c (Redis pub/sub
bridge), a0aa81b (boot-hang fix for Redis-cold case).

## Options considered

### Option A — Long-polling REST (**not chosen**)
- **Pros** No new deps; already have GET /presence.
- **Cons** 2s minimum latency for avatars; N clients × polling interval =
  linear load; browser throttles background tabs' polling.
- **Rough effort / cost** Zero code; ongoing scale drag.

### Option B — Server-Sent Events (**not chosen**)
- **Pros** One-way push; standard; no new deps (Fastify supports streaming).
- **Cons** No worker-side push without a separate bridge. Reconnect
  behavior across HTTP/2 proxies is fiddly. Would still need bidirectional
  for future collab features (cursor sync, co-editing).
- **Rough effort / cost** ~2 days + reconnect-handling.

### Option C — Socket.io + Redis pub/sub (**chosen**)
- **Pros** Bidirectional, battle-tested, standard room semantics, worker
  ↔ API bridge for free via Redis pub/sub. Future-proofs the collab
  features already on the roadmap (cursor sync, section locks).
- **Cons** New deps (`socket.io`, `fastify-socket.io`). Needs Redis
  adapter for multi-instance (deferred). Websocket upgrade path through
  nginx needs the right proxy headers.
- **Rough effort / cost** ~3 days to initial ship + bridge; ~1 day for
  adapter when horizontal scale lands.

## Rationale

Option C's future-proofing was decisive. The collab roadmap (cursor sync,
section locks, co-editing) requires bidirectional push regardless; shipping
long-polling or SSE now means re-shipping as Socket.io later. The worker
bridge via Redis pub/sub reuses the connection BullMQ already uses — no
second pool.

## Consequences

### Positive
- Sub-second presence avatar updates
- Worker-side events (reaper close) reach the browser without a round-trip
  through the DB
- Single-plugin path for future collab features

### Negative
- Multi-instance deployment needs the Redis adapter before horizontal
  scale. Tracked as a Phase 3A follow-up.
- Nginx needs websocket upgrade headers (standard, documented in nginx
  snippets).

### Neutral / downstream work
- `@socket.io/redis-adapter` wiring for cross-instance fanout
- `presence_reaper` emit from the API (currently only the REST routes
  emit the join/heartbeat/left variants; reap is bridged via the
  Redis pub/sub route)

## Compliance implications

- Socket.io auth reuses the same JWT session cookie Fastify uses, so
  revoked sessions can't push to rooms (same semantics as REST).
- No PHI flows over the push channel — payload is a bare pointer; actual
  content is fetched via the REST GET which enforces the same ACL.
- Audit trail: presence writes are tracked in REST handlers; the push
  layer is read-only to the DB.

## References

- `apps/api/src/modules/platform/realtime/plugin.ts` (socket.io attach +
  cookie-JWT auth + Redis subscriber)
- `apps/worker/src/realtime-publish.ts` (worker-side publisher)
- Commits: 5d84e92, 58d748c, a0aa81b
