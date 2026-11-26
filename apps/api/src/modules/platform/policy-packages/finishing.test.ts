// Finishing in code (worker finishing.ts): cross-references, references from the evidence, abbreviations and fact
// consistency are resolved or checked by code after drafting, never left to the AI.

import { describe, expect, it } from 'vitest'
import { findReference, finishDocument, markerInstructions, type FinishInput } from '../../../../../worker/src/jobs/finishing.js'
import type { IndexedSource } from '../../../../../worker/src/jobs/fact-sheet.js'

const IB: IndexedSource = {
  no: 1, id: 'u1', title: 'Investigator’s Brochure', example: false,
  pages: [
    'Moonazumab reduced exacerbations in phase 2 (Smith et al. 2021).',
    'REFERENCES\n12. Smith J, Patel R, Chen L. Moonazumab in moderate asthma: a phase 2 trial.\nLancet Respir Med. 2021;9(4):321-30.\n13. Global Initiative for Asthma. GINA report 2023.\n',
  ],
}
const SAMPLE: IndexedSource = { no: 2, id: 'u2', title: 'Sample protocol', example: true, pages: ['1. Jones A. Otherumab in COPD. N Engl J Med. 2019;380:1-10.'] }

const base = (sections: FinishInput['sections'], over: Partial<FinishInput> = {}): FinishInput => ({
  sections, sources: [IB, SAMPLE], referenceStyle: 'numbered', factSheet: null,
  builtByCode: [{ number: '12', kind: 'references' }],
  options: { crossReferences: true, references: true, abbreviations: true, factConsistency: true },
  ...over,
})
const S = (id: string, number: string, title: string, html: string) => ({ id, number, title, html })
const REFS = S('s12', '12', 'References', '')

describe('cross-references', () => {
  it('a section number or title becomes "Section n"; anything else is [TBD] and flagged', () => {
    const r = finishDocument(base([
      S('s1_3', '1.3', 'Schedule of Activities', '<p>x</p>'),
      S('s7_2', '7.2', 'Safety Assessments', '<p>Visits are in [XREF: 1.3]; see [XREF: Schedule of Activities] and [XREF: 14.2].</p>'),
      REFS,
    ]))
    expect(r.html.get('s7_2')).toBe('<p>Visits are in Section 1.3; see Section 1.3 and [TBD: cross-reference to “14.2”].</p>')
    expect(r.flags.get('s7_2')).toEqual(['dropped_cross_ref'])
    expect(r.report.crossReferences).toEqual({ resolved: 2, broken: [{ section: '7.2', target: '14.2' }] })
  })
})

describe('references', () => {
  it('found in the evidence, numbered by first use, listed in the References section', () => {
    const r = finishDocument(base([
      S('s2_1', '2.1', 'Background', '<p>Asthma guidance [REF: GINA 2023 | 1 | 2]. Phase 2 results [REF: Smith 2021 | 1 | 2].</p>'),
      S('s2_3', '2.3', 'Benefit–Risk Assessment', '<p>Reduced exacerbations [REF: Smith et al. 2021 | 1 | 2].</p>'),
      REFS,
    ]))
    expect(r.html.get('s2_1')).toBe('<p>Asthma guidance [1]. Phase 2 results [2].</p>')
    expect(r.html.get('s2_3')).toBe('<p>Reduced exacerbations [2].</p>')
    expect(r.html.get('s12')).toBe('<ol><li>Global Initiative for Asthma. GINA report 2023.</li><li>Smith J, Patel R, Chen L. Moonazumab in moderate asthma: a phase 2 trial. Lancet Respir Med. 2021;9(4):321-30.</li></ol>')
    expect(r.report.references).toMatchObject({ cited: 3, listed: 2, notFound: [] })
  })

  it('author-year style, listed alphabetically', () => {
    const r = finishDocument(base([
      S('s2_1', '2.1', 'Background', '<p>Results [REF: Smith 2021 | 1 | 2] and guidance [REF: GINA 2023 | 1 | 2].</p>'),
      REFS,
    ], { referenceStyle: 'author_year' }))
    expect(r.html.get('s2_1')).toBe('<p>Results (Smith 2021) and guidance (GINA 2023).</p>')
    expect(r.html.get('s12')).toMatch(/^<ul><li>Global Initiative.*<\/li><li>Smith J.*<\/li><\/ul>$/)
  })

  it('a reference not in the evidence, or only in an example source, is [TBD] and flagged', () => {
    const r = finishDocument(base([
      S('s2_1', '2.1', 'Background', '<p>Claim [REF: Brown 2020 | 1 | 2]. Other [REF: Jones 2019 | 2 | 1].</p>'),
      REFS,
    ]))
    expect(r.html.get('s2_1')).toBe('<p>Claim [TBD: reference for “Brown 2020” — not found in the evidence]. Other [TBD: reference for “Jones 2019” — not found in the evidence].</p>')
    expect(r.flags.get('s2_1')).toEqual(['invented_citation'])
    expect(r.html.get('s12')).toBe('<p>No references are cited in this document.</p>')
  })

  it('the entry is found even when the cited page or source is wrong', () => {
    expect(findReference([IB], 'Smith 2021', 1, 1)).toMatch(/^Smith J, Patel R/)
    expect(findReference([IB], 'Smith 2021', null, null)).toMatch(/Lancet Respir Med\. 2021/)
    expect(findReference([IB], 'Smith 2019', 1, 2)).toBeNull()
  })
})

