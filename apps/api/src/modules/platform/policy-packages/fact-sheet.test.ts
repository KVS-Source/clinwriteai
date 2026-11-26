// The study fact sheet (worker fact-sheet.ts) and relevant pages (worker source-pages.ts): facts are only used when
// code finds their quote in the evidence; each section of a long source set gets the pages that match it.

import { describe, expect, it } from 'vitest'
import { factSheetBlock, factSheetPrompt, parseFactAnswer, sameSources, verifyFacts, type IndexedSource } from '../../../../../worker/src/jobs/fact-sheet.js'
import { isContentsPage, pageBlocks, rankPages, scannedPages } from '../../../../../worker/src/jobs/source-pages.js'

const SYNOPSIS: IndexedSource = {
  no: 1, id: 'u1', title: 'Moon synopsis', example: false,
  pages: [
    'Protocol MP-301: A Phase 3, randomised, double-blind study of Moonazumab in adults with moderate asthma.',
    'Participants receive Moonazumab 10 mg/kg every 2 weeks. A total of 1,200 participants will be randomised\n2:1 to Moonazumab or placebo.',
    '',
  ],
}
const SAMPLE: IndexedSource = { no: 2, id: 'u2', title: 'Sample protocol', example: true, pages: ['Protocol XY-12 enrols 300 participants receiving Otherumab 5 mg.'] }
const FIELDS = [
  { key: 'protocol_number', label: 'Protocol number' },
  { key: 'dose_regimen', label: 'Dose and regimen' },
  { key: 'sample_size', label: 'Planned number of participants' },
  { key: 'randomisation', label: 'Randomisation' },
  { key: 'sponsor', label: 'Sponsor' },
]
const answer = (key: string, value: string, source: number | null, page: number | null, quote: string) => ({ key, value, source, page, quote })

describe('verifying the facts in code', () => {
  it('a fact is used only when its quote is in the evidence and holds its numbers', () => {
    const facts = verifyFacts(FIELDS, [
      answer('protocol_number', 'MP-301', 1, 1, 'Protocol MP-301: A Phase 3, randomised'),
      answer('dose_regimen', '10 mg/kg every 2 weeks', 1, 1, 'Participants receive Moonazumab 10 mg/kg every 2 weeks'),       // wrong page: found on page 2
      answer('sample_size', '1200', 1, 2, 'A total of 1,200 participants will be randomised'),                                 // 1,200 = 1200
      answer('randomisation', '2:1', 1, 2, 'will be randomised 2:1 to Moonazumab or placebo'),                                  // across a line break
      answer('sponsor', 'TBD', null, null, ''),
    ], [SYNOPSIS, SAMPLE])
    expect(facts.map(f => [f.key, f.status, f.value, f.source?.page ?? null])).toEqual([
      ['protocol_number', 'verified', 'MP-301', 1],
      ['dose_regimen', 'verified', '10 mg/kg every 2 weeks', 2],
      ['sample_size', 'verified', '1200', 2],
      ['randomisation', 'verified', '2:1', 2],
      ['sponsor', 'not_stated', '[TBD]', null],
    ])
  })

  it('an invented quote, a changed number, an example source or no source is [TBD] with the reason', () => {
    const facts = verifyFacts(FIELDS.slice(0, 4), [
      answer('protocol_number', 'MP-301', 1, 1, 'The protocol number is MP-301'),
      answer('dose_regimen', '20 mg/kg every 2 weeks', 1, 2, 'Participants receive Moonazumab 10 mg/kg every 2 weeks'),
      answer('sample_size', '300', 2, 1, 'Protocol XY-12 enrols 300 participants'),
      answer('randomisation', '2:1', null, null, 'randomised 2:1'),
    ], [SYNOPSIS, SAMPLE])
    expect(facts.map(f => [f.status, f.value, f.claimed, f.reason])).toEqual([
      ['failed_check', '[TBD]', 'MP-301', 'The quote was not found in the source.'],
      ['failed_check', '[TBD]', '20 mg/kg every 2 weeks', 'The number 20 in the value is not in the quote.'],
      ['failed_check', '[TBD]', '300', 'It was taken from an example source, which is never used for facts.'],
      ['failed_check', '[TBD]', '2:1', 'No source was named for it.'],
    ])
    expect(verifyFacts([FIELDS[0]!], [answer('protocol_number', 'MP-301', 1, 3, 'MP-301 appears here')], [SYNOPSIS])[0]!.reason)
      .toBe('Its page is a scan with no text, so the quote could not be checked.')
  })

  it('reads the answer even with text around it; a missing fact is not stated', () => {
    expect(parseFactAnswer('Here:\n[{"key":"phase","value":"Phase 3","source":1,"page":1,"quote":"A Phase 3"}] done')).toEqual([answer('phase', 'Phase 3', 1, 1, 'A Phase 3')])
    expect(parseFactAnswer('no json')).toEqual([])
    expect(verifyFacts([{ key: 'phase', label: 'Phase' }], [], [SYNOPSIS])[0]).toMatchObject({ status: 'not_stated', value: '[TBD]' })
  })

  it('the prompt marks examples; sections see checked values and [TBD] for the rest', () => {
    expect(factSheetPrompt(FIELDS, [SYNOPSIS, SAMPLE])).toContain('2. Sample protocol (EXAMPLE: never take facts from it)')
    const block = factSheetBlock({ extractedAt: '', model: 'm', sourceIds: ['u1'], facts: [
      { key: 'protocol_number', label: 'Protocol number', value: 'MP-301', status: 'verified', source: { id: 'u1', title: 'Moon synopsis', page: 1 } },
      { key: 'sponsor', label: 'Sponsor', value: '[TBD]', status: 'not_stated' },
      { key: 'dose', label: 'Dose', value: '[TBD]', status: 'failed_check', claimed: '20 mg' },
    ] })
    expect(block).toContain('- Protocol number: MP-301 (Moon synopsis, p. 1)')
    expect(block).toContain('- Sponsor: [TBD]')
    expect(block).toContain('- Dose: [TBD]')
    expect(block).not.toContain('20 mg')
  })

  it('a stored sheet is reused only for the same sources', () => {
    const sheet = { extractedAt: '', model: 'm', sourceIds: ['a', 'b'], facts: [] }
    expect(sameSources(sheet, ['b', 'a'])).toBe(true)
    expect(sameSources(sheet, ['a'])).toBe(false)
    expect(sameSources(null, ['a'])).toBe(false)
  })
})

