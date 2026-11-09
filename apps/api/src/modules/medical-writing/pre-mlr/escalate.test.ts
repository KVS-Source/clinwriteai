// POST /med-content/:contentId/agentic-report/findings/:findingN/escalate
//
// Covers:
//   - Creates an MlrComment with escalatedFromAgentic=true + tag derived
//     from severity
//   - Audit entry includes mlrCommentId
//   - 400 when findingText missing
//   - 404 when content item not found
//   - Retry on id-collision; gives up with 503 after 5 attempts

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

const { preMlrRoutes } = await import('./routes.js')

const CID = 'c-1'

async function build(opts: {
  itemExists?: boolean
  existingComments?: Array<{ id: string }>
  collideAlways?: boolean
} = {}) {
  const createCalls: Array<{ id: string; data: Record<string, unknown> }> = []
  const audits: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    medContentItem: {
      findUnique: vi.fn(async () => opts.itemExists === false ? null : ({
        id: CID, projectId: 'proj-1', title: 'HCP Deck', type: 'hcp_deck',
      })),
    },
    mlrComment: {
      findMany: vi.fn(async () => opts.existingComments ?? []),
      create:   vi.fn(async ({ data }: { data: { id: string } & Record<string, unknown> }) => {
        createCalls.push({ id: data.id, data })
        if (opts.collideAlways) {
          const e = new Error('unique'); (e as unknown as { code: string }).code = 'P2002'; throw e
        }
        return data
      }),
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { audits.push(ev); return { id: 'aud-1' } }) } as never)
  app.decorate('aiGateway', { chat: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u-sarah', email: 'sarah@x.io', role: 'medical-writer', modules: ['C'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(preMlrRoutes)
  await app.ready()
  return { app, audits, createCalls }
}

const escalate = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: `/${CID}/agentic-report/findings/2/escalate`, payload: payload as never })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'C' })

describe('POST /med-content/:contentId/agentic-report/findings/:findingN/escalate', () => {
  it('creates an MlrComment with escalatedFromAgentic=true and Should Fix tag for severity=advisory', async () => {
    const { app, audits, createCalls } = await build()
    const res = await escalate(app, {
      findingText: '2 claim(s) rejected. Confirm removal before MLR submission.',
      severity:    'advisory',
      category:    'Claims hygiene',
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { mlrCommentId: string; tag: string; escalationAuditId: string }
    expect(body.mlrCommentId).toMatch(/^MLR-C-\d{3}$/)
    expect(body.tag).toBe('Should Fix')

    const create = createCalls[0]!.data as Record<string, unknown>
    expect(create).toMatchObject({
      contentItemId:        CID,
      reviewerId:           'u-sarah',
      tag:                  'Should Fix',
      escalatedFromAgentic: true,
    })
    expect(create.text as string).toContain('[Escalated from agentic report finding #2]')
    expect(create.text as string).toContain('[Claims hygiene]')

    const rec = audits.find(e => e.action === 'agentic_finding_escalated')
    expect(rec?.details).toMatchObject({ findingIndex: 2, tag: 'Should Fix', mlrCommentId: body.mlrCommentId })
  })

  it('maps severity=suggestion to Note tag', async () => {
    const { app, createCalls } = await build()
    await escalate(app, { findingText: 'Consider adopting more Library claims.', severity: 'suggestion' })
    expect((createCalls[0]!.data as { tag: string }).tag).toBe('Note')
  })

  it('defaults to Note tag when severity is missing', async () => {
    const { app, createCalls } = await build()
    await escalate(app, { findingText: 'Generic finding.' })
    expect((createCalls[0]!.data as { tag: string }).tag).toBe('Note')
  })

  it('generates sequential MLR-C-### ids via nextMlrCommentId', async () => {
    const { app, createCalls } = await build({
      existingComments: [{ id: 'MLR-C-001' }, { id: 'MLR-C-002' }],
    })
    await escalate(app, { findingText: 'next one' })
    expect((createCalls[0]!.data as { id: string }).id).toBe('MLR-C-003')
  })

  it('returns 400 when findingText is missing', async () => {
    const { app } = await build()
    const res = await escalate(app, {})
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when the content item does not exist', async () => {
    const { app } = await build({ itemExists: false })
    const res = await escalate(app, { findingText: 'x' })
    expect(res.statusCode).toBe(404)
  })

  it('gives up with 503 after 5 collision retries', async () => {
    const { app } = await build({ collideAlways: true })
    const res = await escalate(app, { findingText: 'x' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: 'id_contention' })
  })
})
