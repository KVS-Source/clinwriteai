// The drafting worker with a build plan: the real handler, with the AI call replaced, drafts a Protocol in the plan's
// order, gives each section the sections it depends on, leaves headings and References alone, and drafts a document
// created before the plan in the template's order.

import { readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAiInitialDraft } from '../../../../../worker/src/jobs/ai-initial-draft.js'

const PLAN = JSON.parse(readFileSync(new URL('../../../../../../policy-packages/protocol-build-plan/build-plan.json', import.meta.url), 'utf8')) as {
  stages: Array<{ sections: Array<{ number: string; title: string }> }>
}
const TEMPLATE = [
  ...Array.from({ length: 11 }, (_, i) => ({ number: String(i + 1), title: `Heading ${i + 1}` })),
  ...PLAN.stages.flatMap(s => s.sections),
  { number: '12', title: 'References' },
].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true })).map(s => ({ ...s, id: `s${s.number}` }))

type Call = { temperature?: number; prompt: string; titles: string[] }
const state = vi.hoisted(() => ({ calls: [] as Call[], pdf: Buffer.alloc(0), factAnswer: '[]' }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (body: { temperature?: number; messages: Array<{ content: Array<{ type: string; text?: string; title?: string }> }> }) => {
        const prompt = body.messages[0]!.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        state.calls.push({ temperature: body.temperature, prompt, titles: body.messages[0]!.content.filter(c => c.type === 'document').map(c => c.title!) })
        if (prompt.includes('Extract the key facts')) return { content: [{ type: 'text', text: state.factAnswer }], usage: { input_tokens: 100, output_tokens: 50 } }
        const n = /Draft section (\S+) /.exec(prompt)?.[1]
        return { content: [{ type: 'text', text: `<!-- sources-used: 1 --><p>Facts of ${n}</p>` }], usage: { input_tokens: 10, output_tokens: 5 } }
      },
    }
  },
}))
vi.mock('../../../../../worker/src/blob-reader.js', async (original) => ({
  ...(await original<object>()), createBlobReaderFromEnv: () => ({ read: async () => ({ bytes: state.pdf, contentType: 'application/pdf' }) }),
}))
vi.mock('../../../../../worker/src/jobs/resolve-anthropic-key.js', () => ({ resolveAnthropicKey: async () => 'k' }))
vi.mock('../../../../../worker/src/ai-engine-settings.js', () => ({ resolveDraftModel: async () => 'claude-sonnet-4-6' }))
vi.mock('../../../../../worker/src/jobs/policy-prompt.js', () => ({
  resolveForDocument: async () => null, renderPolicyPromptBlock: () => '', SECTION_GROUNDING_RULES: '',
}))
vi.mock('../../../../../worker/src/jobs/ai-draft-step.js', () => ({ createStepLogger: () => ({ emit: async () => undefined }) }))

function run(policyVersionAtCreate: number | null, opts: { plan?: unknown; factSheet?: unknown; aiCostLimit?: unknown } = {}) {
  const written: string[] = []
  const updates: Array<Record<string, unknown>> = []
  const prisma = {
    document: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return {} }),
      findUnique: vi.fn(async () => ({ aiDraftState: 'drafting', policyVersionAtCreate, aiInstructions: null, aiPromptRecordId: null, bestPracticeRecordId: null, factSheet: opts.factSheet ?? null, aiCostLimit: opts.aiCostLimit ?? null })),
    },
    project: { findUnique: async () => null },
    documentTypePolicy: { findUnique: vi.fn(async () => ({ buildPlan: opts.plan ?? PLAN })) },
    documentTemplate: { findFirst: async () => ({ sections: TEMPLATE }) },
    documentUpload: { findMany: async () => [{ id: 'u1', title: 'Synopsis', fileName: 'syn.pdf', sourceCategory: 'protocol', blobKey: 'k', contentType: 'application/pdf' }] },
    documentSource: { findMany: async () => [] },
    sectionContent: {
      findMany: async () => TEMPLATE.map(s => ({ id: `row-${s.id}`, sectionId: s.id, contentHtml: '', templateFormatRules: null, templateInstructions: null, templateGuidance: null })),
      update: vi.fn(async ({ where }: { where: { id: string } }) => { written.push(where.id.replace('row-s', '')); return {} }),
    },
    editHistory: { create: async () => ({}) },
    rateCardVersion: { findFirst: async () => ({ id: 'rc', entries: [{ model: 'claude-sonnet-4-6', inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 }] }) },
    platformSettings: { findUnique: async () => ({ localisation: { currency: 'INR', usdRate: 84 } }) },
    aiDraftStep: { findMany: async () => [] },
    aiSectionDraftTrace: { create: async () => ({}) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  }
  return {
    written,
    updates,
    done: handleAiInitialDraft(
      { data: { documentId: 'd', versionId: 'v', projectId: 'p', type: 'protocol', sourceUploadIds: ['u1'], assigneeId: 'u', actorId: 'u' } } as never,
      { prisma, log: { info() {}, warn() {}, error() {} }, enqueue: vi.fn() } as never,
    ),
  }
}

async function pdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) doc.addPage().drawText(text, { x: 20, y: 700, size: 9, font })
  return Buffer.from(await doc.save())
}
const callFor = (n: string) => state.calls.find(c => c.prompt.includes(`Draft section ${n} `))!

