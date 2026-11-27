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

  it('a sub-heading the AI numbered inside a section resolves; one that is not there is still broken', () => {
    const r = finishDocument(base([
      S('s10_4', '10.4', 'Secondary and Exploratory Analyses', '<h3>10.4.1 Approach</h3><p>x</p><h3>10.4.3 Secondary Efficacy Analyses</h3><p>y</p>'),
      S('s10_1', '10.1', 'Hypotheses', '<p>See [XREF: 10.4.3] and [XREF: Section 10.4.3.] but not [XREF: 10.4.9] or [XREF: 6.2.3].</p>'),
      REFS,
    ]))
    expect(r.html.get('s10_1')).toBe('<p>See Section 10.4.3 and Section 10.4.3 but not [TBD: cross-reference to “10.4.9”] or [TBD: cross-reference to “6.2.3”].</p>')
    expect(r.report.crossReferences).toEqual({ resolved: 2, broken: [{ section: '10.1', target: '10.4.9' }, { section: '10.1', target: '6.2.3' }] })
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

  it('[REF: TBD …] is a TBD to fill, not a citation, and is not flagged', () => {
    const r = finishDocument(base([
      S('s4_4', '4.4', 'Scientific Rationale', '<p>Placebo is standard [REF: TBD: reference needed].</p>'),
      REFS,
    ]))
    expect(r.html.get('s4_4')).toBe('<p>Placebo is standard [TBD: reference needed].</p>')
    expect(r.flags.get('s4_4')).toBeUndefined()
    expect(r.report.references).toMatchObject({ cited: 0, listed: 0, notFound: [] })
  })

  it('the entry is found even when the cited page or source is wrong', () => {
    expect(findReference([IB], 'Smith 2021', 1, 1)).toMatch(/^Smith J, Patel R/)
    expect(findReference([IB], 'Smith 2021', null, null)).toMatch(/Lancet Respir Med\. 2021/)
    expect(findReference([IB], 'Smith 2019', 1, 2)).toBeNull()
  })

  it('[REF: source | N] resolves to the attached source title (direct source citation)', () => {
    // [REF: source | 1] — attached source #1 is the IB
    expect(findReference([IB, SAMPLE], 'source', 1, null)).toBe('Investigator’s Brochure')
    // Example sources (SAMPLE is example=true) cannot be cited directly
    expect(findReference([IB, SAMPLE], 'source', 2, null)).toBeNull()
    // Unknown source number
    expect(findReference([IB], 'source', 9, null)).toBeNull()
    // "source" without a sourceNo is not resolvable
    expect(findReference([IB], 'source', null, null)).toBeNull()
  })

  it('direct source citations populate the References section alongside literature citations', () => {
    const r = finishDocument(base([
      S('s2_1', '2.1', 'Background',
        '<p>From the IB directly [REF: source | 1]. Literature in the IB [REF: Smith 2021 | 1 | 2].</p>'),
      REFS,
    ]))
    // Both citations get numbered; direct-source first (first use order).
    // (IB is in the standard glossary, so its first use is spelled out too.)
    expect(r.html.get('s2_1')).toBe('<p>From the Investigator’s Brochure (IB) directly [1]. Literature in the IB [2].</p>')
    expect(r.html.get('s12')).toContain('Investigator’s Brochure')
    expect(r.html.get('s12')).toContain('Smith J, Patel R')
    expect(r.report.references).toMatchObject({ cited: 2, listed: 2, notFound: [] })
  })

  it('direct source citation pointing at an example source is flagged as invented', () => {
    // SAMPLE is example=true (source #2). Citing it directly must fail
    // the same way citing from memory would.
    const r = finishDocument(base([
      S('s2_1', '2.1', 'Background', '<p>From the example [REF: source | 2].</p>'),
      REFS,
    ]))
    expect(r.flags.get('s2_1')).toEqual(['invented_citation'])
    expect(r.html.get('s12')).toBe('<p>No references are cited in this document.</p>')
  })
})

