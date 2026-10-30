// Route tests for the Part 11 signature chain: initiate → sign (sequential
// release) → document signed; refusals; cancel. Fastify inject() over an
// in-memory Prisma double — no database needed.

import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { signatureRoutes } from './routes.js'

type Row = Record<string, any>

function fakePrisma() {
  const documents: Row[] = [{
    id: 'DOC-1', projectId: 'PROJ-1', status: 'pending_signature', watermarked: true, signedAt: null,
    currentVersion: { label: 'Draft', versionNumber: 'v0.2', sections: [{ sectionId: 's1', contentHtml: '<p>a</p>' }] },
  }]
  // Team Approvers (RACI='A') — the chain-init handler reads these to
  // enforce the "every Approver must sign" rule introduced 2026-10-28.
  // The twoSigners fixture ships `u-reviewer` as the only `approved`
  // signer, so only u-reviewer is marked RACI='A' here (u-author is R
  // for 'authored' and doesn't need to appear in the Approver set).
  const projectTeamMembers: Row[] = [
    { projectId: 'PROJ-1', userId: 'u-author',   name: 'Author Name',   role: 'Lead Writer',       raci: 'R' },
    { projectId: 'PROJ-1', userId: 'u-reviewer', name: 'Reviewer Name', role: 'Medical Reviewer',  raci: 'A' },
  ]
  const chains: Row[] = []
  const records: Row[] = []
  const versions: Row[] = [{ id: 'ver-2', documentId: 'DOC-1', versionNumber: 'v0.2', isCurrent: true }]
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
      update: async ({ where, data }: Row) => Object.assign(documents.find(d => d.id === where.id)!, data),
    },
    // Version snapshot on the final signature (the document becomes v1.0).
    documentVersion: {
      findFirst: async ({ where }: Row) => versions.find(v => matches(v, where)) ?? null,
      findMany: async ({ where }: Row) => versions.filter(v => matches(v, where)),
      updateMany: async ({ where, data }: Row) => { const hit = versions.filter(v => matches(v, where)); hit.forEach(v => Object.assign(v, data)); return { count: hit.length } },
      create: async ({ data }: Row) => { const v = { id: `ver-${versions.length + 1}`, ...data }; versions.push(v); return v },
    },
    $executeRaw: async () => 1,
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
    // Team Approver roster — used by the 2026-10-28 "every Approver must
    // sign" validation. Default: both twoSigners users are RACI='A' on
    // PROJ-1, which satisfies the default signer list.
    projectTeamMember: {
      findMany: async ({ where }: Row) => projectTeamMembers.filter(m => matches(m, where)),
    },
    // Document RACI — who may cancel a chain (the R / assignee, besides the initiator and admins).
    documentRaci: {
      findFirst: async ({ where }: Row) => (where.userId === 'u-owner' && where.letter === 'R' ? { id: 'raci-1' } : null),
    },
    $queryRawUnsafe: async () => [],
    $transaction: async (fn: (tx: Row) => unknown) => fn(prisma),
  }
  return { prisma, documents, chains, records, versions }
}

const USERS = {
  author:   { id: 'u-author',   email: 'a@x.test', role: 'clinical-writer', modules: ['A'], tenantId: null },
  reviewer: { id: 'u-reviewer', email: 'r@x.test', role: 'reviewer',        modules: ['A'], tenantId: null },
  admin:    { id: 'u-admin',    email: 'd@x.test', role: 'admin',           modules: ['A'], tenantId: null },
  owner:    { id: 'u-owner',    email: 'o@x.test', role: 'clinical-writer', modules: ['A'], tenantId: null },
}

async function build() {
  const db = fakePrisma()
  const audit: Row[] = []
  let currentUser: Row = USERS.author
  const app: FastifyInstance = Fastify()
  app.decorate('prisma', db.prisma as never)
  app.decorate('audit', { append: async (e: Row) => { audit.push(e); return { id: '1', rowHash: 'h' } } } as never)
  const notices: Row[] = []
  app.decorate('notifications', { send: async (n: Row) => { notices.push(n); return n } } as never)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: Row }).user = currentUser })
  await app.register(signatureRoutes)
  return { app, db, audit, notices, as: (u: Row) => { currentUser = u } }
}

