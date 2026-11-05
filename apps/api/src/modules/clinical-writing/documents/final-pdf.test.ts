// The Final Document PDF: what the renderer draws (read back out of real PDF bytes), and the
// route's rules on who gets a copy, when it may go out as signed, and what's audited.

import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { extractTextFromBlob } from './extract-text.js'
import { htmlToBlocks } from './final-pdf-html.js'
import { DRAFT_WATERMARK, orderSections, renderFinalDocumentPdf, type FinalPdfInput } from './final-pdf-renderer.js'
import { documentsRoutes } from './routes.js'
import { hashSections } from './service.js'

process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E'

const textOf = async (pdf: Buffer) => (await extractTextFromBlob(pdf, 'application/pdf', { maxChars: 2_000_000 })).text
const occurrences = (text: string, needle: string) => text.split(needle).length - 1
const HASH = 'a'.repeat(64)

const compliance = {
  documentId: 'D', checklistTemplateVersion: 3, generatedAt: '2026-11-01T00:00:00Z',
  frameworks: [{
    name: 'ICH E3', version: 'R1', jurisdiction: 'ICH', description: null, sourceUrl: 'https://ich.example/e3', inRegistry: true,
    rules: [{ text: 'All sections present', mandatory: true, status: 'complete' }, { text: 'Style guide followed', mandatory: false, status: 'pending' }],
  }],
  waivedMandatory: [{ text: 'Synopsis waived', framework: 'ICH E3', waivedBy: 'Dr Rao', waivedAt: '2026-10-28T10:00:00Z', reason: 'Not applicable here' }],
  removedMandatory: [{ text: 'Old rule removed', framework: 'ICH E3', removedBy: 'Dr Lee', removedAt: null, reason: 'Superseded' }],
}
const SIGNATURES = [
  { id: 'SIG-0001-02', signerName: 'Sam Lee', signerRole: 'Approver', meaning: 'approved', step: 2, timestampUtc: '2026-10-28T15:47:00Z', authMethod: 'Password at signing', timeSource: 'Server clock (UTC)', versionAtSigning: 'v0.3' },
  { id: 'SIG-0001-01', signerName: 'Asha Rao', signerRole: 'Author', meaning: 'authored', step: 1, timestampUtc: '2026-10-28T14:01:00Z', authMethod: 'Password at signing', timeSource: 'Server clock (UTC)', versionAtSigning: 'v0.3' },
]

const input = (over: Partial<FinalPdfInput> = {}): FinalPdfInput => ({
  exportId: 'export-123',
  generatedAt: new Date('2026-11-05T09:30:00Z'),
  generatedBy: 'Alex Thornton',
  mode: 'signed',
  document: { id: 'DOC-1', title: 'Velora CSR', version: 'v1.0', statusLabel: 'signed', signedAt: '2026-10-28T15:47:00Z' },
  project: { shortTitle: 'VELORA-301', name: 'A study', therapeuticArea: 'Oncology', phase: 'Phase 3' },
  sections: [{ number: '§1', title: 'Introduction', contentHtml: '<p>Body text here.</p>' }],
  compliance,
  signatures: SIGNATURES,
  documentHash: HASH,
  ...over,
})

