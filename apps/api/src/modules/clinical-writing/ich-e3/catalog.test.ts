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
