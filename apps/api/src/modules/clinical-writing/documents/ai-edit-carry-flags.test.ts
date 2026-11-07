// /ai-suggest flag-token parsing (step C of sPM-carry-prompt).
//
// When the carry prompt was active, the response should surface the
// parsed flag tokens as a `flags` array on the response body, and the
// audit entry should carry a per-type summary. When the carry prompt
// was NOT active (env var absent or non-allowlisted doc type), the
// tokens must not be parsed — legacy prompts don't train the model on
// those tokens and false positives would mislead.

import Fastify from 'fastify'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/document-raci/access.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/document-raci/access.js')>()),
  actorCanEditDocumentContent: vi.fn(async () => true),
}))
vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { documentsRoutes } = await import('./routes.js')

async function build(opts: {
  docType?:      string
  responseText?: string
} = {}) {
  const chat = vi.fn(async () => ({
    responseText: opts.responseText ?? '<p>Revised.</p>', model: 'claude-test',
    inputTokens: 1, outputTokens: 1, costUsd: 0,
    limitDecision: 'allowed', piiScrubbed: false, piiCategories: [],
    recordId: 'rec-1',
  }))
  const audits: Array<Record<string, unknown>> = []
  const briefRow = {
    rev: 1,
    contentJson: {
      rev: 1,
      document: {
        id: 'DOC-1', type: opts.docType ?? 'protocol', title: 'P', status: 'in_authoring',
        stage: 'study_start_up', draftLabel: 'Draft – Subject to Medical, Statistical, Regulatory, and Quality Review',
        jurisdictions: ['FDA'],
        guidelineVersions: { M11: '2024' },
      },
      sponsor: { name: 'Acme', templateId: null, citationStyle: 'Vancouver/ICMJE', tableFootnoteStyle: 'superscript a-z', abbreviationPolicy: 'define on first use; glossary at §1.1' },
      outline: [{ sectionId: 'd2', number: '6.2', title: 'E', status: 'in-progress', wordCount: 0 }],
      inventory: { tables: [], figures: [], listings: [], appendices: [] },
      references: { sources: [], citedCount: 0, nextNumber: 1 },
      openFlags: { ichWaivers: [], informationRequired: [], conflicts: [], referenceVerification: [] },
      generatedAt: '2026-11-07T00:00:00.000Z',
    },
    generatedAt: new Date('2026-11-07T00:00:00Z'),
  }
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: 'DOC-1', projectId: 'proj-1', type: opts.docType ?? 'protocol',
        title: 'P', status: 'in_authoring', stage: 'study_start_up',
        sponsor: 'Acme', templateId: null, regulatoryRegion: 'us',
        studyTitle: null, protocolNumber: null, protocolVersion: null,
        investigationalProduct: null, studyDesign: null, targetPopulation: null,
        currentVersion: {
          sections: [{ id: 'row-1', sectionId: 'd2', sectionNumber: '6.2',
                        sectionTitle: 'E', contentHtml: '<p>x</p>',
                        ichStatus: 'in_progress', wordCount: 0 }],
        },
      })),
    },
    project:        { findUnique: vi.fn(async () => ({ status: 'initiated' })) },
    sectionLock:    { findUnique: vi.fn(async () => null) },
    documentBrief:  { findUnique: vi.fn(async () => briefRow), upsert: vi.fn(async () => briefRow) },
    documentSource:         { findMany: vi.fn(async () => []) },
    documentUpload:         { findMany: vi.fn(async () => []) },
    tlfPackage:             { findFirst: vi.fn(async () => null) },
    ichSectionWaiver:       { findMany: vi.fn(async () => []) },
    sourceReference:        { count: vi.fn(async () => 0) },
    sourceReferenceRemoval: { count: vi.fn(async () => 0) },
    documentBriefOpenFlag:  { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({ count: 0 })) },
  } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { audits.push(ev) }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, audits }
}

const suggest = (app: Awaited<ReturnType<typeof build>>['app']) =>
  app.inject({ method: 'POST', url: '/documents/DOC-1/sections/d2/ai-suggest', payload: { intent: 'tighten' } })

beforeEach(() => {
  process.env.FEATURE_MODULES_ENABLED = 'A'
  process.env.FEATURE_CARRY_PROMPT    = 'protocol'
})
afterEach(() => { delete process.env.FEATURE_CARRY_PROMPT })

describe('/ai-suggest flag-token parsing', () => {
  it('returns flags[] with every bracketed escape-hatch found in the response', async () => {
    const { app } = await build({
      responseText: 'The dose was [Information Required: confirm mg/kg]. [Conflict: IB says 5mg, Protocol says 10mg]',
    })
    const res = await suggest(app)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { flags: Array<{ type: string; text: string }> }
    expect(body.flags).toHaveLength(2)
    expect(body.flags[0]).toMatchObject({ type: 'information_required', text: 'confirm mg/kg' })
    expect(body.flags[1]).toMatchObject({ type: 'conflict' })
  })

  it('leaves tokens inline in responseText (UI renders with highlights, not replacements)', async () => {
    const { app } = await build({
      responseText: '<p>[Information Required: dose]</p>',
    })
    const res = await suggest(app)
    expect((res.json() as { responseText: string }).responseText).toContain('[Information Required: dose]')
  })

  it('records flagsSummary counts in the ai_suggestion_requested audit entry', async () => {
    const { app, audits } = await build({
      responseText: '[Information Required: a][Information Required: b][Conflict: x vs y]',
    })
    await suggest(app)
    const rec = audits.find(e => e.action === 'ai_suggestion_requested')
    expect((rec?.details as { flagsSummary: Record<string, number> }).flagsSummary).toMatchObject({
      information_required: 2,
      conflict:             1,
    })
  })

  it('returns flags: [] when carry prompt is off (legacy prompt — do not scan)', async () => {
    delete process.env.FEATURE_CARRY_PROMPT
    const { app } = await build({
      responseText: 'This [Information Required: X] should not be parsed when carry is off.',
    })
    const res = await suggest(app)
    const body = res.json() as { flags: unknown[] }
    expect(body.flags).toEqual([])
  })

  it('returns flags: [] when the response has no tokens', async () => {
    const { app } = await build({ responseText: '<p>All clean.</p>' })
    const res = await suggest(app)
    expect((res.json() as { flags: unknown[] }).flags).toEqual([])
  })
})
