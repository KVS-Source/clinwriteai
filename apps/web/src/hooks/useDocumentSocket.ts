// Shared Socket.io connection for a document room. Opens one socket per
// documentId mount, joins 'doc:<documentId>', and exposes a bare pub/sub
// so individual features (presence, section locks, future collab events)
// can subscribe without each opening their own connection.
//
// Why a shared ref: the API's realtime plugin fans out one emit per room,
// not per listener; opening a socket per feature wastes server fanout and
// multiplies the auth-cookie handshake. One socket per mounted document is
// the right granularity.
//
// Connection target: VITE_API_URL (default '/api' for same-origin). The
// session cookie travels via `withCredentials: true` so the server's JWT
// cookie check passes on handshake. No explicit auth payload is sent.

import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

type Listener<T = unknown> = (payload: T) => void

export interface DocumentSocket {
  readonly connected: boolean
  readonly socket:    Socket | null
  on<T>(event: string, listener: Listener<T>): () => void
}

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export function useDocumentSocket(documentId: string | undefined): DocumentSocket {
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!documentId) return

    // When VITE_API_URL is unset we're same-origin — pass undefined so the
    // socket.io client defaults to window.location origin + /socket.io path.
    const target = API_BASE === '' || API_BASE === '/api' ? undefined : API_BASE
    const socket = io(target, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      // Reconnect indefinitely but back off so a flapping backend doesn't
      // hammer. Default of 20 attempts is too few for a long-held document.
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 10_000,
    })

    socketRef.current = socket
    socket.on('connect',    () => {
      setConnected(true)
      socket.emit('presence:join', documentId)
    })
    socket.on('disconnect', () => setConnected(false))

    return () => {
      try { socket.emit('presence:leave', documentId) } catch { /* ignore */ }
      socket.disconnect()
      socketRef.current = null
      setConnected(false)
    }
  }, [documentId])

  return {
    connected,
    socket: socketRef.current,
    on<T>(event: string, listener: Listener<T>): () => void {
      const s = socketRef.current
      if (!s) return () => {}
      const wrapped = (payload: unknown) => listener(payload as T)
      s.on(event, wrapped)
      return () => { s.off(event, wrapped) }
    },
  }
}
