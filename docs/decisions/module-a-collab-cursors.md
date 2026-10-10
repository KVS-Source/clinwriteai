# Module A collaborative cursors — decision + runway

Written 2026-10-08 as the Phase 2.3 scoping doc. TipTap + Yjs is the
standard stack; this doc commits to that choice and lays out what has
to land on the server side before the client extension is useful.

Review owner: Engineering + Product. Status: **recommended, not yet
implemented**.

---

## What "collaborative cursors" means in Module A

Two concepts the industry sometimes conflates:

1. **Section-level presence** (shipped Phase 1 Arc A2) — avatars at
   the top of the document editor showing which users are present on
   this document, grouped by section. Real-time via Socket.io
   `presence:changed` + REST snapshot at
   [`presenceApi.snapshot`](../../apps/web/src/api/presence.ts).
2. **In-document cursor + selection sync + CRDT merge** (this doc) —
   each collaborator's cursor is visible to the others inside the
   editable section, keystrokes merge via a conflict-free replicated
   data type (CRDT), and offline reconciliation is automatic.

Only #2 is open. Everything on this page is about #2.

## The stack

**TipTap Collaboration extension** + **Yjs** + a **sync transport**.

| Layer | Choice | Why |
|-------|--------|-----|
| CRDT | **Yjs** | Industry default. Mature, small, battle-tested. |
| Editor binding | `@tiptap/extension-collaboration` + `@tiptap/extension-collaboration-cursor` | First-party TipTap integration we're already set up for. Zero adapter code. |
| Sync transport | **y-websocket** (sidecar service) | Standard Yjs server. Rooms-based routing; one room per `documentId`. Supports persistence callback. |
| Awareness channel | Yjs built-in awareness | Carries cursor positions + user profile (name, colour). Separate from the document state. |
| Persistence | Postgres via y-leveldb → migration script, OR snapshot into `sections.content_html` on debounce | See **Persistence model** below. |

## Server-side infrastructure gap

Collaborative cursors need a **persistent Yjs room per document**. No
such service runs on our VPS today. Three options for how to add it:

### Option A — Node sidecar on the VPS (recommended)

Run `y-websocket` on port `1234` behind nginx reverse-proxy at
`wss://api.clinwrite.ai/collab`. One systemd unit + an nginx
`proxy_pass` block. Shares the API's Postgres via a snapshot callback
every 30s (or on last-cursor-leaves event).

**Pros:** Minimal surface area. Same deploy model as the API +
worker. No new infra vendor.

**Cons:** Horizontal scale is not free — y-websocket is in-memory per
process. For >50 concurrent editors per document we'd need a Yjs
cluster adapter (`y-redis`) and multiple instances. Won't matter until
we have multi-tenant load.

### Option B — Fastify route + Socket.io binding

Fold the sync transport into our existing `fastify-socket.io` plugin
using `y-socket.io`. Reuses the auth hook + presence namespace. Same
process as the API — one more thing to crash the API if a Yjs memory
leak lands.

**Pros:** No sidecar. One deploy artifact. Auth re-use is trivial.

**Cons:** Yjs memory model doesn't love living in the same process as
Fastify's HTTP handlers. Hard to tune GC without affecting API latency.
Harder to scale independently if presence turns into the hot path.

### Option C — Hosted (Liveblocks / Hocuspocus Cloud)

Rent a Yjs backend. Zero infra on our side; vendor handles
persistence + scale + presence.

**Pros:** Fastest to ship. No ops burden.

**Cons:** Procurement + budget. One more vendor BAA for compliance
review (editor data would transit a third party). PHI exposure
depending on content — likely requires DPA + BAA. See Arc 12 external
engagements.

**Recommendation: Option A** for the demo + first production run.
Sidecar is cheap to run, easy to audit for compliance, and the
migration to Option C is a URL swap when scale demands.

## Persistence model

Two layers to decide:

1. **Live-session state** — Yjs document in memory on the sidecar.
   Discarded when the last client leaves + the final snapshot is
   taken.
2. **Durable state** — stored in `sections.content_html` as HTML (what
   we have today). Yjs's internal binary document state (Y.Doc) is
   NOT persisted beyond the session — on next open we re-hydrate from
   the HTML.

**Trade-off:** This means **document history during a session is
lost once everyone leaves**. For a 30-minute collaborative edit
session that's fine (final result is on disk, Part 11 audit records
the save). For long-running async collaboration with intermittent
offline edits (Google-Docs style) we'd need to persist the Y.Doc
binary too.

Phase 2.3 recommendation: ship HTML-only persistence first. Add
Y.Doc persistence (via a `y_doc_snapshots` table or filesystem blob)
in Phase 2.4 if async offline editing becomes a real use case.

## What the client extension gives us for free

- Cursor-position-per-user with user profile + colour (name tooltip
  on hover).
- Selection highlights per user.
- Conflict-free merge of concurrent edits.
- Offline-tolerant — a client that drops its connection and reconnects
  reconciles automatically.

## Pre-work on the client (safe to land now)

The following are additive to Phase 2.1 and don't require the sidecar:

- Package the client-side "which colour am I in this room" calculator
  (currently `avatarColor()` in DocumentEditor) into a shared helper
  so the Collaboration cursor extension consumes the same hash.
- Add a `VITE_COLLAB_URL` env var reading, default `null` — the
  Collaboration extensions only mount when it's set.
- Add a `useCollabProvider(documentId)` hook that returns `null` when
  the env is unset so the editor silently runs in solo mode.

## What's blocked until Option A ships

- Installing `@tiptap/extension-collaboration` +
  `@tiptap/extension-collaboration-cursor` + `yjs` + `y-websocket` in
  `apps/web`.
- Mounting the extensions in `RichTextEditor.tsx` conditionally on
  `VITE_COLLAB_URL` being set.
- Deploy: new systemd unit `platform-collab.service` running
  `y-websocket --port 1234 --host 127.0.0.1` + nginx proxy block for
  `wss://api.clinwrite.ai/collab`.
- Auth: Yjs rooms are documentId-scoped; the sidecar needs to verify
  the session cookie before admitting a client (prevents cross-tenant
  room-jacking). y-websocket supports a per-connection auth callback.

## Related

- Section-level presence (shipped): [`apps/web/src/hooks/usePresence.ts`](../../apps/web/src/hooks/usePresence.ts)
- TipTap editor: [`apps/web/src/screens/clinical-writing/RichTextEditor.tsx`](../../apps/web/src/screens/clinical-writing/RichTextEditor.tsx)
- Socket.io realtime plugin: [`apps/api/src/modules/platform/realtime/plugin.ts`](../../apps/api/src/modules/platform/realtime/plugin.ts)
- Compliance DPIA/BAA considerations: `project_phase_5_deferrals` memory
