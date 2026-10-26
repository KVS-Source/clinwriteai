// Audit plugin: what the onResponse hook and the repo wrapper record.
// Boots a minimal Fastify with the real plugin and a fake repository that
// just collects the events that would be written to the chain.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { AuditEventShape } from './hash.js'

const written: AuditEventShape[] = []

vi.mock('./postgres-repository.js', () => ({
  PostgresAuditRepository: class {
    async append(event: AuditEventShape) {
      written.push(event)
      return { id: String(written.length), rowHash: `hash-${written.length}` }
    }
    async listForEntity() { return [] }
    async verifyChain() { return { intact: true, firstBreakAt: null, unexpectedBreaks: [], exceptions: [] } }
  },
}))

const { default: auditPlugin } = await import('./plugin.js')

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  // Stand-ins for the plugins the audit plugin depends on.
  await app.register(fp(async a => { a.decorate('prisma', {} as never) }, { name: 'prisma' }))
  await app.register(fp(async a => {
    a.decorate('platformMetrics', { auditEventsTotal: { inc: () => {} } } as never)
  }, { name: 'platform-metrics' }))
  app.decorate('secrets', { getSecret: async () => 'x'.repeat(40) } as never)
  // Fake auth: the user comes from a header so tests can switch actors.
  app.addHook('onRequest', async request => {
    const id = request.headers['x-user']
    if (typeof id === 'string') (request as unknown as { user: unknown }).user = { id, role: 'admin' }
  })
  await app.register(auditPlugin)

  // A handler that writes its own named event, like the real routes do.
  app.post('/things', async (request, reply) => {
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: 'u1', action: 'thing_created', entityType: 'thing', entityId: 't1',
      details: { note: 'hello' }, ipAddress: null,
    })
    const fail = (request.query as { fail?: string }).fail
    return reply.code(fail ? 400 : 200).send({ ok: !fail })
  })
  // A handler with no named event.
  app.post('/plain', async () => ({ ok: true }))
  app.post('/boom', async (_req, reply) => reply.code(500).send({ error: 'x' }))
  app.get('/read', async () => ({ ok: true }))
  // Presence routes (same URL patterns as the real ones).
  app.post('/documents/:documentId/presence', async () => ({ ok: true }))
  app.patch('/documents/:documentId/presence/:sessionId/heartbeat', async () => ({ ok: true }))
  // Document read, as the real document route does it.
  app.get('/documents/:documentId', async (request) => {
    const { documentId } = request.params as { documentId: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: 'u1', action: 'phi_document_accessed', entityType: 'document', entityId: documentId,
      details: { module: 'A' }, ipAddress: null,
    })
    return { ok: true }
  })
  await app.ready()
  return app
}

// onResponse hooks run after the reply is sent; give them a tick to finish.
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

