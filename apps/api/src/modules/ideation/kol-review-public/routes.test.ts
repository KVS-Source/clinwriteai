// Public KOL review route tests.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { kolReviewPublicRoutes } from './routes.js'

const VALID_TOKEN = 'a'.repeat(64)                          // 64 hex-ish chars

async function build(opts: {
  kolRows?: Array<{
    id: string
    ideationProjectId: string
    name: string
    email: string
    reviewLinkToken: string
    reviewLinkExpiry: Date
    signedOffAt: Date | null
  }>
  cards?: Array<{ id: string; sourceSection: string; sourcePassage: string; channelFormats: string[] }>
} = {}) {
  const audits: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    kolContact: {
      findMany: vi.fn(async () => opts.kolRows ?? []),
      update:   vi.fn(async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return {} }),
    },
    ideationProject: {
      findUnique: vi.fn(async () => ({ id: 'proj-1', projectId: 'parent-1' })),
    },
    project: {
      findUnique: vi.fn(async () => ({ name: 'VELORA Launch' })),
    },
    ideationContentCard: {
      findMany: vi.fn(async () => opts.cards ?? [
        { id: 'c1', sourceSection: 'Intro', sourcePassage: 'Lead sentence.', channelFormats: ['linkedin'] },
      ]),
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { audits.push(ev); return { id: 'a1' } }) } as never)
  await app.register(kolReviewPublicRoutes)
  await app.ready()
  return { app, audits, updates }
}

const validKol = (over: Partial<Awaited<ReturnType<typeof build>>['updates'][0] & Record<string, unknown>> = {}) => ({
  id: 'kol-1',
  ideationProjectId: 'proj-1',
  name: 'Dr Rebecca Morton',
  email: 'rm@example.com',
  reviewLinkToken: VALID_TOKEN,
  reviewLinkExpiry: new Date(Date.now() + 86_400_000),
  signedOffAt: null,
  ...over,
})

const get = (app: Awaited<ReturnType<typeof build>>['app'], token: string) =>
  app.inject({ method: 'GET', url: `/public/kol-review/${token}` })

const submit = (app: Awaited<ReturnType<typeof build>>['app'], token: string, payload: unknown) =>
  app.inject({ method: 'POST', url: `/public/kol-review/${token}/decisions`, payload: payload as never })

beforeEach(() => { /* no module gate — public route */ })

describe('GET /public/kol-review/:token', () => {
  it('returns a narrow review package (kol + project name + cards only)', async () => {
    const { app, audits } = await build({ kolRows: [validKol()] })
    const res = await get(app, VALID_TOKEN)
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      kol: { name: string; email: string; signedOffAt: string | null }
      project: { name: string }
      cards: Array<{ id: string; sourceSection: string }>
    }
    expect(body.kol.name).toBe('Dr Rebecca Morton')
    expect(body.project.name).toBe('VELORA Launch')
    expect(body.cards).toHaveLength(1)
    // Response MUST NOT leak internal fields.
    expect(body.kol).not.toHaveProperty('ideationProjectId')
    expect(body.kol).not.toHaveProperty('reviewLinkToken')
    expect(body.kol).not.toHaveProperty('mobileEncrypted')

    const rec = audits.find(e => e.action === 'kol_review_opened')
    expect(rec?.actorId).toBe('kol:kol-1')
    expect(rec?.details).toMatchObject({ cardCount: 1 })
  })

  it('returns 401 for a malformed token shape (not 64 hex chars)', async () => {
    const { app } = await build({ kolRows: [validKol()] })
    const res = await get(app, 'too-short')
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for a well-shaped token that does not match any KOL', async () => {
    const { app } = await build({ kolRows: [] })
    const res = await get(app, 'b'.repeat(64))
    expect(res.statusCode).toBe(401)
  })

  it('returns 410 Gone when the token is past its expiry', async () => {
    const { app } = await build({
      kolRows: [validKol({ reviewLinkExpiry: new Date(Date.now() - 1000) })],
    })
    const res = await get(app, VALID_TOKEN)
    expect(res.statusCode).toBe(410)
    expect(res.json()).toMatchObject({ error: 'token_expired' })
  })

  it('still returns the package after sign-off (KOL can review their decisions)', async () => {
    const signedAt = new Date(Date.now() - 60_000)
    const { app } = await build({
      kolRows: [validKol({ signedOffAt: signedAt })],
    })
    const res = await get(app, VALID_TOKEN)
    expect(res.statusCode).toBe(200)
    expect((res.json() as { kol: { signedOffAt: string } }).kol.signedOffAt).toBe(signedAt.toISOString())
  })
})

describe('POST /public/kol-review/:token/decisions', () => {
  it('records decisions + flips signedOffAt on success', async () => {
    const { app, audits, updates } = await build({ kolRows: [validKol()] })
    const payload = { decisions: [
      { cardId: 'c1', decision: 'approved',           comment: 'strong' },
      { cardId: 'c2', decision: 'changes_requested', comment: 'tighten the hazard ratio sentence' },
    ] }
    const res = await submit(app, VALID_TOKEN, payload)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { signedOffAt: string; decisionCount: number }
    expect(body.decisionCount).toBe(2)
    expect(body.signedOffAt).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(updates[0]).toMatchObject({ signedOffAt: expect.any(Date) })
    const rec = audits.find(e => e.action === 'kol_review_signed_off')
    expect(rec?.details).toMatchObject({ decisions: payload.decisions })
  })

  it('returns 409 when the KOL has already signed off', async () => {
    const { app } = await build({
      kolRows: [validKol({ signedOffAt: new Date() })],
    })
    const res = await submit(app, VALID_TOKEN, { decisions: [{ cardId: 'c1', decision: 'approved' }] })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'already_signed' })
  })

  it('returns 410 when the token expired after it was issued', async () => {
    const { app } = await build({
      kolRows: [validKol({ reviewLinkExpiry: new Date(Date.now() - 1) })],
    })
    const res = await submit(app, VALID_TOKEN, { decisions: [{ cardId: 'c1', decision: 'approved' }] })
    expect(res.statusCode).toBe(410)
  })

  it('returns 401 for an invalid token even with a valid-looking body', async () => {
    const { app } = await build({ kolRows: [] })
    const res = await submit(app, 'c'.repeat(64), { decisions: [{ cardId: 'c1', decision: 'approved' }] })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 for an empty / malformed decisions body', async () => {
    const { app } = await build({ kolRows: [validKol()] })
    expect((await submit(app, VALID_TOKEN, { decisions: [] })).statusCode).toBe(400)
    expect((await submit(app, VALID_TOKEN, {})).statusCode).toBe(400)
    expect((await submit(app, VALID_TOKEN, { decisions: [{ cardId: 'c1', decision: 'maybe' }] })).statusCode).toBe(400)
  })
})
