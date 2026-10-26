import { describe, expect, it } from 'vitest'
import { templateSections } from './templates.js'

describe('templateSections', () => {
  it('seeds the ICH E3 CSR skeleton for csr-full', () => {
    const s = templateSections('csr-full')
    expect(s[0]).toMatchObject({ sectionId: 's1', sectionNumber: '§1', sectionTitle: 'Title Page', contentHtml: '', ichStatus: 'not_started' })
    expect(s.map(x => x.sectionId)).toContain('s11_4')
  })

  it('includes §16.4 only when the project submits to the US (FR-A-003)', () => {
    expect(templateSections('csr-full', ['EU']).some(x => x.sectionId === 's16_4')).toBe(false)
    expect(templateSections('csr-full', ['EU', 'us']).some(x => x.sectionId === 's16_4')).toBe(true)
  })

  it('accepts snake_case types and leaves unknown types empty', () => {
    expect(templateSections('csr_synopsis')).toHaveLength(17)
    expect(templateSections('protocol_amendment')).toHaveLength(7)
    expect(templateSections('not-a-type')).toEqual([])
  })

  // Every type the New Document form offers must open with sections — a document
  // created with none can't be edited at all.
  it.each([
    'csr-full', 'csr-synopsis', 'protocol', 'protocol-amendment', 'ib', 'icf',
    'safety-narrative', 'dsur', 'end-of-study-summary', 'patient-narrative',
  ])('gives %s a starter skeleton with unique section ids', (type) => {
    const s = templateSections(type)
    expect(s.length).toBeGreaterThan(0)
    expect(new Set(s.map(x => x.sectionId)).size).toBe(s.length)
    for (const x of s) expect(x).toMatchObject({ contentHtml: '', ichStatus: 'not_started' })
  })

  it('uses the ICH E2F structure for a DSUR', () => {
    const s = templateSections('dsur')
    expect(s).toHaveLength(22)
    expect(s[0]).toMatchObject({ sectionId: 'd_es', sectionTitle: 'Executive Summary' })
  })
})

describe('compareSections', () => {
  it('orders sections numerically, unnumbered first', async () => {
    const { compareSections } = await import('./service.js')
    const nums = ['§10', '§2', 'TOC', '§11.4', '§1', '§16.1', '§11', 'ES', '§20']
    const sorted = nums.map((n, i) => ({ sectionNumber: n, sectionId: `k${i}` })).sort(compareSections).map(s => s.sectionNumber)
    expect(sorted).toEqual(['TOC', 'ES', '§1', '§2', '§10', '§11', '§11.4', '§16.1', '§20'])
  })
})