describe('audit plugin', () => {
  let app: FastifyInstance
  beforeEach(async () => { written.length = 0; app = await buildApp() })
  afterEach(async () => { vi.useRealTimers(); await app.close() })

  describe('named event + request row (merge)', () => {
    it('writes only the named event when the handler wrote one and it succeeded', async () => {
      await app.inject({ method: 'POST', url: '/things' })
      await settle()
      expect(written.map(e => e.action)).toEqual(['thing_created'])
    })

    it('adds requestId, method and path to the named event, without overriding its own details', async () => {
      await app.inject({ method: 'POST', url: '/things' })
      await settle()
      const d = written[0]!.details
      expect(d.method).toBe('POST')
      expect(d.path).toBe('/things')
      expect(typeof d.requestId).toBe('string')
      expect(d.note).toBe('hello')
    })

    it('still writes the request row when the request failed (4xx)', async () => {
      await app.inject({ method: 'POST', url: '/things?fail=1' })
      await settle()
      expect(written.map(e => e.action)).toEqual(['thing_created', 'http.post'])
      expect(written[1]!.details.statusCode).toBe(400)
    })

    it('writes the request row when no named event was written', async () => {
      await app.inject({ method: 'POST', url: '/plain' })
      await settle()
      expect(written.map(e => e.action)).toEqual(['http.post'])
      expect(written[0]!.entityId).toBe('/plain')
      expect(written[0]!.details.statusCode).toBe(200)
    })

    it('does not mix named events between concurrent requests', async () => {
      await Promise.all([
        app.inject({ method: 'POST', url: '/things' }),
        app.inject({ method: 'POST', url: '/plain' }),
        app.inject({ method: 'POST', url: '/things' }),
        app.inject({ method: 'POST', url: '/plain' }),
      ])
      await settle()
      const actions = written.map(e => e.action).sort()
      expect(actions).toEqual(['http.post', 'http.post', 'thing_created', 'thing_created'])
    })

    it('does not audit reads or server errors', async () => {
      await app.inject({ method: 'GET', url: '/read' })
      await app.inject({ method: 'POST', url: '/boom' })
      await settle()
      expect(written).toEqual([])
    })
  })

  describe('presence pings', () => {
    const ping = (user: string, doc: string) =>
      app.inject({ method: 'POST', url: `/documents/${doc}/presence`, headers: { 'x-user': user } })

    it('writes one viewing-session row for repeated pings from the same user and document', async () => {
      await ping('u1', 'DOC-1'); await ping('u1', 'DOC-1'); await ping('u1', 'DOC-1')
      await settle()
      expect(written).toHaveLength(1)
      expect(written[0]).toMatchObject({
        action: 'document_presence_session', entityType: 'document', entityId: 'DOC-1', actorId: 'u1',
      })
    })

    it('records no http.post row for presence', async () => {
      await ping('u1', 'DOC-1')
      await settle()
      expect(written.some(e => e.action === 'http.post')).toBe(false)
    })

    it('records separate sessions for a different user or a different document', async () => {
      await ping('u1', 'DOC-1'); await ping('u2', 'DOC-1'); await ping('u1', 'DOC-2')
      await settle()
      expect(written.map(e => `${e.actorId}:${e.entityId}`).sort()).toEqual(['u1:DOC-1', 'u1:DOC-2', 'u2:DOC-1'])
    })

    it('treats the heartbeat route as the same viewing session', async () => {
      await ping('u1', 'DOC-1')
      await app.inject({ method: 'PATCH', url: '/documents/DOC-1/presence/s1/heartbeat', headers: { 'x-user': 'u1' } })
      await settle()
      expect(written).toHaveLength(1)
    })

    it('writes a new row once 5 minutes have passed', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-26T10:00:00Z'))
      await ping('u1', 'DOC-1')
      vi.setSystemTime(new Date('2026-10-26T10:04:59Z'))
      await ping('u1', 'DOC-1')
      expect(written).toHaveLength(1)
      vi.setSystemTime(new Date('2026-10-26T10:05:01Z'))
      await ping('u1', 'DOC-1')
      await new Promise(resolve => setImmediate(resolve))
      expect(written).toHaveLength(2)
    })
  })

  describe('security probes', () => {
    it('records a POST to an unknown route as security.probe, not http_request', async () => {
      const res = await app.inject({ method: 'POST', url: '/wp-json/batch/v1?x=1', headers: { 'user-agent': 'scanner/1.0' } })
      await settle()
      expect(res.statusCode).toBe(404)
      expect(written).toHaveLength(1)
      expect(written[0]).toMatchObject({
        action: 'security.probe', entityType: 'security_probe', entityId: '/wp-json/batch/v1',
      })
      expect(written[0]!.details).toMatchObject({ statusCode: 404, method: 'POST', userAgent: 'scanner/1.0' })
    })

    it('does not record a GET to an unknown route', async () => {
      await app.inject({ method: 'GET', url: '/nope' })
      await settle()
      expect(written).toEqual([])
    })
  })

  describe('collapsing immediate repeats', () => {
    const read = (doc: string) => app.inject({ method: 'GET', url: `/documents/${doc}` })

    it('records a document read once when it fires twice within 2 seconds', async () => {
      await read('DOC-1'); await read('DOC-1')
      expect(written.filter(e => e.action === 'phi_document_accessed')).toHaveLength(1)
    })

    it('records both reads when the documents differ', async () => {
      await read('DOC-1'); await read('DOC-2')
      expect(written.filter(e => e.action === 'phi_document_accessed')).toHaveLength(2)
    })

    it('records the second read once more than 2 seconds have passed', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-26T10:00:00Z'))
      await read('DOC-1')
      vi.setSystemTime(new Date('2026-10-26T10:00:01.900Z'))
      await read('DOC-1')
      expect(written).toHaveLength(1)
      vi.setSystemTime(new Date('2026-10-26T10:00:02.100Z'))
      await read('DOC-1')
      expect(written).toHaveLength(2)
    })

    it('does not collapse actions that are not on the list', async () => {
      await app.inject({ method: 'POST', url: '/things' })
      await app.inject({ method: 'POST', url: '/things' })
      await settle()
      expect(written.filter(e => e.action === 'thing_created')).toHaveLength(2)
    })

    it('does not collapse audit.verify runs that have different ranges', async () => {
      const base = { timestamp: '', actorId: 'u1', action: 'audit.verify', entityType: 'audit_log', entityId: 'verify', ipAddress: null }
      await app.audit.append({ ...base, details: { fromId: '1', toId: '100' } })
      await app.audit.append({ ...base, details: { fromId: '1', toId: '100' } })
      await app.audit.append({ ...base, details: { fromId: '200', toId: '300' } })
      expect(written).toHaveLength(2)
    })
  })
})
