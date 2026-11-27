// Main-heading introductions after drafting: which headings are flagged (missing / stale / kept), the redraft
// prompt, and the redraft → accept / keep routes (authors and the document creator only).

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { checkSectionRefs, headingFlags, headingIntroPrompt, SECTION_INTRO_RULE, type HeadingRow } from './heading-intro.js'
import { SECTION_INTRO_RULE as WORKER_RULE } from '../../../../../worker/src/jobs/build-plan.js'

const isAuthor = vi.fn(async () => false)
const lockHolder = vi.fn(async () => null as unknown)
const updateSection = vi.fn(async () => ({ created: true, mutated: true, version: { id: 'v2', versionNumber: 2 } }))
vi.mock('../../projects/visibility.js', async (original) => ({ ...(await original<object>()), canSeeDocument: async () => true }))
vi.mock('../../platform/document-raci/access.js', async (original) => ({ ...(await original<object>()), actorIsDocumentAuthor: () => isAuthor() }))
vi.mock('../section-locks/service.js', async (original) => ({ ...(await original<object>()), requireLockHeldBy: () => lockHolder() }))
vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: async () => 'claude-sonnet-4-6' }))
vi.mock('../checklist/autocheck/runner.js', () => ({ runAutocheckForDocument: async () => undefined }))
vi.mock('../document-brief/service.js', () => ({ regenBriefInBackground: () => undefined }))
vi.mock('./service.js', () => ({ DocumentService: class { updateSection = updateSection } }))

const t = (iso: string) => new Date(iso)
const row = (number: string, html: string, at: string | null, title = `Title ${number}`): HeadingRow =>
  ({ sectionId: `s-${number}`, number, title, html, lastEditedAt: at ? t(at) : null })

describe('headingFlags', () => {
  const subs = [row('5.1', '<p>Design</p>', '2026-11-01T10:00:00Z'), row('5.2', '<p>Population</p>', '2026-11-01T10:05:00Z')]

  it('missing: the heading has no text though its sub-sections do; a heading over empty sub-sections is not flagged', () => {
    const flags = headingFlags([row('5', '', null), ...subs, row('6', '', null), row('6.1', '', null)], null)
    expect(flags).toEqual([{ sectionId: 's-5', number: '5', title: 'Title 5', reason: 'missing', changed: [{ number: '5.1', title: 'Title 5.1' }, { number: '5.2', title: 'Title 5.2' }] }])
  })

  it('stale: a sub-section changed after the introduction was written; saves of the same run (within 2 min) do not count', () => {
    const fresh = headingFlags([row('5', '<p>Intro</p>', '2026-11-01T10:04:00Z'), ...subs], null)
    expect(fresh).toEqual([])
    const later = headingFlags([row('5', '<p>Intro</p>', '2026-11-01T10:04:00Z'), subs[0]!, row('5.2', '<p>Changed</p>', '2026-11-02T09:00:00Z')], null)
    expect(later).toMatchObject([{ number: '5', reason: 'stale', changed: [{ number: '5.2' }] }])
  })

  it('the AI draft’s own later saves (validation redrafts, finishing) do not make a heading stale; later edits do', () => {
    const rows = [row('5', '<p>Intro</p>', '2026-11-01T10:04:00Z'), subs[0]!, row('5.2', '<p>Finished</p>', '2026-11-01T10:30:00Z')]
    expect(headingFlags(rows, null, { draftDoneAt: t('2026-11-01T10:31:00Z') })).toEqual([])
    const edited = [...rows.slice(0, 2), row('5.2', '<p>Edited</p>', '2026-11-02T08:00:00Z')]
    expect(headingFlags(edited, null, { draftDoneAt: t('2026-11-01T10:31:00Z') })).toMatchObject([{ number: '5', reason: 'stale' }])
  })

  it('kept as it is: not flagged until a sub-section changes after the decision', () => {
    const kept = { 's-5': { keptAt: '2026-11-03T00:00:00Z', keptBy: 'u' } }
    expect(headingFlags([row('5', '', null), ...subs], kept)).toEqual([])
    expect(headingFlags([row('5', '<p>Old</p>', '2026-11-01T09:00:00Z'), ...subs], kept)).toEqual([])
    const after = headingFlags([row('5', '', null), subs[0]!, row('5.2', '<p>New</p>', '2026-11-04T00:00:00Z')], kept)
    expect(after).toMatchObject([{ number: '5', reason: 'missing', changed: [{ number: '5.2' }] }])
  })

  it('nested headings each get their own flag; code-built sections are left out', () => {
    const rows = [row('7', '', null), row('7.1', '', null), row('7.1.1', '<p>x</p>', '2026-11-01T10:00:00Z'), row('13', '', null), row('13.1', '<p>Ref</p>', '2026-11-01T10:00:00Z')]
    expect(headingFlags(rows, null, { exclude: new Set(['13']) }).map(f => f.number)).toEqual(['7', '7.1'])
  })
})

