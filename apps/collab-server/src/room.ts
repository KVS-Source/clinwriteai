// Y.Doc per editing room — Phase 2.3.1.
//
// Owns one Y.Doc, a connection pool (clients in this room), the
// Yjs sync + awareness protocol handlers, and a debounced persistence
// callback.
//
// Protocol wire format: standard y-protocols/sync + y-protocols/awareness.
// This means the stock @hocuspocus/* AND the stock y-websocket client
// providers both work out of the box.

import * as Y from 'yjs'
import * as syncProtocol      from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import { encoding, decoding } from 'lib0'
import { WebSocket } from 'ws'
import type { Logger } from 'pino'
import type { SessionIdentity } from './auth.js'

// Message types per the y-protocols convention.
const MESSAGE_SYNC      = 0
const MESSAGE_AWARENESS = 1

export interface PersistArgs {
  documentId: string
  sectionId:  string
  html:       string
  reason:     'last_client_leaves' | 'debounce'
}

export interface RoomOpts {
  log:        Logger
  debounceMs: number
  persist:    (args: PersistArgs) => Promise<void>
  onEmpty:    () => void
}

interface Conn {
  ws:        WebSocket
  identity:  SessionIdentity
  documentId: string
  sectionId:  string
}

export class Room {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  private readonly conns = new Set<Conn>()
  private persistTimer:  NodeJS.Timeout | null = null
  private lastPersistedHtml: string = ''

  constructor(private readonly roomId: string, private readonly opts: RoomOpts) {
    this.awareness.setLocalState(null)

    // Any Yjs doc update → schedule persistence snapshot. The debounce
    // means a burst of keystrokes produces one API call, not N.
    this.doc.on('update', () => this.schedulePersist('debounce'))
  }

  addConnection(ws: WebSocket, identity: SessionIdentity, meta: { documentId: string; sectionId: string }): void {
    const conn: Conn = { ws, identity, documentId: meta.documentId, sectionId: meta.sectionId }
    this.conns.add(conn)
    this.opts.log.info({ user: identity.userId, size: this.conns.size }, 'client joined')

    ws.binaryType = 'arraybuffer'

    // Send the current doc state to the fresh client.
    this.sendSyncStep1(ws)
    this.sendAwarenessUpdate(ws, Array.from(this.awareness.getStates().keys()))

    ws.on('message', (data: Buffer | ArrayBuffer) => {
      try {
        this.handleMessage(ws, new Uint8Array(data as ArrayBuffer))
      } catch (err) {
        this.opts.log.warn({ err }, 'message handler threw')
      }
    })

    const close = () => {
      this.conns.delete(conn)
      // Clear this client's awareness state so other clients see them disappear.
      awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], null)
      this.opts.log.info({ user: identity.userId, size: this.conns.size }, 'client left')
      if (this.conns.size === 0) this.opts.onEmpty()
    }
    ws.on('close', close)
    ws.on('error', () => close())

    // Broadcast awareness changes to all other clients.
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = [...added, ...updated, ...removed]
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
      const msg = encoding.toUint8Array(encoder)
      for (const c of this.conns) {
        if (c.ws === ws) continue
        if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg)
      }
    })
  }

  private handleMessage(ws: WebSocket, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data)
    const encoder = encoding.createEncoder()
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, null)
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder))
        break
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), ws)
        break
      }
    }
  }

  private sendSyncStep1(ws: WebSocket): void {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    ws.send(encoding.toUint8Array(encoder))
  }

  private sendAwarenessUpdate(ws: WebSocket, clientIds: number[]): void {
    if (clientIds.length === 0) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds))
    ws.send(encoding.toUint8Array(encoder))
  }

  // --- Persistence ---

  /**
   * Read the current doc's HTML representation. The client-side
   * TipTap/Yjs binding writes to a Y.XmlFragment named 'default'
   * (TipTap's default). We serialise that back to HTML via a simple
   * walker — adequate for the Phase 2.1 extensions (headings, bold,
   * italic, underline, lists, blockquote, link, placeholder).
   */
  private getHtml(): string {
    const fragment = this.doc.getXmlFragment('default')
    return xmlFragmentToHtml(fragment)
  }

  private schedulePersist(reason: 'debounce'): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistNow(reason)
    }, this.opts.debounceMs)
  }

  private async persistNow(reason: PersistArgs['reason']): Promise<void> {
    const html = this.getHtml()
    if (html === this.lastPersistedHtml) return
    // All conns share the same (documentId, sectionId); pull from any.
    const anyConn = this.conns.values().next().value
    if (!anyConn) return
    try {
      await this.opts.persist({
        documentId: anyConn.documentId,
        sectionId:  anyConn.sectionId,
        html,
        reason,
      })
      this.lastPersistedHtml = html
      this.opts.log.debug({ reason, bytes: html.length }, 'persisted room')
    } catch (err) {
      this.opts.log.error({ err, reason }, 'persistence failed; will retry on next update')
    }
  }

  async flushAndClose(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (this.conns.size === 0 && this.lastPersistedHtml !== this.getHtml()) {
      await this.persistNow('last_client_leaves')
    }
    for (const c of this.conns) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.close()
    }
    this.conns.clear()
  }
}

// --- Y.XmlFragment → HTML serialiser --------------------------------------

/**
 * Walks a Y.XmlFragment and returns an HTML string. Minimal but covers
 * every node TipTap's StarterKit + extensions emit for Module A today:
 * paragraph, heading (2-4), bold/italic/underline marks, bulletList /
 * orderedList / listItem, blockquote, link, hardBreak.
 *
 * For richer nodes later (tables, custom provenance spans) extend
 * nodeToHtml below.
 */
function xmlFragmentToHtml(fragment: Y.XmlFragment): string {
  let out = ''
  fragment.forEach(child => {
    out += nodeToHtml(child)
  })
  return out
}

function nodeToHtml(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) {
    return escapeHtml(node.toString())
  }
  if (node instanceof Y.XmlHook) return ''

  const el = node as Y.XmlElement
  const tag = el.nodeName
  const attrs = el.getAttributes()

  let inner = ''
  el.forEach(child => { inner += nodeToHtml(child as Y.XmlElement | Y.XmlText | Y.XmlHook) })

  const attrString = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('')

  // Void elements (TipTap's hardBreak)
  if (tag === 'hardBreak' || tag === 'br') return '<br/>'

  return `<${tag}${attrString}>${inner}</${tag}>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
