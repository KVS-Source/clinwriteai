// /ai-suggest persists parsed flag tokens to document_brief_open_flags.
//
// Companion to ai-edit-carry-flags.test.ts (which verifies the response
// shape). This one checks the server-side side effect: after parsing,
// the service's appendFromAiCall was called with the extracted tokens,
// and the audit entry records how many landed.

import Fastify from 'fastify'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/document-raci/access.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/document-raci/access.js')>()),
  actorCanEditDocumentContent: vi.fn(async () => true),
}))
vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { documentsRoutes } = await import('./routes.js')

async function build(opts: { responseText?: string } = {}) {
  const chat = vi.fn(async () => ({
    responseText: opts.responseText ?? '<p>x</p>', model: 'claude-test',
    inputTokens: 1, outputTokens: 1, costUsd: 0,
    limitDecision: 'allowed', piiScrubbed: false, piiCategories: [],
    recordId: 'rec-42',
  }))
  const audits: Array<Record<string, unknown>> = []
  const briefRow = {
    rev: 1,
    contentJson: {
      rev: 1,
      document: { id: 'DOC-1', type: 'protocol', title: 'P', status: 'in_authoring',
                  stage: 'study_start_up',
                  draftLabel: 'Draft – Subject to Medical, Statistical, Regulatory, and Quality Review',
                  jurisdictions: ['FDA'], guidelineVersions: { M11: '2024' } },
      sponsor: { name: 'Acme', templateId: null, citationStyle: 'Vancouver/ICMJE',
                 tableFootnoteStyle: 'superscript a-z',
                 abbreviationPolicy: 'define on first use; glossary at §1.1' },
      outline: [{ sectionId: 'd2', number: '6.2', title: 'E', status: 'in-progress', wordCount: 0 }],
      inventory: { tables: [], figures: [], listings: [], appendices: [] },
      references: { sources: [], citedCount: 0, nextNumber: 1 },
      openFlags: { ichWaivers: [], informationRequired: [], conflicts: [], referenceVerification: [], missingCrossRefTargets: [] },
      generatedAt: '2026-11-07T00:00:00.000Z',
    },
    generatedAt: new Date('2026-11-07T00:00:00Z'),
  }
  const flagCreateMany = vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => ({ count: data.length }))
  const flagFindMany   = vi.fn(async () => [])
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: 'DOC-1', projectId: 'proj-1', type: 'protocol',
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
    documentBriefOpenFlag: { findMany: flagFindMany, createMany: flagCreateMany },
    documentSource:         { findMany: vi.fn(async () => []) },
    documentUpload:         { findMany: vi.fn(async () => []) },
    tlfPackage:             { findFirst: vi.fn(async () => null) },
    ichSectionWaiver:       { findMany: vi.fn(async () => []) },
    sourceReference:        { count: vi.fn(async () => 0) },
    sourceReferenceRemoval: { count: vi.fn(async () => 0) },
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
  return { app, audits, flagCreateMany }
}

const suggest = (app: Awaited<ReturnType<typeof build>>['app']) =>
  app.inject({ method: 'POST', url: '/documents/DOC-1/sections/d2/ai-suggest', payload: { intent: 'tighten' } })

beforeEach(() => {
  process.env.FEATURE_MODULES_ENABLED = 'A'
  process.env.FEATURE_CARRY_PROMPT    = 'protocol'
})
afterEach(() => { delete process.env.FEATURE_CARRY_PROMPT })

describe('/ai-suggest flag persistence', () => {
  it('inserts a row per parsed token with the AI call id as provenance', async () => {
    const { app, flagCreateMany } = await build({
      responseText: '[Information Required: dose][Conflict: IB vs P]',
    })
    await suggest(app)
    expect(flagCreateMany).toHaveBeenCalledTimes(1)
    const data = (flagCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({
      documentId: 'DOC-1', sectionId: 'd2',
      type: 'information_required', text: 'dose',
      aiCallRecordId: 'rec-42',
    })
  })

  it('records flagsPersisted in the ai_suggestion_requested audit entry', async () => {
    const { app, audits } = await build({ responseText: '[Information Required: a]' })
    await suggest(app)
    const rec = audits.find(e => e.action === 'ai_suggestion_requested')
    expect((rec?.details as { flagsPersisted: number }).flagsPersisted).toBe(1)
  })

  it('does not call createMany when the response has no tokens', async () => {
    const { app, flagCreateMany } = await build({ responseText: '<p>clean.</p>' })
    await suggest(app)
    expect(flagCreateMany).not.toHaveBeenCalled()
  })

  it('does not call createMany when carry prompt is off (legacy prompt — no parsing)', async () => {
    delete process.env.FEATURE_CARRY_PROMPT
    const { app, flagCreateMany } = await build({ responseText: '[Information Required: X]' })
    await suggest(app)
    expect(flagCreateMany).not.toHaveBeenCalled()
  })
})