describe('the redraft prompt', () => {
  it('sends the same rule the drafter uses for a main heading', () => {
    expect(SECTION_INTRO_RULE).toBe(WORKER_RULE)
  })
  it('carries the template guidance, fact sheet, the sub-sections and the current introduction', () => {
    const p = headingIntroPrompt({
      docType: 'protocol',
      heading: { number: '5', title: 'Study Population', html: '<p>Old intro</p>', instructions: 'Describe who is enrolled.', guidance: null },
      subSections: [{ number: '5.1', title: 'Inclusion', html: '<p>Adults 18+</p>' }],
      facts: [{ label: 'Sample size', value: '300', status: 'verified' }, { label: 'Drug', value: 'x', status: 'not_stated' }],
    })
    expect(p).toContain('SECTION: 5 Study Population')
    expect(p).toContain('Describe who is enrolled.')
    expect(p).toContain('- Sample size: 300')
    expect(p).toContain('- Drug: [TBD]')
    expect(p).toContain('### 5.1 Inclusion\nAdults 18+')
    expect(p).toContain('THE CURRENT INTRODUCTION (replace it):\nOld intro')
    expect(p).toContain(SECTION_INTRO_RULE)
  })
  it('a reference to a section that is not one of the sub-sections becomes a TBD', () => {
    expect(checkSectionRefs('<p>See Section 5.1 and Section 9.9.</p>', new Set(['5.1']))).toBe('<p>See Section 5.1 and [TBD: cross-reference to Section 9.9].</p>')
  })
})

// ------------------------------------------------------------------------------------------------ routes

const SECTIONS = [
  { sectionId: 's-5', sectionNumber: '5', sectionTitle: 'Study Population', contentHtml: '', lastEditedAt: null, templateInstructions: 'Lead in.', templateGuidance: null },
  { sectionId: 's-5.1', sectionNumber: '5.1', sectionTitle: 'Inclusion', contentHtml: '<p>Adults</p>', lastEditedAt: t('2026-11-01T10:00:00Z'), templateInstructions: null, templateGuidance: null },
]

async function build(opts: { userId?: string; doc?: Record<string, unknown> } = {}) {
  const docUpdates: Array<Record<string, unknown>> = []
  const audit = vi.fn(async () => undefined)
  const chat = vi.fn(async () => ({ responseText: '```html\n<p>This section describes the population (see Section 5.1).</p>\n```', inputTokens: 10, outputTokens: 5, model: 'claude-sonnet-4-6', recordId: 'rec-1' }))
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: 'd', type: 'protocol', status: 'draft', projectId: 'p', createdBy: 'creator', deletedAt: null, aiDraftState: 'complete',
        currentVersionId: 'v1', policyVersionAtCreate: null, headingReviews: null, factSheet: null, aiCostLimit: null, ...opts.doc,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { docUpdates.push(data); return {} }),
    },
    sectionContent: { findMany: async () => SECTIONS },
    project: { findUnique: async () => ({ status: 'active' }) },
    aiCallRecord: { updateMany: async () => ({ count: 1 }) },
    aiDraftStep: { findFirst: async () => null, findMany: async () => [] },
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorate('aiGateway', { chat, isConfigured: () => true } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: opts.userId ?? 'creator', email: 'u@x.io', role: 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  const { documentsHeadingIntroRoutes } = await import('./heading-intro.js')
  await app.register(documentsHeadingIntroRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, docUpdates, audit, chat }
}

beforeEach(() => {
  process.env.FEATURE_MODULES_ENABLED = 'A'
  isAuthor.mockResolvedValue(false)
  lockHolder.mockResolvedValue(null)
  updateSection.mockClear()
})