describe('relevant pages per section', () => {
  const LONG: IndexedSource = {
    no: 1, id: 'u1', title: 'Protocol draft', example: false,
    pages: [
      'Inclusion criteria: adults aged 18 to 75 years with moderate asthma and a documented diagnosis.',
      'Exclusion criteria: current smokers, pregnancy, and participation in another clinical trial.',
      'Sample size: 1,200 participants give 90% power for the primary endpoint analysis.',
      'Statistical analysis: the primary endpoint is analysed with a mixed model for repeated measures.',
      '',
    ],
  }
  it('the pages that match the section come first, within the budget', () => {
    expect(rankPages([LONG], 'Inclusion Criteria', 10_000)).toEqual([{ no: 1, page: 1 }, { no: 1, page: 2 }])   // "criteria" also matches the exclusion page, ranked after
    expect(rankPages([LONG], 'Hypotheses and Sample Size statistical power', 10_000).map(r => r.page).slice(0, 2)).toEqual([3, 4])
    expect(rankPages([LONG], 'Hypotheses and Sample Size statistical power', 90).map(r => r.page)).toEqual([3])
    expect(rankPages([LONG], 'the and of', 10_000)).toEqual([])
  })
  it('a table of contents is never chosen; the page headed with the section title beats pages sharing its words', () => {
    const contents = Array.from({ length: 12 }, (_, i) => `${i + 1}.1 Inclusion Criteria and other things ........ ${i + 10}`).join('\n')
    expect(isContentsPage(contents)).toBe(true)
    expect(isContentsPage(LONG.pages[0]!)).toBe(false)
    const withContents: IndexedSource = { ...LONG, pages: [contents, ...LONG.pages] }
    expect(rankPages([withContents], 'Inclusion Criteria', 10_000)[0]).toEqual({ no: 1, page: 2 })
    const sharing: IndexedSource = { ...LONG, pages: ['Criteria for inclusion of laboratory values, criteria criteria inclusion.', 'Inclusion criteria: adults aged 18 to 75.'] }
    expect(rankPages([sharing], 'Inclusion Criteria', 10_000)[0]).toEqual({ no: 1, page: 2 })
  })

  it('a title word also finds what protocols call it instead', () => {
    const drug: IndexedSource = { ...LONG, pages: ['Study drug administration: 10 mg/kg intravenous dosing every 2 weeks.', 'Laboratory assessments at each visit.'] }
    expect(rankPages([drug], 'Trial Intervention', 10_000)).toEqual([{ no: 1, page: 1 }])
  })

  it('the chosen pages go as one block per source, in page order, under their page numbers; scans are listed', () => {
    const blocks = pageBlocks([LONG, { ...LONG, no: 2, id: 'u2', title: 'Sample', example: true }], [{ no: 1, page: 3 }, { no: 1, page: 1 }, { no: 2, page: 2 }])
    expect(blocks.map(b => b.title)).toEqual(['Protocol draft (pages 1, 3)', 'EXAMPLE ONLY, not this study: Sample (pages 2)'])
    expect(blocks[0]!.source.data).toBe(`[Page 1]\n${LONG.pages[0]}\n\n[Page 3]\n${LONG.pages[2]}`)
    expect(scannedPages(LONG)).toEqual([5])
  })
})
