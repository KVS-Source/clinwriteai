// Route tests for the Part 11 signature chain: initiate → sign (sequential
// release) → document signed; refusals; cancel. Fastify inject() over an
// in-memory Prisma double — no database needed.

import bcrypt from 'bcryptjs'
import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { signatureRoutes } from './routes.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma double
type Row = Record<string, any>

// Everyone in these tests has the same login password (low bcrypt cost to keep the tests quick).
const PASSWORD = 'Correct-Horse-1!'
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4)

function fakePrisma() {
  const documents: Row[] = [{
    id: 'DOC-1', projectId: 'PROJ-1', assigneeId: 'u-owner', status: 'pending_signature', watermarked: true, signedAt: null,
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
  // The document's RACI. Everyone active on it as R, C, A or I must sign (the "named signers").
  // u-author is the Author, u-reviewer the Approver. u-owner is only the assignee (no RACI row).
  const raciRows: Row[] = [
    { id: 'raci-1', documentId: 'DOC-1', userId: 'u-author',   letter: 'R', removedAt: null },
    { id: 'raci-2', documentId: 'DOC-1', userId: 'u-reviewer', letter: 'A', removedAt: null },
  ]
  const userRows: Row[] = [
    { id: 'u-author', name: 'Ann Author' }, { id: 'u-reviewer', name: 'Rob Reviewer' },
    { id: 'u-author2', name: 'Alf Author' }, { id: 'u-cons', name: 'Cora Consulted' }, { id: 'u-info', name: 'Ian Informed' }, { id: 'u-qc', name: 'Quinn QC' },
  ]
  // Project membership, used to decide which projects a PM can see.
  const projectMembers: Row[] = [{ projectId: 'PROJ-1', userId: 'u-pm', removedAt: null }]
  const chains: Row[] = []
  const records: Row[] = []
  const versions: Row[] = [{ id: 'ver-2', documentId: 'DOC-1', versionNumber: 'v0.2', isCurrent: true }]
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'NOT') return !matches(row, v)
    if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(row[k])
    if (v && typeof v === 'object' && 'not' in v) return (row[k] ?? null) !== v.not
    return (row[k] ?? null) === v
  })
  const withRecords = (c: Row | undefined) => c && { ...c, records: records.filter(r => r.chainId === c.id).sort((a, b) => a.step - b.step) }

  const prisma: Row = {
    project: { findUnique: async () => ({ status: 'ongoing' }) },

    document: {

      count: async () => 1,
      findUnique: async ({ where }: Row) => documents.find(d => d.id === where.id) ?? null,
      updateMany: async ({ where, data }: Row) => {
        const hit = documents.filter(d => matches(d, where)); hit.forEach(d => Object.assign(d, data)); return { count: hit.length }
      },
      update: async ({ where, data }: Row) => Object.assign(documents.find(d => d.id === where.id)!, data),
      findMany: async () => [],   // "documents I work on" lookup used by the project-visibility rule
    },
    projectMember: {
      findMany: async ({ where }: Row) => projectMembers.filter(m => matches(m, where)),
    },
    user: {
      findMany: async ({ where }: Row) => userRows.filter(u => matches(u, where)),
      findUnique: async ({ where }: Row): Promise<Row | null> => ({ id: where.id, passwordHash: PASSWORD_HASH }),
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
      findMany: async ({ where }: Row) => records.filter(r => matches(r, where)),
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
    raciAssignment: { findMany: async () => [] },
    projectTeamMember: {
      findMany: async ({ where }: Row) => projectTeamMembers.filter(m => matches(m, where)),
    },
    // Document RACI — who may start / cancel / read, and who must sign.
    documentRaci: {
      findMany: async ({ where }: Row) => raciRows.filter(r => matches(r, where)),
      findFirst: async ({ where }: Row) => raciRows.find(r => matches(r, where)) ?? null,
      updateMany: async ({ where, data }: Row) => { const hit = raciRows.filter(r => matches(r, where)); hit.forEach(r => Object.assign(r, data)); return { count: hit.length } },
    },
    $queryRawUnsafe: async () => [],
    $executeRawUnsafe: async () => 0,
    $transaction: async (fn: (tx: Row) => unknown) => fn(prisma),
  }
  return { prisma, documents, chains, records, versions, raciRows, projectMembers, projectTeamMembers }
}

