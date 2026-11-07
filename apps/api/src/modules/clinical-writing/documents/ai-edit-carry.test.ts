// /ai-suggest with the carry prompt flag enabled.
// Exercises the step-B wiring: given FEATURE_CARRY_PROMPT=protocol, a
// protocol doc's AI request goes through buildCarryPrompt, and the
// resulting prompt sent to aiGateway.chat carries the brief + rules.

import Fastify from 'fastify'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/document-raci/access.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/document-raci/access.js')>()),
  actorCanEditDocumentContent: vi.fn(async () => true),
}))
vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { documentsRoutes } = await import('./routes.js')

async function build({
  docType = 'protocol',
  briefExists = true,
}: { docType?: string; briefExists?: boolean } = {}) {
  const chat = vi.fn(async (args: { prompt: string }) => ({
    responseText: '<p>Revised.</p>', model: 'claude-test',
    inputTokens: 1, outputTokens: 1, costUsd: 0,
    limitDecision: 'allowed', piiScrubbed: false, piiCategories: [],
    recordId: 'rec-1', _prompt: args.prompt,
  }))
  const auditCalls: Array<Record<string, unknown>> = []
  const briefState: {
    row: { rev: number; contentJson: Record<string, unknown>; generatedAt: Date } | null
  } = {
    row: briefExists
      ? {
          rev: 2,
          contentJson: {
            rev: 2,
            document: {
              id: 'DOC-1', type: docType, title: 'Protocol X', status: 'in_authoring',
              stage: 'study_start_up', draftLabel: 'Draft – Subject to Medical, Statistical, Regulatory, and Quality Review',
              jurisdictions: ['FDA'],
              guidelineVersions: { M11: '2024', E6: 'R3-2025' },
            },
            sponsor: {
              name: 'Acme', templateId: null,
              citationStyle: 'Vancouver/ICMJE',
              tableFootnoteStyle: 'superscript a-z',
              abbreviationPolicy: 'define on first use; glossary at §1.1',
            },
            outline: [{ sectionId: 'd2', number: '6.2', title: 'Eligibility', status: 'in-progress', wordCount: 100 }],
            inventory: { tables: [], figures: [], listings: [], appendices: [] },
            references: { sources: [], citedCount: 0, nextNumber: 1 },
            openFlags: { ichWaivers: [], informationRequired: [], conflicts: [], referenceVerification: [] },
            generatedAt: '2026-11-07T00:00:00.000Z',
          },
          generatedAt: new Date('2026-11-07T00:00:00.000Z'),
        }
      : null,
  }

  // The brief service calls document.findUnique with two different
  // shapes: {include:{currentVersion}} for the full fetch, and
  // {select:{projectId}} for a cheaper lookup. Return a superset that
  // satisfies both — extra fields are harmless.
  const docSuperset = {
    id: 'DOC-1', projectId: 'proj-1', type: docType,
    title: 'Protocol X', status: 'in_authoring', stage: 'study_start_up',
    sponsor: 'Acme', templateId: null, regulatoryRegion: 'us',
    studyTitle: null, protocolNumber: null, protocolVersion: null,
    investigationalProduct: null, studyDesign: null, targetPopulation: null,
    currentVersion: {
      sections: [{
        id: 'row-1', sectionId: 'd2', sectionNumber: '6.2',
        sectionTitle: 'Eligibility', contentHtml: '<p>Adults.</p>',
        ichStatus: 'in_progress', wordCount: 100,
      }],
    },
  }

  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async (_q: unknown) => docSuperset),
    },
    project:     { findUnique: vi.fn(async () => ({ status: 'initiated' })) },
    sectionLock: { findUnique: vi.fn(async () => null) },
    documentBrief: {
      findUnique: vi.fn(async () => briefState.row),
      upsert:     vi.fn(async ({ create }: { create: { contentJson: Record<string, unknown> } }) => {
        briefState.row = {
          rev: 0, contentJson: create.contentJson,
          generatedAt: new Date('2026-11-07T00:00:00Z'),
        }
        return briefState.row
      }),
    },
    documentSource:         { findMany: vi.fn(async () => []) },
    documentUpload:         { findMany: vi.fn(async () => []) },
    tlfPackage:             { findFirst: vi.fn(async () => null) },
    ichSectionWaiver:       { findMany: vi.fn(async () => []) },
    sourceReference:        { count: vi.fn(async () => 0) },
    sourceReferenceRemoval: { count: vi.fn(async () => 0) },
    documentBriefOpenFlag:  { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({ count: 0 })) },
  } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { auditCalls.push(ev) }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, chat, auditCalls }
}

const suggest = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: '/documents/DOC-1/sections/d2/ai-suggest', payload: payload as never })

beforeEach(() => {
  process.env.FEATURE_MODULES_ENABLED = 'A'
  process.env.FEATURE_CARRY_PROMPT    = 'protocol,protocol-amendment'
})
afterEach(() => { delete process.env.FEATURE_CARRY_PROMPT })

describe('/ai-suggest with FEATURE_CARRY_PROMPT=protocol', () => {
  it('replaces the legacy intent prompt with the carry prompt for a protocol doc', async () => {
    const { app, chat } = await build({ docType: 'protocol' })
    const res = await suggest(app, { intent: 'tighten' })
    expect(res.statusCode).toBe(200)
    const sent = (chat.mock.calls[0]![0] as { prompt: string }).prompt
    expect(sent).toContain('ROLE')
    expect(sent).toMatch(/\[Information Required: /)
    expect(sent).toContain('<brief>')
    expect(sent).toContain('<ask>')
    // The tighten intent → "Rewrite this section for clarity..."
    expect(sent).toMatch(/Rewrite this section for clarity/)
  })

  it('records carryPromptUsed=true in the audit entry', async () => {
    const { app, auditCalls } = await build({ docType: 'protocol' })
    await suggest(app, { intent: 'tighten' })
    const rec = auditCalls.find(e => e.action === 'ai_suggestion_requested')
    expect((rec?.details as { carryPromptUsed: boolean }).carryPromptUsed).toBe(true)
  })

  it('leaves non-allowlisted doc types on the legacy prompt', async () => {
    const { app, chat, auditCalls } = await build({ docType: 'csr-full' })
    await suggest(app, { intent: 'tighten' })
    const sent = (chat.mock.calls[0]![0] as { prompt: string }).prompt
    expect(sent).not.toContain('ROLE')          // no carry-prompt header
    expect(sent).not.toContain('<brief>')
    const rec = auditCalls.find(e => e.action === 'ai_suggestion_requested')
    expect((rec?.details as { carryPromptUsed: boolean }).carryPromptUsed).toBe(false)
  })

  it('lazy-regens the brief when no row exists yet and still uses the carry prompt', async () => {
    const { app, chat } = await build({ docType: 'protocol', briefExists: false })
    const res = await suggest(app, { intent: 'tighten' })
    expect(res.statusCode).toBe(200)
    const sent = (chat.mock.calls[0]![0] as { prompt: string }).prompt
    expect(sent).toContain('<brief>')
  })

  it('is completely off when the env var is absent', async () => {
    delete process.env.FEATURE_CARRY_PROMPT
    const { app, chat, auditCalls } = await build({ docType: 'protocol' })
    await suggest(app, { intent: 'tighten' })
    const sent = (chat.mock.calls[0]![0] as { prompt: string }).prompt
    expect(sent).not.toContain('<brief>')
    const rec = auditCalls.find(e => e.action === 'ai_suggestion_requested')
    expect((rec?.details as { carryPromptUsed: boolean }).carryPromptUsed).toBe(false)
  })
})
