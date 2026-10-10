// Collab provider hook — Phase 2.3.2.
//
// Returns a Yjs Doc + WebsocketProvider when VITE_COLLAB_URL is set,
// null otherwise. Scoped per (documentId, sectionId) room so each
// section is its own CRDT instance — matches the sidecar's URL shape
// /docs/<documentId>/sections/<sectionId>.
//
// Solo mode (no collab server configured) is a null return, which the
// editor branches on to mount StarterKit's history instead of Yjs.

import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export interface CollabProvider {
  doc:      Y.Doc
  provider: WebsocketProvider
  roomId:   string
}

interface Opts {
  documentId: string | undefined | null
  sectionId:  string | undefined | null
}

export function useCollabProvider({ documentId, sectionId }: Opts): CollabProvider | null {
  const [provider, setProvider] = useState<CollabProvider | null>(null)
  const lastRoomRef = useRef<string | null>(null)

  useEffect(() => {
    const url = (import.meta.env.VITE_COLLAB_URL as string | undefined)?.trim()
    if (!url || !documentId || !sectionId) {
      setProvider(null)
      return
    }

    const roomId = `${documentId}:${sectionId}`
    if (lastRoomRef.current === roomId && provider) return

    const doc  = new Y.Doc()
    // Path is baked into the URL; y-websocket's `roomname` arg becomes
    // a query parameter which our sidecar doesn't parse. Pass empty
    // and encode the room into the URL path instead.
    const wsBase = url.replace(/\/$/, '')
    const wsUrl  = `${wsBase}/docs/${encodeURIComponent(documentId)}/sections/${encodeURIComponent(sectionId)}`
    const ws = new WebsocketProvider(wsUrl, '', doc, {
      // Browser session cookie is auto-sent on same-site upgrades.
      // When collab is on a cross-origin host, that host must be
      // same-site (eTLD+1 match) + the API cookie must have
      // SESSION_COOKIE_DOMAIN set — which is already the case for
      // *.clinwrite.ai per bootstrap.
      connect: true,
    })

    lastRoomRef.current = roomId
    setProvider({ doc, provider: ws, roomId })

    return () => {
      ws.destroy()
      doc.destroy()
      lastRoomRef.current = null
    }
  }, [documentId, sectionId])

  return provider
}
