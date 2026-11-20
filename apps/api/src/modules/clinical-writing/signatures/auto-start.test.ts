import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const startSignatureChain = vi.fn()
const defaultSigners = vi.fn()
vi.mock('./start-chain.js', () => ({
  startSignatureChain: (...a: unknown[]) => startSignatureChain(...a),
  defaultSigners: (...a: unknown[]) => defaultSigners(...a),
}))

import { startChainWhenReviewDone } from './auto-start.js'

function build(status = 'pending_signature') {
  const audit = vi.fn(async () => ({ id: 'a1' }))
  const doc = { id: 'DOC-1', projectId: 'P-1', status, title: 'Demo' }
  const app = {
    audit: { append: audit },
    prisma: { document: { findUnique: vi.fn(async () => doc) } },
  } as unknown as FastifyInstance
  return { app, audit }
}
const go = (app: FastifyInstance) => startChainWhenReviewDone(app, { documentId: 'DOC-1', actorId: 'u-chair', ipAddress: '1.1.1.1' })

beforeEach(() => {
  startSignatureChain.mockReset().mockResolvedValue({ ok: true, chain: { id: 'c1' } })
  defaultSigners.mockReset().mockResolvedValue([{ signerId: 'u-a1', signerName: 'A1', signerRole: 'Approver', meaning: 'approved', scopeSections: [] }])
})

describe('automatic signature chain after review and the CRM meeting', () => {
  it('starts an Approvers-first chain for everyone named on the document', async () => {
    const t = build()
    expect(await go(t.app)).toEqual({ chainStarted: true })
    expect(startSignatureChain).toHaveBeenCalledTimes(1)
    expect(startSignatureChain.mock.calls[0]![1]).toMatchObject({
      actorId: 'u-chair', chainType: 'approvers_first', automatic: true, skipContentCheck: true, signers: [expect.objectContaining({ meaning: 'approved' })],
    })
  })

  it.each(['in_review', 'crm_in_progress', 'in_authoring'])('starts nothing while the document is %s', async (status) => {
    const t = build(status)
    expect(await go(t.app)).toEqual({ chainStarted: false })
    expect(startSignatureChain).not.toHaveBeenCalled()
  })

  it('when a gate blocks the chain, starts nothing and audits why', async () => {
    startSignatureChain.mockResolvedValue({ ok: false, status: 409, body: { error: 'checklist_incomplete' } })
    const t = build()
    expect(await go(t.app)).toMatchObject({ chainStarted: false, blocked: { error: 'checklist_incomplete' } })
    expect(t.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'signature_auto_start_blocked' }))
  })

  it('a chain that is already running is not an error and not audited as blocked', async () => {
    startSignatureChain.mockResolvedValue({ ok: false, status: 409, body: { error: 'chain_already_active' } })
    const t = build()
    expect(await go(t.app)).toEqual({ chainStarted: false })
    expect(t.audit).not.toHaveBeenCalled()
  })
})
