// GET /documents/:id/sections/:sectionId/context — surfaces the exact
// policy rule-set AI will see for a section. Covers:
//   - policy resolution (pinned at create, else current)
//   - section-scoped principle + rule separation
//   - "no policy" shape (null policy, empty renderedPromptBlock)
//   - 404 when the section key doesn't match the document's version

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

type PolicyRow = {
  id: string; docType: string; version: number
  smePrompt: string
  bestPracticeDigest: unknown
  sectionRules: unknown
}

const SAMPLE_DIGEST = {
  principles: [
    { scope: 'whole-doc',    severity: 'must'   as const, text: 'Follow ICH M11 structural register throughout.' },
    { scope: 'section:s6_2', severity: 'must'   as const, text: 'Numbered list, one inclusion criterion per line.' },
    { scope: 'whole-doc',    severity: 'should' as const, text: 'Prefer active voice.' },
  ],
}
const SAMPLE_RULES = {
  s6_2: [
    { severity: 'should' as const, text: 'Describe the washout period.' },
  ],
}

async function build(opts: {
  policyPinned?:  PolicyRow | null       // returned by findUnique (pinned version)
  policyCurrent?: PolicyRow | null       // returned by findFirst  (current fallback)
  policyVersionAtCreate?: number | null
  sectionRows?: Array<{ sectionId: string; sectionNumber: string; sectionTitle: string }>
  aiInstructions?: string | null
}) {
  const sections = opts.sectionRows ?? [
    { sectionId: 's6_2', sectionNumber: '6.2', sectionTitle: 'Inclusion Criteria' },
  ]
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: 'DOC-1', projectId: 'proj-1', type: 'protocol',
        policyVersionAtCreate: opts.policyVersionAtCreate ?? null,
        aiInstructions:        opts.aiInstructions        ?? null,
        deletedAt:             null,
        currentVersion: { sections },
      })),
    },
    // canSeeDocument helper taps these; accept everything.
    projectMember:  { findMany: vi.fn(async () => [{ projectId: 'proj-1' }]) },
    documentRaci:   { findMany: vi.fn(async () => []) },
    raciAssignment: { findMany: vi.fn(async () => []) },
    documentTypePolicy: {
      findUnique: vi.fn(async () => opts.policyPinned ?? null),
      findFirst:  vi.fn(async () => opts.policyCurrent ?? null),
    },
  } as never)
  app.decorate('audit', { append: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'pm', modules: ['A'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app }
}

const get = (app: Awaited<ReturnType<typeof build>>['app'], sectionId: string) =>
  app.inject({ method: 'GET', url: `/documents/DOC-1/sections/${sectionId}/context` })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('GET /documents/:id/sections/:sectionId/context', () => {
  it('returns the pinned policy + split principle / rule lists + rendered block', async () => {
    const policy: PolicyRow = {
      id: 'pol-1', docType: 'protocol', version: 3,
      smePrompt: 'You are a Clinical Protocol subject-matter expert.',
      bestPracticeDigest: SAMPLE_DIGEST,
      sectionRules:       SAMPLE_RULES,
    }
    const { app } = await build({ policyPinned: policy, policyVersionAtCreate: 3 })
    const res = await get(app, 's6_2')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.document).toMatchObject({ id: 'DOC-1', type: 'protocol', policyVersion: 3 })
    expect(body.section).toMatchObject({ sectionId: 's6_2', sectionNumber: '6.2' })
    expect(body.policy).toMatchObject({
      id: 'pol-1', version: 3, isPinned: true,
      smePrompt: 'You are a Clinical Protocol subject-matter expert.',
    })
    expect(body.policy.wholeDocPrinciples).toEqual([
      { severity: 'must',   text: 'Follow ICH M11 structural register throughout.' },
      { severity: 'should', text: 'Prefer active voice.' },
    ])
    expect(body.policy.sectionPrinciples).toEqual([
      { severity: 'must', text: 'Numbered list, one inclusion criterion per line.' },
    ])
    expect(body.policy.sectionRules).toEqual([
      { severity: 'should', text: 'Describe the washout period.' },
    ])
    // The rendered block is what the AI drafter + /ai-suggest inject —
    // same character-identical text (asserted by policy-prompt-parity).
    expect(body.renderedPromptBlock).toContain('SME PROMPT (policy v3)')
    expect(body.renderedPromptBlock).toContain('[MUST] Follow ICH M11 structural register throughout.')
    expect(body.renderedPromptBlock).toContain('SECTION RULES (s6_2)')
  })

  it('falls back to the current policy when the document was never pinned', async () => {
    const current: PolicyRow = {
      id: 'pol-2', docType: 'protocol', version: 5,
      smePrompt: 'Latest SME prompt.',
      bestPracticeDigest: { principles: [] },
      sectionRules:       {},
    }
    const { app } = await build({ policyPinned: null, policyCurrent: current, policyVersionAtCreate: null })
    const body = (await get(app, 's6_2')).json()
    expect(body.policy).toMatchObject({ id: 'pol-2', version: 5, isPinned: false })
    expect(body.document.policyVersion).toBeNull()
  })

  it('returns policy=null + empty renderedPromptBlock when no policy exists', async () => {
    const { app } = await build({ policyPinned: null, policyCurrent: null })
    const body = (await get(app, 's6_2')).json()
    expect(body.policy).toBeNull()
    expect(body.renderedPromptBlock).toBe('')
  })

  it('surfaces document.aiInstructions when the author set them', async () => {
    const { app } = await build({ aiInstructions: 'Write in plain English, no jargon.' })
    const body = (await get(app, 's6_2')).json()
    expect(body.aiInstructions).toBe('Write in plain English, no jargon.')
  })

  it('404s when the section key does not match any section on the current version', async () => {
    const { app } = await build({ sectionRows: [] })
    expect((await get(app, 's99')).statusCode).toBe(404)
  })
})
