import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const startSignatureChain = vi.fn()
const defaultSigners = vi.fn()
vi.mock('./start-chain.js', () => ({
  startSignatureChain: (...a: unknown[]) => startSignatureChain(...a),
  defaultSigners: (...a: unknown[]) => defaultSigners(...a),
}))

import { recordApprovalAndMaybeStartChain } from './auto-start.js'

type Row = { userId: string; letter: string; documentApprovedAt: Date | null; removedAt: Date | null; rejectedAt: Date | null }

function build(opts: { status?: string; rows: Row[] }) {
  const audit = vi.fn(async () => ({ id: 'a1' }))
  const doc = { id: 'DOC-1', projectId: 'P-1', status: opts.status ?? 'pending_signature', title: 'Demo' }
  const app = {
    audit: { append: audit },
    prisma: {
      document: { findUnique: vi.fn(async () => doc) },
      documentRaci: {
        updateMany: vi.fn(async ({ where, data }: { where: { userId: string; letter: string; documentApprovedAt: null }; data: { documentApprovedAt: Date } }) => {
          const hit = opts.rows.filter(r => r.userId === where.userId && r.letter === where.letter && r.removedAt === null && r.rejectedAt === null && r.documentApprovedAt === null)
          hit.forEach(r => { r.documentApprovedAt = data.documentApprovedAt })
          return { count: hit.length }
        }),
        findMany: vi.fn(async () => opts.rows.filter(r => r.letter === 'A' && r.removedAt === null)),
      },
    },
  } as unknown as FastifyInstance
  return { app, audit, rows: opts.rows }
}
const approver = (userId: string, documentApprovedAt: Date | null = null): Row => ({ userId, letter: 'A', documentApprovedAt, removedAt: null, rejectedAt: null })
const go = (app: FastifyInstance, actorId: string) => recordApprovalAndMaybeStartChain(app, { documentId: 'DOC-1', actorId, ipAddress: '1.1.1.1' })

beforeEach(() => {
  startSignatureChain.mockReset().mockResolvedValue({ ok: true, chain: { id: 'c1' } })
  defaultSigners.mockReset().mockResolvedValue([{ signerId: 'u-a1', signerName: 'A1', signerRole: 'Approver', meaning: 'approved', scopeSections: [] }])
})

describe('automatic signature chain', () => {
  it('does not start while another Approver has not approved yet, but records this approval', async () => {
    const t = build({ rows: [approver('u-a1'), approver('u-a2')] })
    expect(await go(t.app, 'u-a1')).toEqual({ chainStarted: false })
    expect(t.rows[0]!.documentApprovedAt).not.toBeNull()
    expect(t.rows[1]!.documentApprovedAt).toBeNull()
    expect(startSignatureChain).not.toHaveBeenCalled()
  })

  it('starts the chain by itself when the last Approver approves, for everyone named on the document', async () => {
    const t = build({ rows: [approver('u-a1', new Date()), approver('u-a2')] })
    expect(await go(t.app, 'u-a2')).toEqual({ chainStarted: true })
    expect(startSignatureChain).toHaveBeenCalledTimes(1)
    expect(startSignatureChain.mock.calls[0]![1]).toMatchObject({ actorId: 'u-a2', chainType: 'grouped', automatic: true, signers: [expect.objectContaining({ meaning: 'approved' })] })
  })

  it('starts when a single Approver approves', async () => {
    const t = build({ rows: [approver('u-a1')] })
    expect((await go(t.app, 'u-a1')).chainStarted).toBe(true)
  })

  it('ignores someone who is not an Approver on the document', async () => {
    const t = build({ rows: [approver('u-a1')] })
    expect(await go(t.app, 'u-someone')).toEqual({ chainStarted: false })
    expect(startSignatureChain).not.toHaveBeenCalled()
  })

  it('does not start before the document is awaiting signature', async () => {
    const t = build({ status: 'in_review', rows: [approver('u-a1')] })
    expect((await go(t.app, 'u-a1')).chainStarted).toBe(false)
    expect(startSignatureChain).not.toHaveBeenCalled()
  })

  it('does nothing twice: a second approval click by the same Approver changes nothing', async () => {
    const t = build({ rows: [approver('u-a1', new Date()), approver('u-a2')] })
    expect((await go(t.app, 'u-a1')).chainStarted).toBe(false)
    expect(startSignatureChain).not.toHaveBeenCalled()
  })

  it('when a gate blocks the chain, starts nothing and audits why', async () => {
    startSignatureChain.mockResolvedValue({ ok: false, status: 409, body: { error: 'checklist_incomplete' } })
    const t = build({ rows: [approver('u-a1')] })
    const r = await go(t.app, 'u-a1')
    expect(r).toMatchObject({ chainStarted: false, blocked: { error: 'checklist_incomplete' } })
    expect(t.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'signature_auto_start_blocked' }))
  })

  it('a chain that is already running is not an error and not audited as blocked', async () => {
    startSignatureChain.mockResolvedValue({ ok: false, status: 409, body: { error: 'chain_already_active' } })
    const t = build({ rows: [approver('u-a1')] })
    expect(await go(t.app, 'u-a1')).toEqual({ chainStarted: false })
    expect(t.audit).not.toHaveBeenCalled()
  })
})
