import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetNudgeThrottle, nudgePendingCohort } from './nudge.js'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

afterEach(() => _resetNudgeThrottle())

const ACTOR: AuthenticatedUser = {
  id: 'u-actor', email: 'actor@x.ai', role: 'tenant-admin', capabilities: [], modules: ['A'], tenantId: 't',
}

// Minimal in-memory fake Prisma.
function makePrisma(opts: {
  docStatus?: string
  rows?: Array<Record<string, unknown>>
}) {
  const createMany = vi.fn(async (_args: { data: unknown[] }) => ({ count: (_args.data as unknown[]).length }))
  return {
    document: {
      findUnique: async () => opts.docStatus === undefined
        ? null
        : { id: 'd-1', status: opts.docStatus, title: 'My doc', projectId: 'p-1' },
    },
    documentRaci: {
      findMany: async () => opts.rows ?? [],
    },
    notification: { createMany },
    _createMany: createMany,
  } as never
}

describe('nudgePendingCohort', () => {
  it('returns empty when the document does not exist', async () => {
    const r = await nudgePendingCohort(makePrisma({ docStatus: undefined }), { documentId: 'd-1', actor: ACTOR })
    expect(r.decisions).toEqual([])
    expect(r.gatingLetters).toEqual([])
  })

  it('returns empty when the stage is terminal (signed)', async () => {
    const r = await nudgePendingCohort(makePrisma({ docStatus: 'signed', rows: [] }), { documentId: 'd-1', actor: ACTOR })
    expect(r.decisions).toEqual([])
    expect(r.gatingLetters).toEqual([])
  })

  it('nudges every pending user in the cohort when no targets specified', async () => {
    const prisma = makePrisma({
      docStatus: 'in_authoring',
      rows: [
        { userId: 'u-a', letter: 'R', signatureRequired: false, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
        { userId: 'u-b', letter: 'R', signatureRequired: false, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
      ],
    })
    const r = await nudgePendingCohort(prisma, { documentId: 'd-1', actor: ACTOR })
    expect(r.gatingLetters).toEqual(['R'])
    expect(r.decisions.map(d => d.status).sort()).toEqual(['nudged', 'nudged'])
    expect((prisma as unknown as { _createMany: ReturnType<typeof vi.fn> })._createMany).toHaveBeenCalledOnce()
  })

  it('reports already_done when the target has completed their part', async () => {
    const done = new Date()
    const prisma = makePrisma({
      docStatus: 'in_authoring',
      rows: [
        { userId: 'u-done', letter: 'R', signatureRequired: false, submittedAt: done, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
      ],
    })
    const r = await nudgePendingCohort(prisma, { documentId: 'd-1', actor: ACTOR, targetUserIds: ['u-done'] })
    expect(r.decisions).toEqual([{ targetUserId: 'u-done', status: 'already_done' }])
  })

  it('reports not_in_cohort when the target has no row for the gating letter', async () => {
    const prisma = makePrisma({
      docStatus: 'in_review',
      rows: [
        { userId: 'u-c', letter: 'C', signatureRequired: false, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
      ],
    })
    const r = await nudgePendingCohort(prisma, { documentId: 'd-1', actor: ACTOR, targetUserIds: ['u-stranger'] })
    expect(r.decisions).toEqual([{ targetUserId: 'u-stranger', status: 'not_in_cohort' }])
  })

  it('throttles a repeat nudge within 24h', async () => {
    const prisma = makePrisma({
      docStatus: 'in_authoring',
      rows: [
        { userId: 'u-a', letter: 'R', signatureRequired: false, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
      ],
    })
    const first = await nudgePendingCohort(prisma, { documentId: 'd-1', actor: ACTOR, targetUserIds: ['u-a'], now: new Date('2026-01-01T10:00:00Z') })
    expect(first.decisions[0].status).toBe('nudged')

    const second = await nudgePendingCohort(prisma, { documentId: 'd-1', actor: ACTOR, targetUserIds: ['u-a'], now: new Date('2026-01-01T22:00:00Z') })
    expect(second.decisions[0].status).toBe('throttled')
    expect(second.decisions[0].reason).toContain('try again')
  })

  it('lets the same actor nudge again after 24h', async () => {
    const prisma = makePrisma({
      docStatus: 'in_authoring',
      rows: [
        { userId: 'u-a', letter: 'R', signatureRequired: false, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
      ],
    })
    await nudgePendingCohort(prisma, { documentId: 'd-1', actor: ACTOR, targetUserIds: ['u-a'], now: new Date('2026-01-01T10:00:00Z') })
    const second = await nudgePendingCohort(prisma, { documentId: 'd-1', actor: ACTOR, targetUserIds: ['u-a'], now: new Date('2026-01-02T11:00:00Z') })
    expect(second.decisions[0].status).toBe('nudged')
  })

  it('throttle is scoped per actor (different actor is not throttled)', async () => {
    const prisma = makePrisma({
      docStatus: 'in_authoring',
      rows: [
        { userId: 'u-a', letter: 'R', signatureRequired: false, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
      ],
    })
    await nudgePendingCohort(prisma, { documentId: 'd-1', actor: ACTOR, targetUserIds: ['u-a'] })
    const other: AuthenticatedUser = { ...ACTOR, id: 'u-other' }
    const r = await nudgePendingCohort(prisma, { documentId: 'd-1', actor: other, targetUserIds: ['u-a'] })
    expect(r.decisions[0].status).toBe('nudged')
  })

  it('nudges across both C and Q cohorts in in_review', async () => {
    const prisma = makePrisma({
      docStatus: 'in_review',
      rows: [
        { userId: 'u-c', letter: 'C', signatureRequired: false, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
        { userId: 'u-q', letter: 'Q', signatureRequired: false, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
      ],
    })
    const r = await nudgePendingCohort(prisma, { documentId: 'd-1', actor: ACTOR })
    expect(r.gatingLetters.sort()).toEqual(['C', 'Q'])
    expect(r.decisions.map(d => d.status).sort()).toEqual(['nudged', 'nudged'])
  })
})