describe('heading routes', () => {
  it('GET flags: the empty heading is flagged; its creator may act, someone else may not', async () => {
    const { app } = await build()
    expect((await app.inject({ method: 'GET', url: '/documents/d/heading-flags' })).json()).toMatchObject({ flags: [{ number: '5', reason: 'missing' }], canAct: true, drafting: false })
    const other = await build({ userId: 'someone' })
    expect((await other.app.inject({ method: 'GET', url: '/documents/d/heading-flags' })).json()).toMatchObject({ canAct: false })
  })

  it('GET flags while the AI draft runs: nothing flagged', async () => {
    const { app } = await build({ doc: { aiDraftState: 'drafting' } })
    expect((await app.inject({ method: 'GET', url: '/documents/d/heading-flags' })).json()).toMatchObject({ flags: [], drafting: true })
  })

  it('redraft returns a preview (fence stripped), saves nothing; accept saves it as an AI-drafted edit', async () => {
    const { app, chat, audit } = await build()
    const res = await app.inject({ method: 'POST', url: '/documents/d/headings/s-5/redraft' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ html: '<p>This section describes the population (see Section 5.1).</p>', aiCallRecordId: 'rec-1', model: 'claude-sonnet-4-6' })
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ intent: 'edit', sectionId: 's-5', documentId: 'd' }))
    expect(chat.mock.calls[0]![0]).not.toHaveProperty('temperature')
    expect(updateSection).not.toHaveBeenCalled()

    const ok = await app.inject({ method: 'POST', url: '/documents/d/headings/s-5/accept', payload: { html: res.json().html, aiCallRecordId: 'rec-1', model: 'claude-sonnet-4-6' } })
    expect(ok.statusCode).toBe(200)
    expect(updateSection).toHaveBeenCalledWith(expect.objectContaining({ sectionId: 's-5', aiDrafted: true, aiCallRecordId: 'rec-1', editorUserId: 'creator' }))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_draft_accepted', details: expect.objectContaining({ kind: 'heading_intro' }) }))
  })

  it('written by hand in the panel: saved as a manual edit (not AI-drafted); empty text refused', async () => {
    const { app, audit } = await build()
    const r = await app.inject({ method: 'POST', url: '/documents/d/headings/s-5/accept', payload: { html: '<p>Our own introduction.</p>', manual: true, aiCallRecordId: 'ignored' } })
    expect(r.statusCode).toBe(200)
    const call = (updateSection.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(call).toMatchObject({ sectionId: 's-5', contentHtml: '<p>Our own introduction.</p>' })
    expect(call).not.toHaveProperty('aiDrafted')
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'section_edited', details: expect.objectContaining({ kind: 'heading_intro_manual', aiCallRecordId: null }) }))
    expect((await app.inject({ method: 'POST', url: '/documents/d/headings/s-5/accept', payload: { html: '<p> </p>', manual: true } })).statusCode).toBe(400)
  })

  it('only authors and the creator: anyone else gets 403 on redraft, accept and keep', async () => {
    const { app, chat, docUpdates } = await build({ userId: 'someone' })
    for (const path of ['redraft', 'accept', 'keep']) {
      const r = await app.inject({ method: 'POST', url: `/documents/d/headings/s-5/${path}`, payload: path === 'accept' ? { html: '<p>x</p>' } : undefined })
      expect(r.statusCode).toBe(403)
    }
    expect(chat).not.toHaveBeenCalled()
    expect(docUpdates).toEqual([])
    isAuthor.mockResolvedValue(true)
    expect((await app.inject({ method: 'POST', url: '/documents/d/headings/s-5/keep' })).statusCode).toBe(200)
  })

  it('keep records the decision; a section with no sub-sections is not a heading', async () => {
    const { app, docUpdates, audit } = await build()
    expect((await app.inject({ method: 'POST', url: '/documents/d/headings/s-5/keep' })).statusCode).toBe(200)
    expect(docUpdates[0]!.headingReviews).toMatchObject({ 's-5': { keptBy: 'creator' } })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'document.heading_intro_kept' }))
    expect((await app.inject({ method: 'POST', url: '/documents/d/headings/s-5.1/keep' })).statusCode).toBe(422)
  })

  it('accept is refused while someone else holds the section, and while the document is in review', async () => {
    lockHolder.mockResolvedValue({ userId: 'other' })
    const { app } = await build()
    expect((await app.inject({ method: 'POST', url: '/documents/d/headings/s-5/accept', payload: { html: '<p>x</p>' } })).statusCode).toBe(423)
    lockHolder.mockResolvedValue(null)
    const review = await build({ doc: { status: 'in_review' } })
    expect((await review.app.inject({ method: 'POST', url: '/documents/d/headings/s-5/accept', payload: { html: '<p>x</p>' } })).statusCode).toBe(409)
    expect(updateSection).not.toHaveBeenCalled()
  })

  it('redraft when the AI account is out of credit: a plain message and who can fix it, not the provider’s raw error', async () => {
    const { app, chat, audit } = await build()
    chat.mockRejectedValueOnce(Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), { status: 400 }))
    const r = await app.inject({ method: 'POST', url: '/documents/d/headings/s-5/redraft' })
    expect(r.statusCode).toBe(503)
    expect(r.json()).toMatchObject({ error: 'ai_out_of_credit', fix: 'admin' })
    expect(r.json().message).not.toContain('{')
    expect(audit).not.toHaveBeenCalled()
  })

  it('redraft is refused at the document’s AI cost limit', async () => {
    const { app, chat } = await build({ doc: { aiCostLimit: { usd: 0.000001, amount: 0.0001, currency: 'INR', usdRate: 92 } } })
    ;(app.prisma as unknown as Record<string, unknown>).aiDraftStep = { findMany: async () => [{ details: { model: 'm', inputTokens: 1000, outputTokens: 100 } }] }
    ;(app.prisma as unknown as Record<string, unknown>).rateCardVersion = { findFirst: async () => ({ id: 'rc', version: 'v', entries: [{ model: 'm', inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 }] }) }
    const r = await app.inject({ method: 'POST', url: '/documents/d/headings/s-5/redraft' })
    expect(r.json()).toMatchObject({ error: 'cost_limit_reached' })
    expect(chat).not.toHaveBeenCalled()
  })
})