const USERS = {
  author:   { id: 'u-author',   email: 'a@x.test', role: 'clinical-writer', modules: ['A'], tenantId: null },
  reviewer: { id: 'u-reviewer', email: 'r@x.test', role: 'reviewer',        modules: ['A'], tenantId: null },
  admin:    { id: 'u-admin',    email: 'd@x.test', role: 'admin',           modules: ['A'], tenantId: null },
  owner:    { id: 'u-owner',    email: 'o@x.test', role: 'clinical-writer', modules: ['A'], tenantId: null },   // the assignee
  pm:       { id: 'u-pm',       email: 'p@x.test', role: 'pm',              modules: ['A'], tenantId: null },
  otherPm:  { id: 'u-pm2',      email: 'p2@x.test', role: 'pm',             modules: ['A'], tenantId: null },
  auditor:  { id: 'u-auditor',  email: 'au@x.test', role: 'auditor',        modules: ['A'], tenantId: null },
  guest:    { id: 'u-guest',    email: 'g@x.test', role: 'guest',           modules: ['A'], tenantId: null },
  cons:     { id: 'u-cons',     email: 'c@x.test', role: 'contributor',     modules: ['A'], tenantId: null },
  info:     { id: 'u-info',     email: 'i@x.test', role: 'contributor',     modules: ['A'], tenantId: null },
  qc:       { id: 'u-qc',       email: 'q@x.test', role: 'contributor',     modules: ['A'], tenantId: null },
  author2:  { id: 'u-author2', email: 'a2@x.test', role: 'clinical-writer', modules: ['A'], tenantId: null },
  outsider: { id: 'u-out',      email: 'x@x.test', role: 'contributor',     modules: ['A'], tenantId: null },   // no letter on the document
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
const signAs = (password = PASSWORD) => ({ password, localTime: '10:00 IST' })

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
    const early = await t.app.inject({ method: 'POST', url: `/signature-records/${step2.id}/sign`, payload: signAs() })
    expect(early.json().error).toBe('not_awaiting')

    // Only the designated signer can sign step 1.
    const wrong = await t.app.inject({ method: 'POST', url: `/signature-records/${step1.id}/sign`, payload: signAs() })
    expect(wrong.statusCode).toBe(403)
    expect(wrong.json().error).toBe('wrong_signer')

    t.as(USERS.author)
    const s1 = await t.app.inject({ method: 'POST', url: `/signature-records/${step1.id}/sign`, payload: signAs() })
    expect(s1.statusCode).toBe(200)
    expect(s1.json().status).toBe('signed')
    expect(s1.json().versionAtSigning).toBe('v0.2')   // version number, not the label ('Draft')
    expect(t.db.records.find(r => r.id === step2.id)!.status).toBe('awaiting')   // released
    expect(t.db.documents[0].status).toBe('pending_signature')

    t.as(USERS.reviewer)
    const s2 = await t.app.inject({ method: 'POST', url: `/signature-records/${step2.id}/sign`, payload: signAs() })
    expect(s2.statusCode).toBe(200)
    expect(t.db.chains[0].status).toBe('complete')
    expect(t.db.documents[0]).toMatchObject({ status: 'signed', watermarked: false })
    expect(t.audit.map(a => a.action)).toEqual(['signature_initiated', 'signature_recorded', 'document_signed'])
  })

  it('makes the document v1.0 (Final) on the last signature, a snapshot of the signed content', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    t.as(USERS.author)
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs() })
    expect(t.db.versions).toHaveLength(1)                   // not after an intermediate signature
    t.as(USERS.reviewer)
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[1].id}/sign`, payload: signAs() })
    const v1 = t.db.versions.find(v => v.versionNumber === 'v1.0')
    expect(v1).toMatchObject({ label: 'Final', isCurrent: true })
    expect(t.db.versions.find(v => v.versionNumber === 'v0.2')!.isCurrent).toBe(false)
    expect(t.db.documents[0].currentVersionId).toBe(v1!.id)
    expect(t.audit.at(-1)).toMatchObject({ action: 'document_signed', details: { finalVersionNumber: 'v1.0', versionAtSigning: 'v0.2' } })
  })

  it('records the method actually used and the server time source — never "password re-auth + TOTP"', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: { ...signAs(), timeSource: 'my laptop' } })
    expect(res.statusCode).toBe(200)
    const rec = t.db.records[0]
    expect(rec.authMethod).toBe('Login session + password re-entered at signing')
    expect(rec.timeSource).toBe('Server clock (UTC)')
    expect(rec.credentialHash).toMatch(/^[0-9a-f]{64}$/)          // a hash, never the password
    expect(res.json().credentialHash).toBeUndefined()            // and never sent back
    expect(res.json().auditEntryId).toBe('1')
  })

  it('still returns the recorded signature when the audit write fails once, retrying it', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const real = (t.app as unknown as { audit: { append: (e: Row) => Promise<Row> } }).audit.append
    let calls = 0
    ;(t.app as unknown as { audit: { append: (e: Row) => Promise<Row> } }).audit.append = async (e: Row) => {
      calls += 1
      if (calls === 1) throw new Error('audit down')
      return real(e)
    }
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs() })
    expect(res.statusCode).toBe(200)
    expect(calls).toBe(2)
    expect(res.json().auditEntryId).toBe('1')
  })

  it('does not report a recorded signature as failed when the audit write keeps failing', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    ;(t.app as unknown as { audit: { append: () => Promise<never> } }).audit.append = async () => { throw new Error('audit down') }
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs() })
    expect(res.statusCode).toBe(200)
    expect(res.json().auditEntryId).toBeNull()
    expect(t.db.records[0].status).toBe('signed')
  })

  it('refuses to sign once the document is no longer pending_signature, and leaves the step awaiting', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    t.db.documents[0].status = 'in_authoring'            // moved by a status change while the chain was active
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs() })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('document_not_pending_signature')
    expect(t.db.records[0].status).toBe('awaiting')
    expect(t.db.documents[0].status).toBe('in_authoring')
  })

  it('records a failed v1.0 snapshot in the audit entry, and creates the snapshot later when the chain is listed', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const dv = (t.db.prisma as unknown as { documentVersion: { create: (a: Row) => Promise<Row> } }).documentVersion
    const realCreate = dv.create
    dv.create = async () => { throw new Error('db down') }
    t.as(USERS.author)
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs() })
    t.as(USERS.reviewer)
    const last = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[1].id}/sign`, payload: signAs() })
    expect(last.statusCode).toBe(200)                                   // the signature stands
    expect(t.db.documents[0].status).toBe('signed')
    expect(t.db.versions.find(v => v.versionNumber === 'v1.0')).toBeUndefined()
    expect(t.audit.at(-1)).toMatchObject({ action: 'document_signed', details: { finalVersionNumber: null, finalSnapshotFailed: true } })

    dv.create = realCreate                                              // the database is back
    ;(t.app as unknown as { audit: Row }).audit.pageForEntity = async () => ({ rows: [] })
    const list = await t.app.inject({ method: 'GET', url: '/documents/DOC-1/signature-chains' })
    expect(list.statusCode).toBe(200)
    expect(t.db.versions.find(v => v.versionNumber === 'v1.0')).toMatchObject({ label: 'Final' })
    expect(t.audit.at(-1)).toMatchObject({ action: 'final_version_created_late' })
  })

  it('refuses a wrong password, audits the attempt, and leaves the record unsigned', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const url = `/signature-records/${chain.records[0].id}/sign`
    const res = await t.app.inject({ method: 'POST', url, payload: signAs('Wrong-Password-1!') })
    expect(res.statusCode).toBe(422)                             // not 401: that would bounce the signer to sign-in
    expect(res.json().error).toBe('wrong_password')
    expect(t.db.records[0].status).toBe('awaiting')
    expect(t.audit.at(-1)).toMatchObject({ action: 'signature_password_failed', entityId: 'DOC-1' })
    expect(JSON.stringify(t.audit)).not.toContain('Wrong-Password-1!')
    const empty = await t.app.inject({ method: 'POST', url, payload: signAs('') })
    expect(empty.statusCode).toBe(400)
    const ok = await t.app.inject({ method: 'POST', url, payload: signAs() })
    expect(ok.statusCode).toBe(200)
    expect(t.db.records[0].credentialHash).not.toContain(PASSWORD)
  })

  it('refuses to sign for an account with no password set', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    t.db.prisma.user.findUnique = async () => ({ passwordHash: null })
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs() })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('no_password_on_file')
    expect(t.db.records[0].status).toBe('awaiting')
  })

  it('does not let an admin sign on someone else’s behalf', async () => {
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    t.as(USERS.admin)
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs() })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('wrong_signer')
    expect(t.db.records[0].status).toBe('awaiting')
  })

  it('lists chains with each signed record’s audit entry id and without the credential hash', async () => {
    const audit: Row[] = []
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs() })
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
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[0].id}/sign`, payload: signAs() })
    expect(t.notices.map(n => n.recipientId)).toEqual(['u-author', 'u-reviewer'])
    t.as(USERS.reviewer)
    await t.app.inject({ method: 'POST', url: `/signature-records/${chain.records[1].id}/sign`, payload: signAs() })
    expect(t.notices).toHaveLength(2)                            // nobody left to notify
  })

  it('notifies every signer at once in a parallel chain', async () => {
    await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: { ...twoSigners, chainType: 'parallel' } })
    expect(t.notices.map(n => n.recipientId).sort()).toEqual(['u-author', 'u-reviewer'])
  })

  it('only the Author (R) or the person who started the chain can cancel it — not an admin, a PM or another signer', async () => {
    t.as(USERS.reviewer)                                         // the Approver (A) starts the chain
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    t.db.raciRows.push({ id: 'raci-9', documentId: 'DOC-1', userId: 'u-cons', letter: 'C', removedAt: null })
    for (const who of [USERS.cons, USERS.admin, USERS.pm, USERS.auditor]) {
      t.as(who)
      const denied = await t.app.inject({ method: 'POST', url: `/signature-chains/${chain.id}/cancel`, payload: { cancelReason: 'Not mine to cancel' } })
      expect(denied.statusCode, who.role).toBe(403)
      expect(denied.json().error).toBe(who === USERS.auditor ? 'auditor_read_only' : 'cancel_forbidden')
    }
    expect(t.db.chains[0].status).toBe('in_progress')
    t.as(USERS.author)                                           // the Author (R) can, though they did not start it
    const ok = await t.app.inject({ method: 'POST', url: `/signature-chains/${chain.id}/cancel`, payload: { cancelReason: 'Signer list changed' } })
    expect(ok.statusCode).toBe(200)
    expect(t.db.chains[0].status).toBe('cancelled')
  })

  it('the person who started the chain can cancel it, and so can the original assignee', async () => {
    t.as(USERS.reviewer)                                         // Approver starts, then cancels their own chain
    const first = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const own = await t.app.inject({ method: 'POST', url: `/signature-chains/${first.id}/cancel`, payload: { cancelReason: 'Started by mistake' } })
    expect(own.statusCode).toBe(200)
    t.db.documents[0].status = 'pending_signature'               // back to Pending signature
    t.as(USERS.author)
    const second = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    t.as(USERS.owner)                                            // assignee, no RACI row, role clinical-writer
    const viaAssignee = await t.app.inject({ method: 'POST', url: `/signature-chains/${second.id}/cancel`, payload: { cancelReason: 'Assignee cancels' } })
    expect(viaAssignee.statusCode).toBe(200)
  })

  it('cancel requires a reason and returns the document to in_authoring', async () => {
    // The author had submitted their part; a signer refusal starts a new authoring round.
    t.db.raciRows[0].submittedAt = new Date('2026-11-01T00:00:00Z')
    const chain = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: twoSigners })).json()
    const noReason = await t.app.inject({ method: 'POST', url: `/signature-chains/${chain.id}/cancel`, payload: { cancelReason: '' } })
    expect(noReason.statusCode).toBe(400)
    const res = await t.app.inject({ method: 'POST', url: `/signature-chains/${chain.id}/cancel`, payload: { cancelReason: 'Wrong signer order' } })
    expect(res.statusCode).toBe(200)
    expect(t.db.chains[0].status).toBe('cancelled')
    expect(t.db.documents[0].status).toBe('in_authoring')
    expect(t.db.raciRows[0].submittedAt).toBeNull()          // every author submits their part again
  })
})

// ---------------------------------------------------------------------------
// The e-signature action table: who starts a chain, who must be on it, who reads the record.
// ---------------------------------------------------------------------------

describe('signature chain — who may start it', () => {
  let t: Awaited<ReturnType<typeof build>>
  beforeEach(async () => {
    t = await build()
    t.db.raciRows.push(
      { id: 'raci-c', documentId: 'DOC-1', userId: 'u-cons', letter: 'C', removedAt: null },
      { id: 'raci-q', documentId: 'DOC-1', userId: 'u-qc',   letter: 'Q', removedAt: null },
      { id: 'raci-i', documentId: 'DOC-1', userId: 'u-info', letter: 'I', removedAt: null },
    )
  })
  const startAs = async (who: Row, payload: Row = twoSigners) => { t.as(who); return t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload }) }
  const all4 = {
    chainType: 'sequential',
    signers: [
      ...twoSigners.signers,
      { signerId: 'u-cons', signerName: 'Cora Consulted', signerRole: 'Reviewer', meaning: 'reviewed' },
      { signerId: 'u-info', signerName: 'Ian Informed',   signerRole: 'Informed', meaning: 'acknowledged' },
    ],
  }

  it('lets the Author (R), the Approver (A) and the original assignee start a chain', async () => {
    expect((await startAs(USERS.author, all4)).statusCode).toBe(201)
    for (const who of [USERS.reviewer, USERS.owner]) {
      t.db.chains.length = 0; t.db.records.length = 0
      expect((await startAs(who, all4)).statusCode, who.role).toBe(201)
    }
  })

  it('refuses everyone else: admin, PM, auditor, guest, Reviewer (C), QC (Q), Informed (I), and a user with no letter', async () => {
    for (const who of [USERS.admin, USERS.pm, USERS.auditor, USERS.guest, USERS.cons, USERS.qc, USERS.info, USERS.outsider]) {
      const res = await startAs(who, all4)
      expect(res.statusCode, who.id).toBe(403)
      expect(res.json().error, who.id).toBe(who === USERS.auditor ? 'auditor_read_only' : 'start_forbidden')
    }
    expect(t.db.chains).toHaveLength(0)
  })

  it('does not count a removed Author or Approver row', async () => {
    t.db.raciRows.push({ id: 'raci-x', documentId: 'DOC-1', userId: 'u-out', letter: 'R', removedAt: new Date() })
    expect((await startAs(USERS.outsider, all4)).statusCode).toBe(403)
  })

  it('lets the starter leave named people off the chain, and records who was left off in the audit entry', async () => {
    const res = await startAs(USERS.author, twoSigners)                       // leaves out Reviewer + Informed
    expect(res.statusCode).toBe(201)
    expect(res.json().records).toHaveLength(2)
    const init = t.audit.find(a => a.action === 'signature_initiated')!
    expect(init.details.omittedNamedSigners.map((m: Row) => m.name).sort()).toEqual(['Cora Consulted', 'Ian Informed'])
  })

  it('counts a named person who signs under a different meaning as left off, and says so', async () => {
    const other = { ...all4, signers: all4.signers.map(sg => sg.signerId === 'u-cons' ? { ...sg, meaning: 'authored' } : sg) }
    expect((await startAs(USERS.author, other)).statusCode).toBe(201)
    const init = t.audit.find(a => a.action === 'signature_initiated')!
    expect(init.details.omittedNamedSigners.map((m: Row) => m.name)).toEqual(['Cora Consulted'])
  })

  it('refuses a chain with no Approver in it, even when every other named person is on it', async () => {
    const noApprover = { ...all4, signers: all4.signers.filter(sg => sg.meaning !== 'approved') }
    const res = await startAs(USERS.author, noApprover)
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('approver_required')
    expect(t.db.chains).toHaveLength(0)
  })

  it('does not list QC (Q) or a removed assignment as left off', async () => {
    t.db.raciRows.find(r => r.id === 'raci-c')!.removedAt = new Date()        // Reviewer removed
    t.db.raciRows.find(r => r.id === 'raci-i')!.removedAt = new Date()        // Informed removed
    expect((await startAs(USERS.author, twoSigners)).statusCode).toBe(201)    // Author + Approver remain; Q is not a signer
    const init = t.audit.find(a => a.action === 'signature_initiated')!
    expect(init.details.omittedNamedSigners).toEqual([])
  })

  it('lets the starter add an Approver by hand when the document has none named', async () => {
    t.db.raciRows.find(r => r.id === 'raci-2')!.removedAt = new Date()        // the document-RACI Approver
    t.db.projectTeamMembers.length = 0                                        // and no project-team Approver
    const noApprover = { ...all4, signers: all4.signers.filter(sg => sg.meaning !== 'approved') }
    expect((await startAs(USERS.author, noApprover)).json().error).toBe('approver_required')
    t.db.chains.length = 0; t.db.records.length = 0
    const withApprover = { ...noApprover, signers: [...noApprover.signers, { signerId: 'u-extra', signerName: 'Eve Extra', signerRole: 'Approver', meaning: 'approved' }] }
    expect((await startAs(USERS.author, withApprover)).statusCode).toBe(201)
  })

  it('lets the starter add extra signers on top of the named people', async () => {
    const extra = { ...all4, signers: [...all4.signers, { signerId: 'u-extra', signerName: 'Eve Extra', signerRole: 'Reviewer', meaning: 'reviewed' }] }
    const res = await startAs(USERS.author, extra)
    expect(res.statusCode).toBe(201)
    expect(res.json().records).toHaveLength(5)
  })

  it('shows a person with two letters once without breaking the check (dual roles are out of scope)', async () => {
    t.db.raciRows.push({ id: 'raci-dual', documentId: 'DOC-1', userId: 'u-author', letter: 'C', removedAt: null })
    expect((await startAs(USERS.author, all4)).statusCode).toBe(201)
  })

  it('records the Informed signature with the "acknowledged" meaning, and the Informed person can sign it', async () => {
    const chain = (await startAs(USERS.author, { ...all4, chainType: 'parallel' })).json()
    const rec = chain.records.find((r: Row) => r.signerId === 'u-info')
    expect(rec.meaning).toBe('acknowledged')
    t.as(USERS.info)
    const res = await t.app.inject({ method: 'POST', url: `/signature-records/${rec.id}/sign`, payload: signAs() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'signed', meaning: 'acknowledged' })
  })
})

describe('signature chain — who may read the record', () => {
  let t: Awaited<ReturnType<typeof build>>
  let chainId: string
  beforeEach(async () => {
    t = await build()
    t.db.raciRows.push(
      { id: 'raci-c', documentId: 'DOC-1', userId: 'u-cons', letter: 'C', removedAt: null },
      { id: 'raci-q', documentId: 'DOC-1', userId: 'u-qc',   letter: 'Q', removedAt: null },
      { id: 'raci-i', documentId: 'DOC-1', userId: 'u-info', letter: 'I', removedAt: null },
    )
    t.as(USERS.author)
    const all4 = { chainType: 'sequential', signers: [
      ...twoSigners.signers,
      { signerId: 'u-cons', signerName: 'Cora Consulted', signerRole: 'Reviewer', meaning: 'reviewed' },
      { signerId: 'u-info', signerName: 'Ian Informed', signerRole: 'Informed', meaning: 'acknowledged' },
    ] }
    chainId = (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: all4 })).json().id
  })
  const list = async (who: Row) => { t.as(who); return t.app.inject({ method: 'GET', url: '/documents/DOC-1/signature-chains' }) }
  const one  = async (who: Row) => { t.as(who); return t.app.inject({ method: 'GET', url: `/signature-chains/${chainId}` }) }

  it('lets anyone with a letter on the document (R, A, C, Q, I), a PM on the project, and an auditor read it', async () => {
    for (const who of [USERS.author, USERS.reviewer, USERS.cons, USERS.qc, USERS.info, USERS.pm, USERS.auditor, USERS.owner]) {
      expect((await list(who)).statusCode, 'list ' + who.id).toBe(200)
      expect((await one(who)).statusCode, 'one ' + who.id).toBe(200)
    }
  })

  it('refuses a tenant admin, a guest, a PM outside the project, and a user with no letter', async () => {
    for (const who of [USERS.admin, USERS.guest, USERS.otherPm, USERS.outsider]) {
      const l = await list(who)
      expect(l.statusCode, 'list ' + who.id).toBe(403)
      expect(l.json().error).toBe('signature_access_forbidden')
      expect((await one(who)).statusCode, 'one ' + who.id).toBe(403)
    }
  })

  it('does not count a removed assignment as access', async () => {
    t.db.raciRows.find(r => r.id === 'raci-q')!.removedAt = new Date()
    expect((await list(USERS.qc)).statusCode).toBe(403)
  })
})

describe('signature chain — grouped order (Authors, then Reviewers, then Approvers, then Informed)', () => {
  let t: Awaited<ReturnType<typeof build>>
  beforeEach(async () => {
    t = await build()
    t.db.raciRows.push(
      { id: 'raci-c', documentId: 'DOC-1', userId: 'u-cons', letter: 'C', removedAt: null },
      { id: 'raci-i', documentId: 'DOC-1', userId: 'u-info', letter: 'I', removedAt: null },
    )
    t.as(USERS.author)
  })
  // Submitted in a scrambled order on purpose: the server must put the groups in order.
  const signers = [
    { signerId: 'u-info',    signerName: 'Ian Informed',   signerRole: 'Informed', meaning: 'acknowledged' },
    { signerId: 'u-reviewer', signerName: 'Rob Reviewer',  signerRole: 'Approver', meaning: 'approved' },
    { signerId: 'u-cons',    signerName: 'Cora Consulted', signerRole: 'Reviewer', meaning: 'reviewed' },
    { signerId: 'u-author2', signerName: 'Alf Author',     signerRole: 'Author',   meaning: 'authored' },
    { signerId: 'u-author',  signerName: 'Ann Author',     signerRole: 'Author',   meaning: 'authored' },
  ]
  const start = async (extra: Row = {}) => (await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: { chainType: 'grouped', signers, ...extra } })).json()
  const sign = (who: Row, recordId: string) => { t.as(who); return t.app.inject({ method: 'POST', url: `/signature-records/${recordId}/sign`, payload: signAs() }) }
  const status = (chain: Row) => Object.fromEntries(t.db.records.filter(r => r.chainId === chain.id).map(r => [r.signerId, r.status]))

  it('is the default order when none is given', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/documents/DOC-1/signature-chains', payload: { signers } })
    expect(res.statusCode).toBe(201)
    expect(res.json().chainType).toBe('grouped')
  })

  it('stores the groups in order and has the whole first group awaiting, everyone else queued', async () => {
    const chain = await start()
    expect(chain.records.map((r: Row) => r.meaning)).toEqual(['authored', 'authored', 'reviewed', 'approved', 'acknowledged'])
    expect(chain.records.map((r: Row) => r.step)).toEqual([1, 2, 3, 4, 5])
    expect(status(chain)).toEqual({ 'u-author': 'awaiting', 'u-author2': 'awaiting', 'u-cons': 'queued', 'u-reviewer': 'queued', 'u-info': 'queued' })
    expect(t.notices.map(n => n.recipientId).sort()).toEqual(['u-author', 'u-author2'])     // both Authors are told
  })

  it('releases each group only when the group before it has fully signed, and tells who is released', async () => {
    const chain = await start()
    const rec = (id: string) => chain.records.find((r: Row) => r.signerId === id).id

    // Reviewer cannot jump the queue while the Authors are still signing.
    expect((await sign(USERS.cons, rec('u-cons'))).json().error).toBe('not_awaiting')

    // One Author signs: the other Author is still to sign, so nobody new is released.
    expect((await sign(USERS.author, rec('u-author'))).statusCode).toBe(200)
    expect(status(chain)['u-cons']).toBe('queued')

    // The second Author signs: the Reviewer group is released and told.
    expect((await sign(USERS.author2, rec('u-author2'))).statusCode).toBe(200)
    expect(status(chain)).toMatchObject({ 'u-cons': 'awaiting', 'u-reviewer': 'queued', 'u-info': 'queued' })
    expect(t.notices.at(-1)).toMatchObject({ recipientId: 'u-cons', kind: 'signature_requested' })

    // Reviewer signs -> Approver; Approver signs -> Informed; Informed signs -> the document is signed.
    await sign(USERS.cons, rec('u-cons'))
    expect(status(chain)).toMatchObject({ 'u-reviewer': 'awaiting', 'u-info': 'queued' })
    await sign(USERS.reviewer, rec('u-reviewer'))
    expect(status(chain)).toMatchObject({ 'u-info': 'awaiting' })
    expect(t.db.documents[0].status).toBe('pending_signature')
    expect((await sign(USERS.info, rec('u-info'))).statusCode).toBe(200)
    expect(t.db.chains[0].status).toBe('complete')
    expect(t.db.documents[0].status).toBe('signed')
  })

  it('skips a group nobody is in', async () => {
    const noReviewer = signers.filter(sg => sg.meaning !== 'reviewed')
    const chain = await start({ signers: noReviewer })
    const rec = (id: string) => chain.records.find((r: Row) => r.signerId === id).id
    await sign(USERS.author, rec('u-author'))
    await sign(USERS.author2, rec('u-author2'))
    expect(status(chain)).toMatchObject({ 'u-reviewer': 'awaiting', 'u-info': 'queued' })     // straight to the Approvers
  })
})