describe('renderFinalDocumentPdf', () => {
  it('makes a real PDF with the title page, contents, sections, appendix and signature page', async () => {
    const { pdf, pageCount } = await renderFinalDocumentPdf(input())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pageCount).toBeGreaterThanOrEqual(5)
    const text = await textOf(pdf)
    for (const part of ['Velora CSR', 'v1.0 · Final', '28 Oct 2026 15:47 UTC', 'Oncology', 'Phase 3', HASH, 'DOC-1', 'Alex Thornton', 'Contents', 'Body text here.', 'Appendix — Compliance Summary', 'Signature Page']) {
      expect(text).toContain(part)
    }
  })

  it('a signed copy has no watermark', async () => {
    const text = await textOf((await renderFinalDocumentPdf(input())).pdf)
    expect(text).not.toContain('NOT SIGNED')
    expect(text).toContain('Final · Signed')
  })

  it('a draft is watermarked on every page, says so, and carries no signatures', async () => {
    const { pdf, pageCount } = await renderFinalDocumentPdf(input({
      mode: 'draft', signatures: [], documentHash: null,
      document: { id: 'DOC-1', title: 'Velora CSR', version: 'v0.2', statusLabel: 'in review', signedAt: null },
    }))
    const text = await textOf(pdf)
    expect(occurrences(text, DRAFT_WATERMARK)).toBe(pageCount)
    expect(text).toContain('Draft · Not signed')
    expect(text).toContain('in review — not signed')
    expect(text).toContain('has not been signed')
    expect(text).not.toContain('v0.2 · Final')
    expect(text).not.toContain('electronically')
  })

  it('the export id and page numbers are on every page', async () => {
    const { pdf, pageCount } = await renderFinalDocumentPdf(input())
    const text = await textOf(pdf)
    expect(occurrences(text, 'Export export-123')).toBe(pageCount)
    for (let p = 1; p <= pageCount; p++) expect(text).toContain(`Page ${p} of ${pageCount}`)
  })

  it('the signature page lists each signature in order, with name, meaning, time and id', async () => {
    const text = await textOf((await renderFinalDocumentPdf(input())).pdf)
    for (const part of ['Asha Rao', 'Authored', 'SIG-0001-01', 'Sam Lee', 'Approved', 'SIG-0001-02', '§11.50', 'Password at signing', 'Server clock (UTC)', 'v0.3']) expect(text).toContain(part)
    expect(text.indexOf('Asha Rao')).toBeLessThan(text.indexOf('Sam Lee'))
    expect(text).toContain('current content matches this hash')
  })

  it('the appendix carries frameworks, rule outcomes, and waived and removed items with who and why', async () => {
    const text = await textOf((await renderFinalDocumentPdf(input())).pdf)
    for (const part of ['ICH E3', 'https://ich.example/e3', 'All sections present', 'Met', 'Style guide followed (recommended)', 'Not completed', 'Synopsis waived', 'Dr Rao', 'Not applicable here', 'Old rule removed', 'Dr Lee', 'Superseded']) {
      expect(text).toContain(part)
    }
  })

  it('says when there is nothing to report in the appendix', async () => {
    const text = await textOf((await renderFinalDocumentPdf(input({ compliance: { ...compliance, frameworks: [], waivedMandatory: [], removedMandatory: [] } }))).pdf)
    expect(text).toContain('No frameworks are recorded')
    expect(text).toContain('no Framework Mandatory item')
    expect(text).toContain('no Framework Mandatory checklist item was removed')
  })

  it('draws clinical symbols as they are, and reports nothing missing', async () => {
    const { pdf, undrawableCharacters } = await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'Results ≥ target', contentHtml: '<p>p ≤ 0.05; 11.2 ± 0.3 µg/mL; χ² test; α = β; 37 °C; “quoted” — dash</p>' }],
    }))
    expect(undrawableCharacters).toEqual([])
    const text = await textOf(pdf)
    // µ and Greek μ share one glyph in this font, so reading the file back can give either.
    expect(text).toMatch(/[µμ]g\/mL/)
    for (const part of ['≥ target', '≤ 0.05', '± 0.3', 'χ²', 'α = β', '37 °C', '“quoted” — dash']) expect(text).toContain(part)
  })

  it('never hides a character it cannot draw: it reports it and names it on the title page', async () => {
    const { pdf, undrawableCharacters } = await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'T', contentHtml: '<p>Check ✓ 日本</p>' }],
    }))
    expect(undrawableCharacters.sort()).toEqual(['✓', '日', '本'].sort())
    const text = await textOf(pdf)
    expect(text).toContain("can't be drawn in this PDF")
    expect(text).toContain('U+2713')
    expect(text).toContain('Check □ □□')
  })

  it('says nothing about undrawable characters when there are none', async () => {
    expect(await textOf((await renderFinalDocumentPdf(input())).pdf)).not.toContain("can't be drawn")
  })

  it('subscript digits are drawn as digits and not reported as missing', async () => {
    const { pdf, undrawableCharacters } = await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'T', contentHtml: '<p>C₀ and H₂O</p><table><tr><td>AUC₁₂</td></tr></table>' }],
    }))
    expect(undrawableCharacters).toEqual([])
    const text = await textOf(pdf)
    expect(text).toContain('AUC12')
    expect(text).not.toContain('□')
  })

  it('stored scripts never reach the file', async () => {
    const { pdf } = await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'T', contentHtml: '<p>Safe</p><script>alert("xss")</script><style>p{color:red}</style><a href="javascript:alert(1)">click</a>' }],
    }))
    const text = await textOf(pdf)
    expect(text).toContain('Safe')
    expect(text).toContain('click')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color:red')
    expect(pdf.includes('javascript:')).toBe(false)
  })

  it('a blank section says so', async () => {
    const text = await textOf((await renderFinalDocumentPdf(input({ sections: [{ number: '§1', title: 'T', contentHtml: '' }] }))).pdf)
    expect(text).toContain('No content recorded for this section.')
  })

  it('a long table keeps every row and repeats its header on each page', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => `<tr><td>Subject ${1000 + i}</td><td>Event ${i}</td></tr>`).join('')
    const { pdf, pageCount } = await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'T', contentHtml: `<table><thead><tr><th>Patient column</th><th>Event</th></tr></thead><tbody>${rows}</tbody></table><p>After the table.</p>` }],
    }))
    const text = await textOf(pdf)
    for (let i = 0; i < 150; i++) expect(text).toContain(`Subject ${1000 + i}`)
    expect(text).toContain('After the table.')
    expect(occurrences(text, 'Patient column')).toBeGreaterThanOrEqual(3)
    expect(pageCount).toBeGreaterThanOrEqual(6)
  })

  it('a very long cell loses no text', async () => {
    const words = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' ')
    const text = await textOf((await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'T', contentHtml: `<table><tr><td>${words}</td></tr></table><p>After.</p>` }],
    }))).pdf)
    expect(text).toContain('word0')
    expect(text).toContain('word1499')
    expect(text).toContain('After.')
  })

  it('a very long cell in a table with spans still loses no text', async () => {
    const words = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' ')
    const text = await textOf((await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'T', contentHtml: `<table><tr><th>Head</th><th>Other</th></tr><tr><td rowspan="2">Tall</td><td>${words}</td></tr><tr><td>Last</td></tr></table>` }],
    }))).pdf)
    for (const part of ['Tall', 'word0', 'word750', 'word1499', 'Last']) expect(text).toContain(part)
  })

  it('a merged row near the bottom of a page moves the table to the next page, whole', async () => {
    const filler = '<p>Filler line.</p>'.repeat(38)
    const table = '<table><tr><th>A</th><th>B</th></tr><tr><td rowspan="2">Merged</td><td>one</td></tr><tr><td>two</td></tr><tr><td>Plain</td><td>three</td></tr></table>'
    const text = await textOf((await renderFinalDocumentPdf(input({ sections: [{ number: '§1', title: 'T', contentHtml: filler + table }] }))).pdf)
    for (const part of ['Merged', 'one', 'two', 'Plain', 'three']) expect(text).toContain(part)
  })

  it('a table with merged rows too long for one page gives up the merging, not its text', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => (i % 2 === 0
      ? `<tr><td rowspan="2">Group ${i}</td><td>Row ${i}</td></tr>`
      : `<tr><td>Row ${i}</td></tr>`)).join('')
    const text = await textOf((await renderFinalDocumentPdf(input({ sections: [{ number: '§1', title: 'T', contentHtml: `<table><tr><th>Group head</th><th>Row head</th></tr>${rows}</table>` }] }))).pdf)
    for (let i = 0; i < 120; i++) {
      expect(text).toContain(`Row ${i}`)
      if (i % 2 === 0) expect(text).toContain(`Group ${i}`)
    }
    expect(occurrences(text, 'Group head')).toBeGreaterThanOrEqual(2)
  })

  it('a table inside a list keeps its text', async () => {
    const { pdf } = await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'T', contentHtml: '<ul><li><p>Item</p><table><tr><td>inner one</td><td>inner two</td><td>inner three</td></tr></table></li></ul><p>After list.</p>' }],
    }))
    const text = await textOf(pdf)
    for (const part of ['Item', 'inner one', 'inner two', 'inner three', 'After list.']) expect(text).toContain(part)
  })

  it('copes with uneven tables and merges that run past the last row', async () => {
    const text = await textOf((await renderFinalDocumentPdf(input({ sections: [{ number: '§1', title: 'T', contentHtml: '<table><tr><td>a</td></tr><tr><td>b</td><td>c</td><td>d</td></tr><tr><td rowspan="9">e</td><td colspan="9">f</td></tr></table>' }] }))).pdf)
    for (const part of ['a', 'b', 'c', 'd', 'e', 'f']) expect(text).toContain(part)
  })

  it('every cell of several long columns survives a split', async () => {
    const col = (p: string) => Array.from({ length: 1200 }, (_, i) => `${p}${i}`).join(' ')
    const text = await textOf((await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'T', contentHtml: `<table><tr><td>${col('a')}</td><td>short</td><td>${col('c')}</td></tr></table>` }],
    }))).pdf)
    for (const part of ['a0', 'a1199', 'short', 'c0', 'c1199']) expect(text).toContain(part)
  })

  it('the contents page gives the page each section starts on', async () => {
    const long = '<p>x</p>'.repeat(400)
    const text = await textOf((await renderFinalDocumentPdf(input({
      sections: [{ number: '§1', title: 'First', contentHtml: long }, { number: '§2', title: 'Second', contentHtml: '<p>y</p>' }],
    }))).pdf)
    const contents = text.slice(text.indexOf('Contents'), text.indexOf('Page 2 of'))
    expect(contents).toMatch(/§1\. First\s+3/)
    const second = Number(/§2\. Second\s+(\d+)/.exec(contents)?.[1])
    expect(second).toBeGreaterThan(3)
  })

  it('sections follow the screen order: front matter, then numeric', () => {
    const ordered = orderSections([{ number: '§10' }, { number: '§2' }, { number: 'ES' }, { number: '§11.4' }, { number: '§11.10' }])
    expect(ordered.map(s => s.number)).toEqual(['ES', '§2', '§10', '§11.4', '§11.10'])
  })
})

