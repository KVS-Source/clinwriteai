import { describe, expect, it } from 'vitest'
import { buildIchE3Report, ICH_E3_MANDATORY_COUNT, isIchE3Applicable } from './catalog.js'

const sec = (sectionId: string, contentHtml: string | null, ichStatus = 'in_progress') => ({ sectionId, contentHtml, ichStatus })
const waiver = (sectionCode: string, extra: Partial<{ waivedByName: string | null }> = {}) => ({
  sectionCode, waivedBy: 'u-1', waivedAt: new Date('2026-10-30T10:00:00Z'), reason: 'Not a US submission', versionAtWaiver: 'v0.2', ...extra,
})
const row = (r: ReturnType<typeof buildIchE3Report>, code: string) => r.sections.find(s => s.code === code)

describe('isIchE3Applicable', () => {
  it.each(['csr_full', 'csr-full'])('applies to %s', t => expect(isIchE3Applicable(t)).toBe(true))
  it.each(['csr_synopsis', 'protocol', 'icf', 'ib', 'dsur'])('does not apply to %s', t => expect(isIchE3Applicable(t)).toBe(false))
})

describe('buildIchE3Report', () => {
  it('has 18 mandatory sections', () => {
    expect(ICH_E3_MANDATORY_COUNT).toBe(18)
    const r = buildIchE3Report({ sections: [], waivers: [] })
    expect(r.sections).toHaveLength(18)
    expect(r.totalSections).toBe(18)
  })

  it('returns no rows for a document ICH E3 does not govern', () => {
    const r = buildIchE3Report({ applicable: false, documentTitle: 'ICF', sections: [sec('s1', '<p>x</p>', 'complete')], waivers: [] })
    expect(r).toMatchObject({ applicable: false, documentTitle: 'ICF', completionPercent: 0, sections: [] })
  })

  it('computes complete / in progress / not started from content and the stored flag', () => {
    const r = buildIchE3Report({ sections: [sec('s1', '<p>a</p>', 'complete'), sec('s2', '<p>b</p>'), sec('s3', '<p></p>')], waivers: [] })
    expect(row(r, '§1')?.status).toBe('complete')
    expect(row(r, '§2')?.status).toBe('in_progress')
    expect(row(r, '§3')?.status).toBe('not_started')
  })

  it('flags a section marked complete whose content was emptied as a warning', () => {
    const r = buildIchE3Report({ sections: [sec('s5', '  ', 'complete')], waivers: [] })
    expect(row(r, '§5')?.status).toBe('warning')
    expect(r.completeCount).toBe(0)
  })

  it('reports whether each section exists in the document', () => {
    const r = buildIchE3Report({ sections: [sec('s1', null), sec('s11_4', '<p>x</p>')], waivers: [] })
    expect(row(r, '§1')?.inDocument).toBe(true)
    expect(row(r, '§11')?.inDocument).toBe(true)   // matched via subsection
    expect(row(r, '§11')?.sectionId).toBe('s11_4') // opens the section that exists
    expect(row(r, '§15')?.inDocument).toBe(false)
    expect(row(r, '§15')?.sectionId).toBe('s15')
  })

  it('counts complete and waived separately, and both toward the percentage', () => {
    const r = buildIchE3Report({ sections: [sec('s1', '<p>a</p>', 'complete')], waivers: [waiver('§15')] })
    expect(r).toMatchObject({ completeCount: 1, waivedCount: 1, completeSections: 2, completionPercent: Math.round(2 / 18 * 100) })
  })

  it('carries the waiver actor name', () => {
    const r = buildIchE3Report({ sections: [], waivers: [waiver('§15', { waivedByName: 'Dr A Rao' })] })
    expect(row(r, '§15')?.waiver).toMatchObject({ waivedBy: 'u-1', waivedByName: 'Dr A Rao', reason: 'Not a US submission' })
  })

  describe('content flags and §16.4 requirement', () => {
    it('reports hasContent and wordCount per section', () => {
      const r = buildIchE3Report({ sections: [sec('s7', '<p>Four words in here</p>'), sec('s8', '<p></p>')], waivers: [] })
      expect(row(r, '§7')).toMatchObject({ hasContent: true, wordCount: 4 })
      expect(row(r, '§8')).toMatchObject({ hasContent: false, wordCount: 0 })
      expect(row(r, '§9')).toMatchObject({ hasContent: false, wordCount: 0, inDocument: false })
    })

    it('flags a waived section that has content', () => {
      const r = buildIchE3Report({ sections: [sec('s7', '<p>written</p>')], waivers: [waiver('§7')] })
      expect(row(r, '§7')).toMatchObject({ status: 'waived', hasContent: true })
    })

    it('marks §16.4 required for a US submission and lists it before the section exists', () => {
      const r = buildIchE3Report({ submissionCountries: ['US', 'IN'], sections: [], waivers: [] })
      expect(row(r, '§16.4')).toMatchObject({ requirement: 'required', inDocument: false, conditional: true })
      expect(r.totalSections).toBe(ICH_E3_MANDATORY_COUNT)
    })

    it('marks §16.4 not required without a US country, and stays hidden when absent', () => {
      expect(row(buildIchE3Report({ submissionCountries: ['EU'], sections: [], waivers: [] }), '§16.4')).toBeUndefined()
      const r = buildIchE3Report({ submissionCountries: ['EU'], sections: [sec('s16_4', '<p>x</p>')], waivers: [] })
      expect(row(r, '§16.4')?.requirement).toBe('not-required')
    })

    it('leaves requirement unset when the countries are unknown', () => {
      const r = buildIchE3Report({ sections: [sec('s16_4', '<p>x</p>')], waivers: [] })
      expect(row(r, '§16.4')?.requirement).toBeUndefined()
    })
  })

  describe('progress (status-icon tooltip)', () => {
    const words = (n: number) => `<p>${Array.from({ length: n }, () => 'word').join(' ')}</p>`
    const numbered = (sectionId: string, sectionNumber: string, contentHtml: string, ichStatus = 'in_progress') =>
      ({ ...sec(sectionId, contentHtml, ichStatus), sectionNumber })

    it('scores 4 checks for a section without subsections — word count is not one of them', () => {
      const r = buildIchE3Report({ sections: [sec('s7', words(5))], waivers: [] })
      expect(row(r, '§7')?.progress).toMatchObject({ wordCount: 5, minWords: 20, placeholders: 0, markedComplete: false, checksDone: 3, checksTotal: 4 })
      expect(row(r, '§7')?.progress.subsections).toBeUndefined()
      expect(row(r, '§7')?.progress.checks.map(c => c.key)).toEqual(['has_content', 'no_placeholders', 'no_open_comments', 'marked_complete'])
    })

    it('passes every check for a short, marked-complete section (e.g. a title page)', () => {
      const r = buildIchE3Report({ sections: [sec('s1', words(4), 'complete')], waivers: [] })
      expect(row(r, '§1')?.progress).toMatchObject({ checksDone: 4, checksTotal: 4 })
    })

    it('leaves the placeholder check out for an empty or missing section', () => {
      const r = buildIchE3Report({ sections: [sec('s8', '<p></p>')], waivers: [] })
      expect(row(r, '§8')?.progress).toMatchObject({ wordCount: 0, checksDone: 1, checksTotal: 3 })   // only "no open comments"
      expect(row(r, '§9')?.progress).toMatchObject({ checksDone: 1, checksTotal: 3 })
      expect(row(r, '§9')?.progress.checks.map(c => c.key)).not.toContain('no_placeholders')
    })

    it.each([
      ['<p>Results [TBD] pending</p>', 1],
      ['<p>HR [XX] (95% CI [X]–[XX])</p>', 3],
      ['<p>See [INSERT Table 14.2.1] and [ref]</p>', 2],
      ['<ol><li>[STUB_claude-opus-4-7] Would respond to a prompt of length 207.71</li></ol>', 1],
      ['<p>[ PLACEHOLDER ] and [TBC]</p>', 2],
      ['<p>Reported in [1] and Table 14.2.1 [Section 9.4]</p>', 0],
    ])('counts placeholders in %s', (html, count) => {
      const r = buildIchE3Report({ sections: [sec('s7', html)], waivers: [] })
      expect(row(r, '§7')?.progress.placeholders).toBe(count)
      expect(row(r, '§7')?.progress.checks.find(c => c.key === 'no_placeholders')?.passed).toBe(count === 0)
    })

    it('counts subsections across the whole section, even though status reads only the first row', () => {
      const r = buildIchE3Report({
        sections: [numbered('s11', '§11', words(30), 'complete'), numbered('s11_1', '§11.1', words(30), 'complete'), numbered('s11_4', '§11.4', words(3))],
        waivers: [],
      })
      expect(row(r, '§11')?.status).toBe('complete')
      expect(row(r, '§11')?.progress).toMatchObject({ subsections: { total: 2, completed: 1 }, checksTotal: 5, checksDone: 4 })
      expect(row(r, '§1')?.progress.subsections).toBeUndefined()   // s11* rows are not §1 subsections
    })

    it('does not count an approve verdict as an open comment', () => {
      const r = buildIchE3Report({
        sections: [numbered('s7', '§7', words(30))],
        waivers: [],
        openComments: [{ sectionRef: '§7', verdict: 'approve' }, { sectionRef: '§7', verdict: 'request_changes' }, { sectionRef: '§7', verdict: null }],
      })
      expect(row(r, '§7')?.progress.openComments).toBe(2)
    })

    it('counts open comments and source references on the section and its subsections', () => {
      const r = buildIchE3Report({
        sections: [numbered('s11', '§11', words(30)), numbered('s11_4', '§11.4', words(30))],
        waivers: [],
        openComments: [{ sectionRef: '§11.4' }, { sectionRef: '§ 11' }, { sectionRef: '§1' }],
        sourceReferences: [{ sectionId: 's11_4' }, { sectionId: 's2' }],
      })
      expect(row(r, '§11')?.progress).toMatchObject({ openComments: 2, sourceReferences: 1 })
      expect(row(r, '§11')?.progress.checks.find(c => c.key === 'no_open_comments')?.passed).toBe(false)
    })

    it('does not change status or the completion percent', () => {
      const r = buildIchE3Report({ sections: [numbered('s7', '§7', words(3), 'complete')], waivers: [], openComments: [{ sectionRef: '§7' }] })
      expect(row(r, '§7')?.progress).toMatchObject({ openComments: 1, checksDone: 3, checksTotal: 4 })
      expect(row(r, '§7')?.status).toBe('complete')
      expect(r.completeCount).toBe(1)
    })
  })

  describe('§16.4 (conditional, US only)', () => {
    it('is hidden when the document has no §16.4 section and no waiver', () => {
      expect(row(buildIchE3Report({ sections: [], waivers: [] }), '§16.4')).toBeUndefined()
    })

    it('is listed when the document has an §16.4 section, without changing the totals', () => {
      const r = buildIchE3Report({ sections: [sec('s16_4', '<p>x</p>', 'complete')], waivers: [] })
      expect(row(r, '§16.4')).toMatchObject({ conditional: true, status: 'complete', inDocument: true })
      expect(r).toMatchObject({ totalSections: 18, completeCount: 0, completionPercent: 0 })
    })

    it('shows as waived when waived, without counting toward completion', () => {
      const r = buildIchE3Report({ sections: [sec('s16_4', '<p>x</p>')], waivers: [waiver('§16.4')] })
      expect(row(r, '§16.4')?.status).toBe('waived')
      expect(r.waivedCount).toBe(0)
    })
  })
})
