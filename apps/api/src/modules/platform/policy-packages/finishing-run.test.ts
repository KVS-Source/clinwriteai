// Finishing on a real document's data (worker finishing-run.ts): the plan of the document's policy version decides
// what runs; sections are rewritten with resolved markers, flagged, recorded in the edit history; References built.

import { readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { finishSafely, runFinishing } from '../../../../../worker/src/jobs/finishing-run.js'

const PLAN = JSON.parse(readFileSync(new URL('../../../../../../policy-packages/protocol-build-plan/build-plan.json', import.meta.url), 'utf8')) as Record<string, unknown>
const state = vi.hoisted(() => ({ pdf: Buffer.alloc(0) }))
vi.mock('../../../../../worker/src/blob-reader.js', async (original) => ({
  ...(await original<object>()), createBlobReaderFromEnv: () => ({ read: async () => ({ bytes: state.pdf, contentType: 'application/pdf' }) }),
}))

async function pdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const page = doc.addPage()
    lines.forEach((l, i) => page.drawText(l, { x: 20, y: 700 - i * 14, size: 9, font }))
  }
  return Buffer.from(await doc.save())
}

function setup(opts: { plan?: unknown; referenceStyle?: string } = {}) {
  const sections = [
    { id: 's1_3', number: '1.3', title: 'Schedule of Activities' },
    { id: 's2_1', number: '2.1', title: 'Background' },
    { id: 's7_2', number: '7.2', title: 'Safety Assessments' },
    { id: 's12', number: '12', title: 'References' },
  ]
  const rows = new Map([
    ['s1_3', '<p>Visits.</p>'],
    ['s2_1', '<p>Phase 2 results [REF: Smith 2021 | 1 | 1] and [REF: Brown 2019 | 1 | 1].</p>'],
    ['s7_2', '<p>See [XREF: 1.3] for timing.</p>'],
    ['s12', ''],
  ])
  const updates: Array<{ id: string; data: Record<string, unknown> }> = []
  const history: string[] = []
  const prisma = {
    document: { findUnique: vi.fn(async () => ({ policyVersionAtCreate: 2, factSheet: null })) },
    documentTypePolicy: { findUnique: vi.fn(async () => ({ buildPlan: opts.plan ?? PLAN, referenceStyle: opts.referenceStyle ?? 'numbered' })) },
    documentTemplate: { findFirst: vi.fn(async () => ({ sections })) },
    sectionContent: {
      findMany: vi.fn(async () => [...rows].map(([sectionId, contentHtml]) => ({ id: `row-${sectionId}`, sectionId, contentHtml, aiFlags: sectionId === 's2_1' ? ['ai:coherence_issue'] : [] }))),
      update: vi.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => { updates.push({ id: a.where.id, data: a.data }); return {} }),
    },
    editHistory: { create: vi.fn(async (a: { data: { sectionId: string } }) => { history.push(a.data.sectionId); return {} }) },
    documentSource: { findMany: vi.fn(async () => [{ uploadId: 'u1', role: 'evidence' }]) },
    documentUpload: { findMany: vi.fn(async () => [{ id: 'u1', title: 'IB', fileName: 'ib.pdf', blobKey: 'k', contentType: 'application/pdf' }]) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  }
  const steps: string[] = []
  const run = () => runFinishing(
    { prisma: prisma as never, log: { info() {}, warn() {}, error() {} } as never },
    { documentId: 'd', versionId: 'v', docType: 'protocol', actorId: 'u', steps: { emit: async (_k, m) => { steps.push(m) } } },
  )
  return { run, updates, history, steps }
}

describe('finishing a drafted document', () => {
  it('resolves markers, builds References from the evidence, flags what it could not, and records the edits', async () => {
    state.pdf = await pdf([['Results were positive.', 'REFERENCES', '1. Smith J, Patel R. Moonazumab phase 2. Lancet. 2021;9:321.']])
    const { run, updates, history, steps } = setup()
    const report = await run()
    const data = (id: string) => updates.find(u => u.id === `row-${id}`)!.data
    expect(data('s2_1')).toMatchObject({
      contentHtml: '<p>Phase 2 results [1] and [TBD: reference for “Brown 2019” — not found in the evidence].</p>',
      ichStatus: 'in_progress',
      aiFlags: ['ai:coherence_issue', 'invented_citation'],
    })
    expect(data('s7_2')).toMatchObject({ contentHtml: '<p>See Section 1.3 for timing.</p>', ichStatus: 'complete' })
    expect(data('s12').contentHtml).toBe('<ol><li>Smith J, Patel R. Moonazumab phase 2. Lancet. 2021;9:321.</li></ol>')
    expect(history.sort()).toEqual(['s12', 's2_1', 's7_2'])
    expect(report).toMatchObject({ crossReferences: { resolved: 1 }, references: { cited: 2, listed: 1 } })
    expect(steps[0]).toMatch(/Finished by code: 1 cross-reference resolved, 1 reference listed from 2 citations/)
    expect(steps[0]).toMatch(/1 reference\(s\) not found in the evidence/)
  })

  it('author-year style from the policy', async () => {
    state.pdf = await pdf([['REFERENCES', '1. Smith J, Patel R. Moonazumab phase 2. Lancet. 2021;9:321.']])
    const { run, updates } = setup({ referenceStyle: 'author_year' })
    await run()
    expect(updates.find(u => u.id === 'row-s2_1')!.data.contentHtml).toMatch(/^<p>Phase 2 results \(Smith 2021\) and/)
  })

  it('a plan without finishing changes nothing', async () => {
    const { finishing: _f, ...plan } = PLAN
    const { run, updates } = setup({ plan })
    expect(await run()).toBeNull()
    expect(updates).toEqual([])
  })

  it('a failure never stops the draft: it is logged and shown in AI Debug, the document stays as drafted', async () => {
    const steps: string[] = []
    const prisma = { document: { findUnique: vi.fn(async () => { throw new Error('database unavailable') }) } }
    await expect(finishSafely(
      { prisma: prisma as never, log: { info() {}, warn() {}, error() {} } as never },
      { documentId: 'd', versionId: 'v', docType: 'protocol', actorId: 'u', steps: { emit: async (_k, m) => { steps.push(m) } } },
    )).resolves.toBeUndefined()
    expect(steps).toEqual(['Finishing by code failed (database unavailable). Cross-references and references are left as markers.'])
  })
})