describe('abbreviations', () => {
  it('an abbreviation never spelled out is flagged where it is used; headings in capitals are not abbreviations', () => {
    const r = finishDocument(base([
      // BICR and MMRM are not in the standard glossary.
      S('s8_1', '8.1', 'AE and BICR Definitions', '<p>An adverse event (AE) is any untoward event. A BICR is independent.</p><h4>REPORTING TIMELINES AND PROCEDURES</h4>'),
      S('s8_2', '8.2', 'AE/BICR Collection', '<p>AEs and BICRs are collected; MMRM is used.</p>'),
      REFS,
    ]))
    expect(r.report.abbreviations.undefined).toEqual([
      { acronym: 'BICR', sections: ['8.1', '8.2'] },
      { acronym: 'MMRM', sections: ['8.2'] },
    ])
    expect(r.report.abbreviations.defined).toBe(1)
    expect(r.flags.get('s8_2')).toEqual(['undefined_acronym'])
  })

  it('one in the standard glossary is spelled out at its first use; common ones, trial names, regulation citations and placeholders are left alone', () => {
    const r = finishDocument(base([
      S('s2_1', '2.1', 'Background', '<h3>RECIST Assessment</h3><p>In the CASPIAN trial, the US FDA approved it. Tumours are assessed (per RECIST 1.1) and RECIST again. SAEs are reported.</p>'),
      S('s4_2', '4.2', 'Population', '<p>Performance status (ECOG PS) of 0 or 1. Records follow 21 CFR Part 11 [TBD: IND number].</p>'),
      REFS,
    ]))
    expect(r.html.get('s2_1')).toBe('<h3>RECIST Assessment</h3><p>In the CASPIAN trial, the US FDA approved it. Tumours are assessed '
      + '(per Response Evaluation Criteria in Solid Tumors (RECIST) 1.1) and RECIST again. Serious adverse events (SAEs) are reported.</p>')
    expect(r.html.has('s4_2')).toBe(false)                   // "(ECOG PS)" already follows its words: left as written
    expect(r.report.abbreviations.fromGlossary).toEqual(['RECIST', 'SAE', 'ECOG', 'PS'])
    expect(r.report.abbreviations.undefined).toEqual([])
    expect(r.flags.size).toBe(0)
  })

  it('the drafter is told to spell abbreviations out and which need no full form', () => {
    const told = markerInstructions({ abbreviations: true }, [])
    expect(told).toContain('spell out every abbreviation the first time')
    expect(told).toContain('US, USA, UK, EU, FDA')
    expect(markerInstructions({ references: true }, [])).not.toContain('ABBREVIATIONS')
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

  it('a number per arm or group is a share of the total, not a different sample size', () => {
    const factSheet = { extractedAt: '', model: 'm', sourceIds: [], facts: [
      { key: 'sample_size', label: 'Planned number of participants', value: 'Approximately 600 participants', status: 'verified' as const },
    ] }
    const r = finishDocument(base([
      S('s10_1', '10.1', 'Sample Size', '<p>Approximately 600 participants will be randomized 1:1, giving approximately 300 participants per arm. '
        + 'Up to 300 participants in each treatment group are expected.</p>'),
      S('s4_1', '4.1', 'Overall Design', '<p>Approximately 500 participants will be enrolled.</p>'),
      REFS,
    ], { factSheet }))
    expect(r.report.mismatches.map(m => m.section)).toEqual(['4.1'])
  })
})

describe('what the drafter is told', () => {
  it('the markers and the outline, only for what the plan finishes', () => {
    const outline = [{ number: '1.3', title: 'Schedule of Activities' }]
    expect(markerInstructions({ crossReferences: true, references: true }, outline)).toContain('[XREF: <section number>]')
    expect(markerInstructions({ crossReferences: true }, outline)).toContain('1.3 Schedule of Activities')
    expect(markerInstructions({ references: true }, outline)).not.toContain('XREF')
    expect(markerInstructions({}, outline)).toBe('')
    // The references block now covers BOTH direct-source and literature citations.
    const refBlock = markerInstructions({ references: true }, outline)
    expect(refBlock).toContain('[REF: source | <source number>]')
    expect(refBlock).toContain('Smith 2021 | 2 | 45')
  })
})
