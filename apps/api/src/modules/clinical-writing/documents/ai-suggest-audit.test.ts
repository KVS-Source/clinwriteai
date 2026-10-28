// Every AI Chat request writes an "AI suggestion requested" audit entry — accepted or not.
// Fastify inject() with a stubbed Prisma, AI gateway and audit repository.

import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { documentsRoutes } = await import('./routes.js')

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

type Chat = (args: { prompt: string }) => Promise<unknown>

async function build(opts: { chat?: Chat; auditFails?: boolean; noSection?: boolean } = {}) {
  const chat = vi.fn(opts.chat ?? (async () => ({
    responseText: '<p>Revised.</p>', model: 'claude-test', inputTokens: 1, outputTokens: 1, costUsd: 0,
    limitDecision: 'allowed', piiScrubbed: false, piiCategories: [], recordId: 'rec-1',
  })))
  const append = vi.fn(async () => { if (opts.auditFails) throw new Error('audit down'); return { id: '1', rowHash: 'h' } })
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: 'DOC-1', projectId: 'proj-1', type: 'dsur', currentVersionId: 'v1',
        currentVersion: { sections: opts.noSection ? [] : [{ id: 'row-1', sectionId: 'd2', sectionNumber: '§2', sectionTitle: 'Worldwide Marketing Approval Status', contentHtml: '<p>Patient Jane Roe, saved text.</p>' }] },
      })),
    },
  } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, chat, append }
}

type Built = Awaited<ReturnType<typeof build>>
const ask = (b: Built, payload: unknown) =>
  b.app.inject({ method: 'POST', url: '/documents/DOC-1/sections/d2/ai-suggest', payload: payload as never })
const requested = (b: Built) => b.append.mock.calls.map(c => c[0] as { action: string; actorId: string; entityType: string; entityId: string; details: Record<string, unknown> })
  .filter(e => e.action === 'ai_suggestion_requested')

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('AI suggestion requested — audit entry', () => {
  it('is written once for a completed request, with model, section, intent, scope and the record id', async () => {
    const b = await build()
    expect((await ask(b, { intent: 'edit', customPrompt: 'Make it one sentence' })).statusCode).toBe(200)
    const entries = requested(b)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ actorId: 'u1', entityType: 'document', entityId: 'DOC-1' })
    expect(entries[0]!.details).toMatchObject({
      sectionId: 'd2', sectionLabel: '§2 Worldwide Marketing Approval Status',
      aiModel: 'claude-test', intent: 'edit', scope: 'section', selectionScoped: false,
      outcome: 'completed', aiCallRecordId: 'rec-1',
    })
  })

  it('fingerprints exactly the prompt that was sent to the model', async () => {
    const b = await build()
    await ask(b, { intent: 'edit', customPrompt: 'Make it one sentence' })
    const sent = (b.chat.mock.calls[0]![0] as { prompt: string }).prompt
    const d = requested(b)[0]!.details
    expect(d.promptSha256).toBe(sha256(sent))
    expect(d.promptChars).toBe(sent.length)
    expect(d.instructionSha256).toBe(sha256('Make it one sentence'))
    expect(d.instructionChars).toBe('Make it one sentence'.length)
    expect(d.promptSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the prompt text and the document content OUT of the permanent log', async () => {
    const b = await build()
    await ask(b, { intent: 'edit', customPrompt: 'Add the patient name Jane Roe', selectionText: 'Jane Roe', currentContent: '<p>Patient Jane Roe, unsaved.</p>' })
    const text = JSON.stringify(requested(b)[0]!.details)
    expect(text).not.toContain('Jane Roe')
    expect(text).not.toContain('Add the patient name')
    expect(text).not.toContain('saved text')
  })

  it('same prompt gives the same fingerprint, a different one gives a different fingerprint', async () => {
    const b = await build()
    await ask(b, { intent: 'edit', customPrompt: 'Tighten this' })
    await ask(b, { intent: 'edit', customPrompt: 'Tighten this' })
    await ask(b, { intent: 'edit', customPrompt: 'Expand this' })
    const [a, a2, c] = requested(b).map(e => e.details.promptSha256)
    expect(a).toBe(a2)
    expect(a).not.toBe(c)
  })

  it('records the intent, scope and whether it was limited to a selection', async () => {
    const b = await build()
    await ask(b, { intent: 'edit', customPrompt: 'Fix', selectionText: 'a passage', scope: 'document' })
    await ask(b, { intent: 'explain' })
    const [first, second] = requested(b)
    expect(first!.details).toMatchObject({ intent: 'edit', scope: 'document', selectionScoped: true })
    expect(second!.details).toMatchObject({ intent: 'explain', scope: 'section', selectionScoped: false })
  })

  it('is written for a request that hit the AI quota, with no record id', async () => {
    const b = await build({ chat: async () => { throw Object.assign(new Error('Monthly AI quota reached'), { name: 'RateLimitedError' }) } })
    const res = await ask(b, { intent: 'edit', customPrompt: 'x' })
    expect(res.statusCode).toBe(429)
    const entries = requested(b)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.details.outcome).toBe('quota_reached')
    expect(entries[0]!.details).not.toHaveProperty('aiCallRecordId')
  })

  it('is written for a request that failed, and the failure still reaches the caller', async () => {
    const b = await build({ chat: async () => { throw new Error('model unavailable') } })
    const res = await ask(b, { intent: 'edit', customPrompt: 'x' })
    expect(res.statusCode).toBe(500)
    expect(requested(b)).toHaveLength(1)
    expect(requested(b)[0]!.details.outcome).toBe('failed')
  })

  it('never blocks the AI answer when the audit write itself fails', async () => {
    const b = await build({ auditFails: true })
    const res = await ask(b, { intent: 'edit', customPrompt: 'x' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ responseText: '<p>Revised.</p>' })
  })

  it('is not written when nothing was sent to the model (bad input, unknown section)', async () => {
    const bad = await build()
    expect((await ask(bad, { intent: 'edit', customPrompt: '   ' })).statusCode).toBe(400)
    expect(requested(bad)).toHaveLength(0)

    const none = await build({ noSection: true })
    expect((await ask(none, { intent: 'edit', customPrompt: 'x' })).statusCode).toBe(404)
    expect(requested(none)).toHaveLength(0)
    expect(none.chat).not.toHaveBeenCalled()
  })
})