describe('drafting with the Protocol build plan', () => {
  beforeEach(async () => {
    state.calls.length = 0
    state.factAnswer = '[]'
    state.pdf = await pdf([''])
  })

  it('drafts in the plan’s order, gives each section what it depends on, and leaves headings and References alone', async () => {
    const { written, done } = run(2)
    await done
    expect(written.slice(0, 4)).toEqual(['3.1', '3.2', '3.3', '4.1'])
    expect(written.slice(-2)).toEqual(['1.1', '1.2'])
    expect(written).toHaveLength(50)
    expect(written).not.toContain('12')
    expect(written).not.toContain('4')

    const prompt = (n: string) => state.calls.find(c => c.prompt.includes(`Draft section ${n} `))!.prompt
    expect(prompt('3.1')).not.toContain('EARLIER SECTIONS')
    expect(prompt('6.4')).toContain('--- 5.4 Withdrawal and Replacement ---\n<p>Facts of 5.4</p>')
    expect(prompt('6.4')).not.toContain('--- 3.1 ')
    expect(prompt('1.1')).toContain('THIS SECTION SUMMARISES THE DOCUMENT')
    expect(prompt('1.1')).toContain('--- 10.6 Interim Analyses ---')
    expect(prompt('9.1')).toContain('Standard wording from EXAMPLE sources may be reused')
    expect(prompt('7.1')).toContain('[XREF: <section number>]')
    expect(prompt('7.1')).toContain('1.3 Schedule of Activities')
    expect(prompt('2.1')).toContain('[REF: <first author surname> <year>')
    // The plan sets rules.temperature 0, but the API rejects temperature on every model: never sent.
    expect(state.calls.every(c => !('temperature' in c) || c.temperature === undefined)).toBe(true)
  })

  it('a document created before the plan drafts every section in the template’s order, as before', async () => {
    const { written, done } = run(null)
    await done
    expect(written).toHaveLength(TEMPLATE.length)
    expect(written.slice(0, 3)).toEqual(['1', '1.1', '1.2'])
    expect(state.calls.some(c => c.prompt.includes('EARLIER SECTIONS'))).toBe(false)
    expect(state.calls.every(c => c.temperature === undefined)).toBe(true)
  })

  it('extracts the study fact sheet first, keeps only checked facts, stores it, and gives it to every section', async () => {
    state.pdf = await pdf(['Protocol MP-301 is a study of Moonazumab in adults with moderate asthma.'])
    state.factAnswer = JSON.stringify([
      { key: 'protocol_number', value: 'MP-301', source: 1, page: 1, quote: 'Protocol MP-301 is a study of Moonazumab' },
      { key: 'sample_size', value: '500', source: 1, page: 1, quote: 'A total of 500 participants' },
    ])
    const { updates, done } = run(2)
    await done
    expect(state.calls[0]!.prompt).toContain('Extract the key facts of THIS study')
    const stored = updates.find(u => u.factSheet)!.factSheet as { sourceIds: string[]; facts: Array<{ key: string; status: string; value: string }> }
    expect(stored.sourceIds).toEqual(['u1'])
    expect(stored.facts.find(f => f.key === 'protocol_number')).toMatchObject({ status: 'verified', value: 'MP-301' })
    expect(stored.facts.find(f => f.key === 'sample_size')).toMatchObject({ status: 'failed_check', value: '[TBD]' })
    expect(stored.facts.find(f => f.key === 'sponsor')).toMatchObject({ status: 'not_stated' })
    for (const n of ['3.1', '10.1', '1.1']) {
      expect(callFor(n).prompt).toContain('- Protocol number: MP-301 (Synopsis, p. 1)')
      expect(callFor(n).prompt).toContain('- Planned number of participants: [TBD]')
    }
    expect(callFor('3.1').prompt).not.toContain('500')
  })

  it('a stored fact sheet for the same sources is reused, not extracted again', async () => {
    const sheet = { extractedAt: '', model: 'm', sourceIds: ['u1'], facts: [{ key: 'phase', label: 'Trial phase', value: 'Phase 3', status: 'verified' }] }
    const { done } = run(2, { factSheet: sheet })
    await done
    expect(state.calls.some(c => c.prompt.includes('Extract the key facts'))).toBe(false)
    expect(callFor('3.1').prompt).toContain('- Trial phase: Phase 3')
  })

  it('long sources: each section gets its matching pages, and scanned pages go to every section', async () => {
    state.pdf = await pdf([
      'Inclusion criteria: adults aged 18 to 75 years with moderate asthma.',
      'Hypotheses and sample size: 1200 participants give 90 percent power.',
      '',
    ])
    const plan = { ...PLAN, sourcePages: { allBelowPages: 0, budgetChars: 10_000 } }
    const { done } = run(2, { plan })
    await done
    expect(callFor('5.1').titles).toEqual(['Synopsis (its pages 3, no text)', 'Synopsis (pages 1)'])
    expect(callFor('10.1').titles).toContain('Synopsis (pages 2)')
    expect(callFor('10.1').titles).not.toContain('Synopsis (pages 1)')
  })

  it('with a cost limit the draft pauses before the AI call that would pass it, and says why', async () => {
    state.pdf = await pdf(['Protocol MP-301 is a study of Moonazumab in adults with moderate asthma.'])
    state.factAnswer = JSON.stringify([{ key: 'protocol_number', value: 'MP-301', source: 1, page: 1, quote: 'Protocol MP-301 is a study of Moonazumab' }])
    const { written, updates, done } = run(2, { aiCostLimit: { usd: 0.0015, amount: 0.126, currency: 'INR', usdRate: 84 } })
    expect(await done).toMatchObject({ drafted: 0 })
    // The fact sheet call (0.00105 USD) ran; a second call like it would pass 0.0015, so no section was drafted.
    expect(state.calls).toHaveLength(1)
    expect(written).toEqual([])
    expect(updates.at(-1)).toEqual({ aiDraftState: 'paused' })
  })

  it('without a limit nothing is paused for cost', async () => {
    const { written, done } = run(2)
    await done
    expect(written).toHaveLength(50)
  })
})