describe('htmlToBlocks', () => {
  it('reads headings, marks and line breaks', () => {
    expect(htmlToBlocks('<h3>Title</h3><p>a <strong>b</strong><br>c</p>')).toEqual([
      { kind: 'heading', level: 3, runs: [{ text: 'Title' }] },
      { kind: 'paragraph', runs: [{ text: 'a ' }, { text: 'b', bold: true }, { text: '\nc' }] },
    ])
  })

  it('reads nested lists and an ordered start', () => {
    const [list] = htmlToBlocks('<ol start="3"><li>One<ul><li>Sub</li></ul></li></ol>')
    expect(list).toMatchObject({ kind: 'list', ordered: true, start: 3 })
    expect((list as { items: unknown[][] }).items[0]).toMatchObject([{ kind: 'paragraph' }, { kind: 'list', ordered: false }])
  })

  it('reads tables: header cells, spans, a caption, and a cell that is all bold', () => {
    const [table] = htmlToBlocks('<table><caption>Cap</caption><thead><tr><th colspan="2">H</th></tr></thead><tbody><tr><td rowspan="2"><strong>A</strong></td><td>B <strong>c</strong></td></tr></tbody></table>')
    expect(table).toMatchObject({
      kind: 'table',
      caption: 'Cap',
      rows: [
        [{ text: 'H', header: true, bold: true, colSpan: 2 }],
        [{ text: 'A', bold: true, rowSpan: 2 }, { text: 'B c', bold: false }],
      ],
    })
  })

  it('collapses whitespace as a browser does', () => {
    expect(htmlToBlocks('<p>  a \n  b  </p>')).toEqual([{ kind: 'paragraph', runs: [{ text: 'a b' }] }])
  })

  it('wraps loose text, and handles empty and broken HTML', () => {
    expect(htmlToBlocks('loose <em>text</em>')).toMatchObject([{ kind: 'paragraph' }])
    expect(htmlToBlocks('')).toEqual([])
    expect(htmlToBlocks(null)).toEqual([])
    expect(htmlToBlocks('<p></p>')).toEqual([])
    expect(htmlToBlocks('<p>unclosed <strong>bold')).toMatchObject([{ kind: 'paragraph', runs: [{ text: 'unclosed ' }, { text: 'bold', bold: true }] }])
  })

  it('drops scripts, and links that are not ordinary links', () => {
    expect(htmlToBlocks('<script>x</script><p><a href="javascript:x">y</a> <a href="https://a.io">z</a></p>')).toEqual([
      { kind: 'paragraph', runs: [{ text: 'y ' }, { text: 'z', link: 'https://a.io', underline: true }] },
    ])
  })
})

