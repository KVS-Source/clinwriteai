// Persist HTML snapshots back to the API — Phase 2.3.4.
//
// Writes via PATCH /documents/:id/sections/:id — the same endpoint the
// client uses on manual "Save Section" clicks. The API hashes the
// content and only creates a new DocumentVersion when the hash
// changes, so idempotent re-POSTs of the same HTML are cheap.
//
// Auth: the sidecar process has no session cookie of its own. We use
// the X-System-Token shared secret the API accepts for internal
// callers (COLLAB_SYSTEM_TOKEN env). If the token isn't configured,
// persistence falls back to logging only — the schedule still runs,
// just no server-side save.

import type { Logger } from 'pino'
import type { PersistArgs } from './room.js'

export async function persistToApi(apiBaseUrl: string, args: PersistArgs, log: Logger): Promise<void> {
  const token = process.env.COLLAB_SYSTEM_TOKEN
  if (!token) {
    log.warn({ documentId: args.documentId, sectionId: args.sectionId }, 'COLLAB_SYSTEM_TOKEN not set — skipping persistence')
    return
  }

  const url = `${apiBaseUrl.replace(/\/$/, '')}/documents/${args.documentId}/sections/${args.sectionId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-system-token': token,
      // Flag the save as a collaborative-session snapshot so the audit
      // event carries context (not a human click).
      'x-save-source':  `collab:${args.reason}`,
    },
    body: JSON.stringify({ contentHtml: args.html }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`PATCH ${url} returned ${res.status}: ${body.slice(0, 200)}`)
  }
}
