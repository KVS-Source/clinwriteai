// Route tests — stubbed Prisma, Fastify inject(). Covers the full
// CRUD + versioning state machine.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentTypePolicyRoutes } from './routes.js'

interface Row {
  id:                  string
  docType:             string
  version:             number
  isCurrent:           boolean
  smePrompt:           string
  bestPracticeDigest:  object
  sectionRules:        object
  templateId:          string | null
  checklistTemplateId: string | null
  ichFramework:        string | null
  effectiveDate:       Date
  supersededBy:        string | null
  retiredAt:           Date | null
  retiredBy:           string | null
  retireReason:        string | null
  createdBy:           string
  updatedBy:           string
  createdAt:           Date
  updatedAt:           Date
}

function mkRow(over: Partial<Row> = {}): Row {
  return {
    id: 'row-1',
    docType: 'protocol',
    version: 1,
    isCurrent: true,
    smePrompt: 'SME prompt body',
    bestPracticeDigest: { principles: [] },
    sectionRules: {},
    templateId: null,
    checklistTemplateId: null,
    ichFramework: null,
    effectiveDate: new Date('2026-11-10T00:00:00Z'),
    supersededBy: null,
    retiredAt: null,
    retiredBy: null,
    retireReason: null,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: new Date('2026-11-10T00:00:00Z'),
    updatedAt: new Date('2026-11-10T00:00:00Z'),
    ...over,
  }
}