const twoSigners = {
  chainType: 'sequential',
  signers: [
    { signerId: 'u-author',   signerName: 'Ann Author',   signerRole: 'clinical-writer', meaning: 'authored' },
    { signerId: 'u-reviewer', signerName: 'Rob Reviewer', signerRole: 'reviewer',        meaning: 'approved' },
  ],
}
// Interim confirmation until re-authentication exists: the signer types their own full name.
const signAs = (name: string) => ({ confirmName: name, localTime: '10:00 IST' })

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
    const early = await t.app.inject({ method: 'POST', url: `/signature-records/${step2.id}/sign`, payload: signAs('Rob Reviewer') })
    expect(early.json().error).toBe('not_awaiting')

    // Only the designated signer can sign step 1.
    const wrong = await t.app.inject({ method: 'POST', url: `/signature-records/${step1.id}/sign`, payload: signAs('Ann Author') })
    expect(wrong.statusCode).toBe(403)
    expect(wrong.json().error).toBe('wrong_signer')

    t.as(USERS.author)
    const s1 = await t.app.inject({ method: 'POST', url: `/signature-records/${step1.id}/sign`, payload: signAs('Ann Author') })
    expect(s1.statusCode).toBe(200)
    expect(s1.json().status).toBe('signed')
    expect(s1.json().versionAtSigning).toBe('v0.2')   // version number, not the label ('Draft')
    expect(t.db.records.find(r => r.id === step2.id)!.status).toBe('awaiting')   // released
    expect(t.db.documents[0].status).toBe('pending_signature')

    t.as(USERS.reviewer)
    const s2 = await t.app.inject({ method: 'POST', url: `/signature-records/${step2.id}/sign`, payload: signAs('Rob Reviewer') })
    expect(s2.statusCode).toBe(200)
    expect(t.db.chains[0].status).toBe('complete')
    expect(t.db.documents[0]).toMatchObject({ status: 'signed', watermarked: false })
    expect(t.audit.map(a => a.action)).toEqual(['signature_initiated', 'signature_recorded', 'document_signed'])
  })

  it('makes the document v1.0 (Final) on the last signature, a snapshot of the signed content', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    t.as(USERS.author)
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs('Ann Author') })
    expect(t.db.versions).toHaveLength(1)                   // not after an intermediate signature
    t.as(USERS.reviewer)
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[1].id}/sign`, payload: signAs('Rob Reviewer') })
    const v1 = t.db.versions.find(v => v.versionNumber === 'v1.0')
    expect(v1).toMatchObject({ label: 'Final', isCurrent: true })
    expect(t.db.versions.find(v => v.versionNumber === 'v0.2')!.isCurrent).toBe(false)
    expect(t.db.documents[0].currentVersionId).toBe(v1!.id)
    expect(t.audit.at(-1)).toMatchObject({ action: 'document_signed', details: { finalVersionNumber: 'v1.0', versionAtSigning: 'v0.2' } })
  })

  it('records the method actually used and the server time source — never "password re-auth + TOTP"', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: { ...signAs('Ann Author'), timeSource: 'my laptop' } })
    expect(res.statusCode).toBe(200)
    const rec = t.db.records[0]
    expect(rec.authMethod).toBe('SSO session + typed full-name confirmation (re-authentication not yet configured)')
    expect(rec.timeSource).toBe('Server clock (UTC)')
    expect(rec.credentialHash).toMatch(/^[0-9a-f]{64}$/)          // a hash, never the typed value
    expect(res.json().credentialHash).toBeUndefined()            // and never sent back
    expect(res.json().auditEntryId).toBe('1')
  })

  it('refuses a signature when the typed name is not the signer’s own', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs('Rob Reviewer') })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('name_mismatch')
    const ok = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs('  ann   AUTHOR ') })
    expect(ok.statusCode).toBe(200)                              // case and spacing don't matter
    const empty = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[1].id}/sign`, payload: signAs('') })
    expect(empty.statusCode).toBe(400)
  })

  it('does not let an admin sign on someone else’s behalf', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    t.as(USERS.admin)
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs('Ann Author') })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('wrong_signer')
    expect(t.db.records[0].status).toBe('awaiting')
  })

  it('lists chains with each signed record’s audit entry id and without the credential hash', async () => {
    const audit: Row[] = []
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs('Ann Author') })
    ;(t.app as unknown as { audit: Row }).audit.pageForEntity = async (_t: string, _id: string, opts: Row) => ({
      rows: opts.action === 'signature_recorded' ? [{ id: 42n, details: { recordId: chain.records[0].id } }] : audit,
      total: 1,
    })
    const res = await t.app.inject({ method: 'GET', url: '/documents/DOC-1/signature-chains' })
    const [r1, r2] = res.json()[0].records
    expect(r1).toMatchObject({ status: 'signed', auditEntryId: '42' })
    expect(r1.credentialHash).toBeUndefined()
    expect(r2.auditEntryId).toBeNull()
  })

  it('tells each signer when it is their turn: step 1 at start, the next step after each signature', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    expect(t.notices.map(n => [n.recipientId, n.kind])).toEqual([['u-author', 'signature_requested']])
    expect(t.notices[0].linkPath).toBe('/projects/PROJ-1/clinical-writing/documents/DOC-1/sign')
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs('Ann Author') })
    expect(t.notices.map(n => n.recipientId)).toEqual(['u-author', 'u-reviewer'])
    t.as(USERS.reviewer)
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[1].id}/sign`, payload: signAs('Rob Reviewer') })
    expect(t.notices).toHaveLength(2)                            // nobody left to notify
  })

  it('notifies every signer at once in a parallel chain', async () => {
    await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: { ...twoSigners, chainType: 'parallel' } })
    expect(t.notices.map(n => n.recipientId).sort()).toEqual(['u-author', 'u-reviewer'])
  })

  it('only the owner, the person who started the chain, or an admin can cancel it', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    t.as(USERS.reviewer)                                         // a signer, but not the owner
    const denied = await t.app.inject({ method: 'POST', url: `/signature-chains/${chain.id}/cancel`, payload: { cancelReason: 'Not mine to cancel' } })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error).toBe('cancel_forbidden')
    expect(t.db.chains[0].status).toBe('in_progress')
    t.as(USERS.owner)                                            // the document's R
    const ok = await t.app.inject({ method: 'POST', url: `/signature-chains/${chain.id}/cancel`, payload: { cancelReason: 'Signer list changed' } })
    expect(ok.statusCode).toBe(200)
    expect(t.db.chains[0].status).toBe('cancelled')
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