// --- The route ---------------------------------------------------------------------

type Opts = {
  role?: AuthenticatedUser['role']
  letters?: string[]
  assignee?: boolean
  pmMember?: boolean
  status?: string
  chain?: boolean
  signedHash?: string
  auditFails?: boolean
}

const SECTIONS = [{ sectionId: 's1', sectionNumber: '§1', sectionTitle: 'Introduction', contentHtml: '<p>Body text here.</p>' }]
const CURRENT_HASH = hashSections(SECTIONS)

async function build(o: Opts = {}) {
  const me = 'u-me'
  const letters = o.letters ?? ['C']
  const status = o.status ?? 'signed'
  const doc = {
    id: 'DOC-1', projectId: 'p-1', type: 'csr_full', title: 'Velora CSR / Final', status, stage: 'final_output', deletedAt: null, signedAt: new Date('2026-10-28T15:47:00Z'),
    assigneeId: o.assignee ? me : 'someone-else', currentVersionId: 'v1',
    currentVersion: { id: 'v1', versionNumber: status === 'signed' ? 'v1.0' : 'v0.2', sections: SECTIONS },
  }
  const hash = o.signedHash ?? CURRENT_HASH
  const chainFind = vi.fn(async () => (o.chain === false ? null : {
    id: 'c-1', completedAt: new Date('2026-10-28T15:47:00Z'),
    records: SIGNATURES.map(s => ({ ...s, documentHash: hash, credentialHash: 'secret-credential-hash' })),
  }))
  const audit: Array<{ action: string; details: Record<string, unknown> }> = []
  const app = Fastify({ logger: false })
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => doc), count: vi.fn(async () => 1), findMany: vi.fn(async () => (letters.length > 0 || o.assignee ? [{ projectId: 'p-1' }] : [])) },
    documentRaci: {
      findFirst: vi.fn(async () => (letters.length > 0 ? { id: 'raci-1' } : null)),
      findMany: vi.fn(async () => letters.map(letter => ({ letter }))),
    },
    signatureChain: { findFirst: chainFind },
    project: { findUnique: vi.fn(async () => ({ shortTitle: 'VELORA-301', name: 'A study', therapeuticArea: 'Oncology', phase: 'Phase 3' })) },
    projectMember: { findMany: vi.fn(async () => (o.pmMember ? [{ projectId: 'p-1' }] : [])) },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn(async () => ({ name: 'Alex Thornton' })), findMany: vi.fn(async () => []) },
    checklistInstance: { findUnique: vi.fn(async () => ({ templateVersion: 1, items: [] })) },
    ichSectionWaiver: { findMany: vi.fn(async () => []) },
  } as never)
  app.decorate('audit', { append: vi.fn(async (e: { action: string; details: Record<string, unknown> }) => {
    if (o.auditFails) throw new Error('audit store down')
    audit.push(e)
    return {}
  }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: me, email: 'me@x', role: o.role ?? 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, audit, get: () => app.inject({ method: 'GET', url: '/documents/DOC-1/final/pdf' }) }
}

describe('GET /documents/:id/final/pdf', () => {
  it('sends a signed copy as a download that is not cached', async () => {
    const res = await (await build()).get()
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('Velora_CSR_Final_v1.0_Final.pdf')
    expect(res.headers['cache-control']).toContain('no-store')
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    const text = await textOf(res.rawPayload)
    expect(text).toContain('Final · Signed')
    expect(text).toContain('Asha Rao')
    expect(text).toContain('Alex Thornton')
    expect(text).toContain(CURRENT_HASH)
    expect(res.rawPayload.includes('secret-credential-hash')).toBe(false)
  })

  it('audits the export with the hash of the very file sent, and its id is on the file', async () => {
    const t = await build()
    const res = await t.get()
    const entry = t.audit.find(e => e.action === 'final_document_exported')!
    expect(entry.details).toMatchObject({
      mode: 'signed', format: 'pdf', versionNumber: 'v1.0', documentHash: CURRENT_HASH, watermarked: false,
      pdfSha256: createHash('sha256').update(res.rawPayload).digest('hex'),
      pdfBytes: res.rawPayload.length,
      exportId: res.headers['x-export-id'],
      undrawableCharacters: [],
    })
    expect(entry.details.pages).toBeGreaterThanOrEqual(5)
    expect(await textOf(res.rawPayload)).toContain(`Export ${String(res.headers['x-export-id'])}`)
  })

  it('each export is its own record', async () => {
    const t = await build()
    const [a, b] = [await t.get(), await t.get()]
    expect(a.headers['x-export-id']).not.toBe(b.headers['x-export-id'])
    expect(t.audit.filter(e => e.action === 'final_document_exported')).toHaveLength(2)
  })

  it('sends no file if the export cannot be audited', async () => {
    const res = await (await build({ auditFails: true })).get()
    expect(res.statusCode).toBe(500)
    expect(res.headers['content-type']).not.toBe('application/pdf')
  })

  it.each(['not_started', 'in_authoring', 'in_review', 'crm_in_progress', 'pending_signature'])('a %s document comes out as a watermarked draft', async (status) => {
    const t = await build({ status })
    const res = await t.get()
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('_v0.2_DRAFT.pdf')
    const text = await textOf(res.rawPayload)
    expect(text).toContain(DRAFT_WATERMARK)
    expect(text).not.toContain('Asha Rao')
    expect(t.audit.find(e => e.action === 'final_document_exported')?.details).toMatchObject({ mode: 'draft', watermarked: true, documentHash: null })
  })

  it('refuses to export as signed with no completed signature chain', async () => {
    const t = await build({ chain: false })
    const res = await t.get()
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('signature_records_missing')
    expect(t.audit.some(e => e.action === 'final_document_exported')).toBe(false)
  })

  it('refuses to export as signed when the content no longer matches what was signed, and records the attempt', async () => {
    const t = await build({ signedHash: 'b'.repeat(64) })
    const res = await t.get()
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('signed_content_changed')
    expect(t.audit.some(e => e.action === 'final_document_exported')).toBe(false)
    expect(t.audit.find(e => e.action === 'final_document_export_refused')?.details).toMatchObject({
      reason: 'signed_content_changed', currentHash: CURRENT_HASH, signedHashes: ['b'.repeat(64)],
    })
  })

  it.each([
    ['the author (R)', { letters: ['R'] }],
    ['a reviewer (C)', { letters: ['C'] }],
    ['an approver (A)', { letters: ['A'] }],
    ['someone informed (I)', { letters: ['I'] }],
    ['the assignee', { letters: [], assignee: true }],
    ['an auditor', { role: 'auditor' as const, letters: [] }],
    ['a PM on the project', { role: 'pm' as const, letters: [], pmMember: true }],
  ])('%s gets a copy', async (_l, o) => {
    expect((await (await build(o)).get()).statusCode).toBe(200)
  })

  it.each([
    ['a tenant admin', { role: 'tenant-admin' as const }],
    ['a guest', { role: 'guest' as const, letters: ['I'] }],
    ['QC (Q) alone', { letters: ['Q'] }],
    ['a PM not on the project', { role: 'pm' as const, letters: [] }],
    ['someone with no part in it', { letters: [] }],
  ])('%s is refused, and nothing is exported', async (_l, o) => {
    const t = await build(o)
    const res = await t.get()
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('final_document_forbidden')
    expect(t.audit).toEqual([])
  })
})
