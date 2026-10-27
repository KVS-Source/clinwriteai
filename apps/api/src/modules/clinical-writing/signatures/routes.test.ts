// Route tests for the Part 11 signature chain: initiate → sign (sequential
// release) → document signed; refusals; cancel. Fastify inject() over an
// in-memory Prisma double — no database needed.

import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { signatureRoutes } from './routes.js'

type Row = Record<string, any>

function fakePrisma() {
  const documents: Row[] = [{
    id: 'DOC-1', status: 'pending_signature', watermarked: true, signedAt: null,
    currentVersion: { label: 'Draft', versionNumber: 'v0.2', sections: [{ sectionId: 's1', contentHtml: '<p>a</p>' }] },
  }]
  const chains: Row[] = []
  const records: Row[] = []
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'NOT') return !matches(row, v)
    if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(row[k])
    return row[k] === v
  })
  const withRecords = (c: Row | undefined) => c && { ...c, records: records.filter(r => r.chainId === c.id).sort((a, b) => a.step - b.step) }

  const prisma: Row = {
    document: {
      findUnique: async ({ where }: Row) => documents.find(d => d.id === where.id) ?? null,
      updateMany: async ({ where, data }: Row) => {
        const hit = documents.filter(d => matches(d, where)); hit.forEach(d => Object.assign(d, data)); return { count: hit.length }
      },
    },
    signatureChain: {
      findFirst: async ({ where }: Row) => chains.find(c => matches(c, where)) ?? null,
      findUnique: async ({ where, include }: Row) => { const c = chains.find(x => x.id === where.id); return include ? withRecords(c) ?? null : c ?? null },
      findMany: async ({ where }: Row) => chains.filter(c => matches(c, where)).map(withRecords),
      create: async ({ data }: Row) => { const c = { id: `chain-${chains.length + 1}`, initiatedAt: new Date(), completedAt: null, cancelledAt: null, cancelReason: null, ...data }; chains.push(c); return c },
      update: async ({ where, data }: Row) => Object.assign(chains.find(c => c.id === where.id)!, data),
    },
    signatureRecord: {
      createMany: async ({ data }: Row) => { records.push(...data); return { count: data.length } },
      findUnique: async ({ where, include }: Row) => { const r = records.find(x => x.id === where.id); return r ? (include?.chain ? { ...r, chain: chains.find(c => c.id === r.chainId) } : r) : null },
      findFirst: async ({ where }: Row) => records.find(r => matches(r, where)) ?? null,
      update: async ({ where, data }: Row) => Object.assign(records.find(r => r.id === where.id)!, data),
      count: async ({ where }: Row) => records.filter(r => matches(r, where)).length,
    },
    // Phase 2 checklist Gate A (checkSignatureGate) runs before chain
    // initiate. No mandatory items in the test fixture → gate returns ok
    // and the chain proceeds.
    checklistInstanceItem: {
      findMany: async () => [],
    },
    $queryRawUnsafe: async () => [],
    $transaction: async (fn: (tx: Row) => unknown) => fn(prisma),
  }
  return { prisma, documents, chains, records }
}

const USERS = {
  author:   { id: 'u-author',   email: 'a@x.test', role: 'clinical-writer', modules: ['A'], tenantId: null },
  reviewer: { id: 'u-reviewer', email: 'r@x.test', role: 'reviewer',        modules: ['A'], tenantId: null },
}

async function build() {
  const db = fakePrisma()
  const audit: Row[] = []
  let currentUser: Row = USERS.author
  const app: FastifyInstance = Fastify()
  app.decorate('prisma', db.prisma as never)
  app.decorate('audit', { append: async (e: Row) => { audit.push(e); return { id: '1', rowHash: 'h' } } } as never)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: Row }).user = currentUser })
  await app.register(signatureRoutes)
  return { app, db, audit, as: (u: Row) => { currentUser = u } }
}

const twoSigners = {
  chainType: 'sequential',
  signers: [
    { signerId: 'u-author',   signerName: 'Ann Author',   signerRole: 'clinical-writer', meaning: 'authored' },
    { signerId: 'u-reviewer', signerName: 'Rob Reviewer', signerRole: 'reviewer',        meaning: 'approved' },
  ],
}
const signBody = { credentialProof: 'correct-horse-battery', localTime: '10:00 IST' }

describe('signature chain routes', () => {
  let t: Awaited<ReturnType<typeof build>>
  beforeEach(async () => { t = await build() })

  it('refuses to initiate before CRM is complete (document not pending_signature)', async () => {
    t.db.documents[0].status = 'in_review'
    const res = await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('wrong_status')
  })

  it('initiates a sequential chain with step 1 awaiting and step 2 queued', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })
    expect(res.statusCode).toBe(201)
    expect(res.json().records.map((r: Row) => r.status)).toEqual(['awaiting', 'queued'])
    const again = await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })
    expect(again.json().error).toBe('chain_already_active')
  })

  it('runs initiate → sign → sign and marks the document signed with the watermark cleared', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const [step1, step2] = chain.records

    // Step 2 cannot be signed before step 1 (sequential).
    t.as(USERS.reviewer)
    const early = await t.app.inject({ method: 'POST', url: `/signature-records/${step2.id}/sign`, payload: signBody })
    expect(early.json().error).toBe('not_awaiting')

    // Only the designated signer can sign step 1.
    const wrong = await t.app.inject({ method: 'POST', url: `/signature-records/${step1.id}/sign`, payload: signBody })
    expect(wrong.statusCode).toBe(403)
    expect(wrong.json().error).toBe('wrong_signer')

    t.as(USERS.author)
    const s1 = await t.app.inject({ method: 'POST', url: `/signature-records/${step1.id}/sign`, payload: signBody })
    expect(s1.statusCode).toBe(200)
    expect(s1.json().status).toBe('signed')
    expect(s1.json().versionAtSigning).toBe('v0.2')   // version number, not the label ('Draft')
    expect(t.db.records.find(r => r.id === step2.id)!.status).toBe('awaiting')   // released
    expect(t.db.documents[0].status).toBe('pending_signature')

    t.as(USERS.reviewer)
    const s2 = await t.app.inject({ method: 'POST', url: `/signature-records/${step2.id}/sign`, payload: signBody })
    expect(s2.statusCode).toBe(200)
    expect(t.db.chains[0].status).toBe('complete')
    expect(t.db.documents[0]).toMatchObject({ status: 'signed', watermarked: false })
    expect(t.audit.map(a => a.action)).toEqual(['signature_initiated', 'signature_recorded', 'document_signed'])
  })

  it('rejects a credential shorter than 8 characters', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: { ...signBody, credentialProof: 'short' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('validation')
  })

  it('cancel requires a reason and returns the document to in_authoring', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const noReason = await t.app.inject({ method: 'POST', url: `/signature-chains/${chain.id}/cancel`, payload: { cancelReason: '' } })
    expect(noReason.statusCode).toBe(400)
    const res = await t.app.inject({ method: 'POST', url: `/signature-chains/${chain.id}/cancel`, payload: { cancelReason: 'Wrong signer order' } })
    expect(res.statusCode).toBe(200)
    expect(t.db.chains[0].status).toBe('cancelled')
    expect(t.db.documents[0].status).toBe('in_authoring')
  })
})