async function build(opts: {
  rows?: Row[]
  callerRole?: AuthenticatedUser['role']
  docCount?: number                                    // pinned-to-version count for updateCurrent
  upload?: { id: string; contentType: string | null } | null
  enqueueThrows?: boolean
} = {}) {
  const state: { rows: Row[] } = { rows: opts.rows ?? [] }
  const audit = vi.fn(async () => undefined)
  const enqueue = vi.fn(async () => {
    if (opts.enqueueThrows) throw new Error('redis down')
    return { jobId: 'bullmq-generated' }
  })
  const app = Fastify()
  app.decorate('queue', { enqueue } as never)
  app.decorate('prisma', {
    documentUpload: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (opts.upload === null) return null
        if (opts.upload === undefined) return { id: where.id, contentType: 'application/pdf' }
        return opts.upload.id === where.id ? opts.upload : null
      }),
    },
    documentTypePolicy: {
      findFirst:  vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const w = where as { docType: string; isCurrent?: boolean; retiredAt?: null }
        return state.rows.find(r => r.docType === w.docType && (w.isCurrent === undefined || r.isCurrent === w.isCurrent) && (w.retiredAt === undefined || r.retiredAt === null)) ?? null
      }),
      findMany:   vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy: unknown }) => {
        void orderBy
        const w = where as { docType?: string; isCurrent?: boolean; retiredAt?: null }
        return state.rows.filter(r =>
          (!w.docType || r.docType === w.docType) &&
          (w.isCurrent === undefined || r.isCurrent === w.isCurrent) &&
          (w.retiredAt === undefined || r.retiredAt === null))
      }),
      findUnique: vi.fn(async ({ where }: { where: { docType_version: { docType: string; version: number } } }) => {
        const { docType, version } = where.docType_version
        return state.rows.find(r => r.docType === docType && r.version === version) ?? null
      }),
      create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        const row = mkRow({ ...data, id: `row-${state.rows.length + 1}` })
        state.rows.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = state.rows.find(x => x.id === where.id)
        if (!r) throw new Error('not found')
        Object.assign(r, data)
        return r
      }),
    },
    document: {
      count: vi.fn(async () => opts.docCount ?? 0),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn((app as unknown as { prisma: unknown }).prisma)),
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = {
      id: 'u1', email: 'u@x.io',
      role: opts.callerRole ?? 'tenant-admin',
      modules: ['A'], tenantId: null,
    }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentTypePolicyRoutes, { prefix: '/document-type-policies' })
  await app.ready()
  return { app, audit, state, enqueue }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('GET /document-type-policies', () => {
  it('lists every current, non-retired policy', async () => {
    const { app } = await build({ rows: [
      mkRow({ docType: 'protocol', version: 1, isCurrent: true }),
      mkRow({ docType: 'csr-full', version: 1, isCurrent: true }),
      mkRow({ docType: 'ib',       version: 1, isCurrent: true, retiredAt: new Date() }),
    ]})
    const res = await app.inject({ method: 'GET', url: '/document-type-policies' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { policies: Array<{ docType: string }> }
    expect(body.policies.map(p => p.docType).sort()).toEqual(['csr-full', 'protocol'])
  })
})

describe('GET /document-type-policies/:docType', () => {
  it('returns the current policy for a doc type', async () => {
    const { app } = await build({ rows: [mkRow({ docType: 'protocol' })] })
    const res = await app.inject({ method: 'GET', url: '/document-type-policies/protocol' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { docType: string }).docType).toBe('protocol')
  })

  it('404s when no current policy exists', async () => {
    const { app } = await build({ rows: [] })
    const res = await app.inject({ method: 'GET', url: '/document-type-policies/protocol' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /document-type-policies — create first version', () => {
  it('creates version 1 with isCurrent=true', async () => {
    const { app, audit, state } = await build()
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies',
      payload: {
        docType: 'protocol',
        smePrompt: 'You are an SME...',
        bestPracticeDigest: { principles: [{ scope: 'whole-doc', severity: 'must', text: 'No fabrication.' }] },
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { docType: string; version: number; isCurrent: boolean }
    expect(body).toMatchObject({ docType: 'protocol', version: 1, isCurrent: true })
    expect(state.rows).toHaveLength(1)
    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'document_type_policy.created')
    expect(rec?.details).toMatchObject({ docType: 'protocol', version: 1 })
  })

  it('409s when a current policy already exists for the doc type', async () => {
    const { app } = await build({ rows: [mkRow({ docType: 'protocol' })] })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies',
      payload: { docType: 'protocol', smePrompt: 'another' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'already_exists' })
  })

  it('403s when caller is not an admin', async () => {
    const { app } = await build({ callerRole: 'contributor' })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies',
      payload: { docType: 'protocol', smePrompt: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('400s on missing smePrompt', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'POST', url: '/document-type-policies', payload: { docType: 'protocol' } })
    expect(res.statusCode).toBe(400)
  })

  it('400s when bestPracticeDigest has a bad scope', async () => {
    const { app } = await build()
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies',
      payload: {
        docType: 'protocol', smePrompt: 'x',
        bestPracticeDigest: { principles: [{ scope: 'anywhere', severity: 'must', text: 'y' }] },
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /document-type-policies/:docType — edit current', () => {
  it('edits in place when no document has pinned this version', async () => {
    const { app, state } = await build({
      rows: [mkRow({ docType: 'protocol', smePrompt: 'old' })],
      docCount: 0,
    })
    const res = await app.inject({
      method: 'PATCH', url: '/document-type-policies/protocol',
      payload: { smePrompt: 'new' },
    })
    expect(res.statusCode).toBe(200)
    expect(state.rows[0]?.smePrompt).toBe('new')
  })

  it('409 version_in_use when a document has pinned this version', async () => {
    const { app } = await build({
      rows: [mkRow({ docType: 'protocol' })],
      docCount: 3,
    })
    const res = await app.inject({
      method: 'PATCH', url: '/document-type-policies/protocol',
      payload: { smePrompt: 'new' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'version_in_use' })
  })
})

describe('POST /document-type-policies/:docType/bump — new version', () => {
  it('flips the old row to isCurrent=false and inserts v2 as isCurrent=true', async () => {
    const { app, audit, state } = await build({
      rows: [mkRow({ docType: 'protocol', version: 1, isCurrent: true })],
    })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/bump',
      payload: { smePrompt: 'v2 prompt', changeReason: 'incorporated 2026-11 SME feedback' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { version: number; isCurrent: boolean }
    expect(body).toMatchObject({ version: 2, isCurrent: true })
    const v1 = state.rows.find(r => r.version === 1)!
    const v2 = state.rows.find(r => r.version === 2)!
    expect(v1.isCurrent).toBe(false)
    expect(v1.supersededBy).toBe(v2.id)
    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'document_type_policy.bumped')
    expect(rec?.details).toMatchObject({ newVersion: 2, changeReason: 'incorporated 2026-11 SME feedback' })
  })

  it('404 when there is no current policy to bump', async () => {
    const { app } = await build()
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/bump',
      payload: { smePrompt: 'x', changeReason: 'first' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('400 when changeReason is missing', async () => {
    const { app } = await build({ rows: [mkRow({ docType: 'protocol' })] })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/bump',
      payload: { smePrompt: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /document-type-policies/:docType/distill-best-practice', () => {
  const policyRow = () => mkRow({ docType: 'protocol', version: 3, id: 'pol-3' })

  it('enqueues the distill_best_practice job with the policy id + upload id', async () => {
    const { app, enqueue, audit } = await build({
      rows: [policyRow()],
      upload: { id: 'up-7', contentType: 'application/pdf' },
    })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/distill-best-practice',
      payload: { uploadId: 'up-7' },
    })
    expect(res.statusCode).toBe(202)
    const body = res.json() as { jobId: string; policyId: string; docType: string; version: number }
    expect(body).toMatchObject({ jobId: 'bp-distill-pol-3-up-7', policyId: 'pol-3', docType: 'protocol', version: 3 })
    expect(enqueue).toHaveBeenCalledTimes(1)
    const [name, payload, opts] = enqueue.mock.calls[0]!
    expect(name).toBe('platform.distill_best_practice')
    expect(payload).toMatchObject({ policyId: 'pol-3', uploadId: 'up-7', actorId: 'u1' })
    expect(opts).toMatchObject({ jobId: 'bp-distill-pol-3-up-7' })
    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'document_type_policy.bp_distill_enqueued')
    expect(rec?.details).toMatchObject({ uploadId: 'up-7', jobId: 'bp-distill-pol-3-up-7' })
  })

  it('404 when no current policy exists for the doc type', async () => {
    const { app, enqueue } = await build({
      rows: [], upload: { id: 'up-7', contentType: 'application/pdf' },
    })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/distill-best-practice',
      payload: { uploadId: 'up-7' },
    })
    expect(res.statusCode).toBe(404)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('400 when the uploadId does not exist', async () => {
    const { app } = await build({ rows: [policyRow()], upload: null })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/distill-best-practice',
      payload: { uploadId: 'does-not-exist' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'upload_not_found' })
  })

  it('400 when the upload is not application/pdf', async () => {
    const { app } = await build({
      rows: [policyRow()],
      upload: { id: 'up-7', contentType: 'application/msword' },
    })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/distill-best-practice',
      payload: { uploadId: 'up-7' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'not_pdf' })
  })

  it('400 when uploadId is missing from the body', async () => {
    const { app } = await build({ rows: [policyRow()] })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/distill-best-practice',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('403 when the caller is not an admin', async () => {
    const { app, enqueue } = await build({
      rows: [policyRow()],
      upload: { id: 'up-7', contentType: 'application/pdf' },
      callerRole: 'contributor',
    })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/distill-best-practice',
      payload: { uploadId: 'up-7' },
    })
    expect(res.statusCode).toBe(403)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('503 when the queue is down (Redis unreachable)', async () => {
    const { app, audit } = await build({
      rows: [policyRow()],
      upload: { id: 'up-7', contentType: 'application/pdf' },
      enqueueThrows: true,
    })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/distill-best-practice',
      payload: { uploadId: 'up-7' },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: 'enqueue_failed' })
    // No audit entry on enqueue failure — nothing meaningful happened.
    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'document_type_policy.bp_distill_enqueued')
    expect(rec).toBeUndefined()
  })
})

describe('POST /document-type-policies/:docType/retire', () => {
  it('flips the current to retired + records reason', async () => {
    const { app, state } = await build({ rows: [mkRow({ docType: 'protocol' })] })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/retire',
      payload: { reason: 'Pulled pending compliance review.' },
    })
    expect(res.statusCode).toBe(200)
    expect(state.rows[0]?.isCurrent).toBe(false)
    expect(state.rows[0]?.retireReason).toBe('Pulled pending compliance review.')
  })

  it('404 when no current policy', async () => {
    const { app } = await build()
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/retire',
      payload: { reason: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('400 when reason is missing', async () => {
    const { app } = await build({ rows: [mkRow({ docType: 'protocol' })] })
    const res = await app.inject({
      method: 'POST', url: '/document-type-policies/protocol/retire',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /document-type-policies/:docType/versions', () => {
  it('returns every version (current + superseded)', async () => {
    const { app } = await build({ rows: [
      mkRow({ docType: 'protocol', version: 1, isCurrent: false }),
      mkRow({ docType: 'protocol', version: 2, isCurrent: true }),
      mkRow({ docType: 'csr-full', version: 1, isCurrent: true }),
    ]})
    const res = await app.inject({ method: 'GET', url: '/document-type-policies/protocol/versions' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { versions: Array<{ version: number }> }
    expect(body.versions.map(v => v.version).sort()).toEqual([1, 2])
  })
})