describe('abbreviations', () => {
  it('an abbreviation never spelled out is flagged where it is used; headings in capitals are not abbreviations', () => {
    const r = finishDocument(base([
      S('s8_1', '8.1', 'AE and SAE Definitions', '<p>An adverse event (AE) is any untoward event. An SAE is serious.</p><h4>REPORTING TIMELINES AND PROCEDURES</h4>'),
      S('s8_2', '8.2', 'AE/SAE Collection', '<p>AEs and SAEs are collected; IDMC reviews them.</p>'),
      REFS,
    ]))
    expect(r.report.abbreviations.undefined).toEqual([
      { acronym: 'SAE', sections: ['8.1', '8.2'] },
      { acronym: 'IDMC', sections: ['8.2'] },
    ])
    expect(r.report.abbreviations.defined).toBe(1)
    expect(r.flags.get('s8_2')).toEqual(['undefined_acronym'])
  })

  it('an abbreviations section, when the template has one, is written from the definitions', () => {
    const r = finishDocument(base([
      S('s0', '0', 'List of Abbreviations', ''),
      S('s8_1', '8.1', 'Definitions', '<p>Patients with an adverse event (AE) or a serious adverse event (SAE).</p>'),
    ], { builtByCode: [{ number: '0', kind: 'abbreviations' }] }))
    expect(r.html.get('s0')).toBe('<table><thead><tr><th>Abbreviation</th><th>Definition</th></tr></thead><tbody><tr><td>AE</td><td>adverse event</td></tr><tr><td>SAE</td><td>serious adverse event</td></tr></tbody></table>')
  })
})

describe('fact consistency', () => {
  it('a sample size or protocol number different from the fact sheet is flagged', () => {
    const factSheet = { extractedAt: '', model: 'm', sourceIds: [], facts: [
      { key: 'sample_size', label: 'Planned number of participants', value: '1,200 participants', status: 'verified' as const },
      { key: 'protocol_number', label: 'Protocol number', value: 'MP-301', status: 'verified' as const },
    ] }
    const r = finishDocument(base([
      S('s10_1', '10.1', 'Sample Size', '<p>A total of 1,200 participants will be randomised.</p>'),
      S('s5_3', '5.3', 'Recruitment', '<p>Approximately 1000 participants will be enrolled under protocol MP-310.</p>'),
      S('s1_1', '1.1', 'Synopsis', '<p>Protocol MP-301 will randomise approximately 1200 patients.</p>'),
      REFS,
    ], { factSheet }))
    expect(r.report.mismatches).toEqual([
      { section: '5.3', fact: 'Planned number of participants', expected: '1,200 participants', found: 'Approximately 1000 participants' },
      { section: '5.3', fact: 'Protocol number', expected: 'MP-301', found: 'MP-310' },
    ])
    expect([...r.flags.keys()]).toEqual(['s5_3'])
  })
})

describe('what the drafter is told', () => {
  it('the markers and the outline, only for what the plan finishes', () => {
    const outline = [{ number: '1.3', title: 'Schedule of Activities' }]
    expect(markerInstructions({ crossReferences: true, references: true }, outline)).toContain('[XREF: <section number>]')
    expect(markerInstructions({ crossReferences: true }, outline)).toContain('1.3 Schedule of Activities')
    expect(markerInstructions({ references: true }, outline)).not.toContain('XREF')
    expect(markerInstructions({}, outline)).toBe('')
  })
})
