// The checks a source file goes through before a document is drafted from it: at upload (can the AI read it, the
// study it names, does it look like a sample) and at New Document (evidence vs example, missing or conflicting files).

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { checkSources, fileCheckOf, type CheckedSource } from './source-check.js'
import { parseClassificationResponse } from './source-classifier.js'
import { inspectSource, type SourceInspection } from './source-inspect.js'
import { buildSourceBlocks } from '../../../../../worker/src/jobs/source-blocks.js'
import { EXAMPLE_SOURCES_RULE, readSourceText, sourceKind } from '../../../../../worker/src/jobs/source-files.js'
import JSZip from 'jszip'

/** A minimal .docx: a heading, a paragraph and a table whose first row has a cell spanning two columns. */
async function docx(): Promise<Buffer> {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const cell = (text: string, span = 1) => `<w:tc>${span > 1 ? `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>` : ''}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Study Treatments</w:t></w:r></w:p>
    <w:p><w:r><w:t>Participants receive Moonazumab or placebo.</w:t></w:r></w:p>
    <w:tbl><w:tr>${cell('Dosing', 2)}</w:tr><w:tr>${cell('Arm A')}${cell('10 mg/kg every 2 weeks')}</w:tr><w:tr>${cell('Arm B')}${cell('Placebo')}</w:tr></w:tbl>
  </w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

const readable = (over: Partial<SourceInspection> = {}): SourceInspection => ({
  sha256: Math.random().toString(36), kind: 'pdf', pages: 10, scannedPages: 0, chars: 5000, usable: true, problem: null, ...over,
})
const file = (id: string, over: Partial<CheckedSource> = {}): CheckedSource => ({
  id, title: id, category: 'protocol', version: null, role: 'evidence', inspection: readable(),
  looksLikeExample: false, exampleReason: null, study: null, ...over,
})
const codes = (r: ReturnType<typeof checkSources>) => r.issues.map(i => `${i.severity}:${i.code}`)

async function pdf(pages: Array<string>): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) doc.addPage().drawText(text, { x: 20, y: 700, size: 10, font })
  return Buffer.from(await doc.save())
}

describe('inspectSource: can the AI read the file', () => {
  it('a text PDF is fine; scanned pages are counted and said', async () => {
    const ok = await inspectSource(await pdf(['A page of protocol text that is long enough.']), 'p.pdf', 'application/pdf')
    expect(ok).toMatchObject({ kind: 'pdf', pages: 1, scannedPages: 0, usable: true, problem: null })
    expect(ok.sha256).toMatch(/^[0-9a-f]{64}$/)
    const mixed = await inspectSource(await pdf(['A page of protocol text that is long enough.', '']), 'p.pdf', 'application/pdf')
    expect(mixed).toMatchObject({ pages: 2, scannedPages: 1, usable: true })
    expect(mixed.problem).toMatch(/1 of 2 pages have no text/)
  })
  it('a damaged PDF, an empty text file and an unsupported type cannot be used, and say why', async () => {
    expect(await inspectSource(Buffer.from('not a pdf'), 'p.pdf', 'application/pdf')).toMatchObject({ usable: false, problem: expect.stringMatching(/could not be opened/) })
    expect(await inspectSource(Buffer.from('  '), 'notes.txt', 'text/plain')).toMatchObject({ kind: 'text', usable: false })
    expect(await inspectSource(Buffer.from('x'), 'deck.pptx', '')).toMatchObject({ kind: 'other', usable: false, problem: expect.stringMatching(/PowerPoint/) })
    expect(await inspectSource(Buffer.from('x'), 'old.doc', 'application/msword')).toMatchObject({ usable: false, problem: expect.stringMatching(/\.doc/) })
  })
  it('a plain-text file with content is fine; the worker sorts files the same way', async () => {
    expect(await inspectSource(Buffer.from('Study synopsis: a randomised trial of drug X.'), 'syn.txt', 'text/plain')).toMatchObject({ kind: 'text', usable: true })
    for (const [name, type, kind] of [['a.pdf', 'application/pdf', 'pdf'], ['a.docx', '', 'word'], ['a.csv', 'text/csv', 'text'], ['a.xlsx', '', 'other']] as const) {
      expect(sourceKind(name, type)).toBe(kind)
    }
  })
})

describe('the upload-time classifier also reads the study and spots samples', () => {
  it('reads the study details and the example flag', () => {
    const r = parseClassificationResponse(JSON.stringify({
      category: 'protocol', categoryConfidence: 90, version: null, versionConfidence: 0, reason: 'r',
      protocolNumber: 'MP-301', drug: 'Moonazumab', sponsor: 'null', isExample: true, exampleReason: 'Has [insert drug] placeholders.',
    }))
    expect(r).toMatchObject({ study: { protocolNumber: 'MP-301', drug: 'Moonazumab', sponsor: null }, looksLikeExample: true, exampleReason: 'Has [insert drug] placeholders.' })
  })
  it('an older answer without them means: not stated, not an example', () => {
    expect(parseClassificationResponse(JSON.stringify({ category: 'ib' }))).toMatchObject({
      study: { protocolNumber: null, drug: null, sponsor: null }, looksLikeExample: false, exampleReason: null,
    })
  })
  it('the source list shows the checks, and nothing for a file uploaded before them', () => {
    expect(fileCheckOf({ sourceCategory: 'ib' })).toBeNull()
    expect(fileCheckOf({ inspection: readable({ usable: false, problem: 'p' }), looksLikeExample: true, exampleReason: 'e', duplicateOf: { id: 'u9', title: 'T' } }))
      .toMatchObject({ usable: false, problem: 'p', looksLikeExample: true, exampleReason: 'e', duplicateOf: { id: 'u9', title: 'T' } })
  })
})

describe('checkSources: the New Document source check', () => {
  it('a study protocol and IB as evidence, plus a sample as an example, passes cleanly', () => {
    const r = checkSources('protocol', [file('syn'), file('ib', { category: 'ib' }), file('sample', { role: 'example', looksLikeExample: true })])
    expect(r).toEqual({ ok: true, issues: [] })
  })
  it('blocks a file the AI cannot read, and sources with no evidence', () => {
    const r = checkSources('protocol', [file('deck', { role: 'example', inspection: readable({ usable: false, problem: 'PowerPoint.' }) })])
    expect(r.ok).toBe(false)
    expect(codes(r)).toEqual(['block:unreadable', 'block:no_evidence'])
    expect(r.issues[0]!.message).toMatch(/“deck” can’t be read by the AI: PowerPoint\./)
  })
  it('no sources at all is not this check’s business (the policy decides)', () => {
    expect(checkSources('protocol', [])).toEqual({ ok: true, issues: [] })
  })
  it('warns about a sample marked as evidence, and evidence naming different studies or drugs', () => {
    const r = checkSources('protocol', [
      file('ours', { study: { protocolNumber: 'MP-301', drug: 'Moonazumab', sponsor: null } }),
      file('theirs', { category: 'ib', looksLikeExample: true, exampleReason: 'A template.', study: { protocolNumber: 'XY 12', drug: 'Otherumab', sponsor: null } }),
      file('ours-ib', { category: 'ib', study: { protocolNumber: 'mp301', drug: null, sponsor: null } }),
    ])
    expect(r.ok).toBe(true)
    expect(codes(r)).toEqual(['warn:looks_like_example', 'warn:different_studies', 'warn:different_studies', 'warn:several_versions'])
    expect(r.issues[1]!.message).toContain('MP-301 in “ours”, “ours-ib”; XY 12 in “theirs”')
  })
  it('warns about two versions of one document, the same file twice, and scanned pages', () => {
    const same = readable({ sha256: 'abc' })
    const r = checkSources('protocol', [
      file('p1', { version: 'v1', inspection: same }), file('p2', { version: 'v2', inspection: { ...same } }),
      file('ib', { category: 'ib', inspection: readable({ scannedPages: 3, problem: '3 of 10 pages have no text.' }) }),
    ])
    expect(codes(r)).toEqual(['warn:several_versions', 'warn:duplicate', 'warn:scanned_pages'])
    expect(r.issues[0]!.message).toContain('“p1” (v1), “p2” (v2)')
  })
  it('a protocol without a protocol input or an IB says which sections will be [TBD]', () => {
    expect(codes(checkSources('protocol', [file('lab', { category: 'lab_data' })]))).toEqual(['warn:missing_protocol_input', 'warn:missing_ib'])
    expect(codes(checkSources('csr_full', [file('lab', { category: 'lab_data' })]))).toEqual([])
  })
})

describe('a Word source reaches the drafter with its structure', () => {
  it('tables keep their rows, columns and merged cells; headings and paragraphs stay apart', async () => {
    const html = await readSourceText(await docx(), 'word')
    expect(html).toContain('<h1>Study Treatments</h1>')
    expect(html).toContain('<p>Participants receive Moonazumab or placebo.</p>')
    expect(html).toContain('<tr><td colspan="2">Dosing</td></tr>')
    expect(html).toContain('<tr><td>Arm A</td><td>10 mg/kg every 2 weeks</td></tr>')
    expect(html).not.toMatch(/\bid=|\bclass=|<img/)
  })
  it('a Word file without text is unreadable; plain text goes as it is', async () => {
    const zip = await JSZip.loadAsync(await docx())
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>')
    await expect(readSourceText(await zip.generateAsync({ type: 'nodebuffer' }), 'word')).rejects.toThrow(/no readable text/)
    expect(await readSourceText(Buffer.from('Visit 1: screening, day -28 to -1.'), 'text')).toBe('Visit 1: screening, day -28 to -1.')
  })
})

describe('the drafter is told which sources are examples', () => {
  it('an example is titled as one on the file itself; a Word or text source goes as text', async () => {
    const r = await buildSourceBlocks([
      { title: 'Study synopsis', bytes: Buffer.alloc(0), text: 'Synopsis text.' },
      { title: 'Sample protocol', bytes: Buffer.alloc(0), text: 'Sample text.', example: true },
    ], 'claude-sonnet-4-6')
    expect(r.blocks.map(b => [b.title, b.source.type])).toEqual([
      ['Study synopsis', 'text'], ['EXAMPLE ONLY, not this study: Sample protocol', 'text'],
    ])
    expect(EXAMPLE_SOURCES_RULE).toMatch(/Never take a fact from an EXAMPLE source/)
  })
})
