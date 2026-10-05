import { describe, expect, it } from 'vitest'
import { hashSections } from './service.js'

describe('hashSections', () => {
  it('is deterministic given the same inputs', () => {
    const sections = [
      { sectionId: '1.1', contentHtml: '<p>a</p>' },
      { sectionId: '2.2', contentHtml: '<p>b</p>' },
    ]
    expect(hashSections(sections)).toBe(hashSections(sections))
  })

  it('is insensitive to section ordering (sort by sectionId)', () => {
    const forward = [
      { sectionId: '1.1', contentHtml: 'a' },
      { sectionId: '2.2', contentHtml: 'b' },
    ]
    const reversed = [...forward].reverse()
    expect(hashSections(forward)).toBe(hashSections(reversed))
  })

  it('changes when any section content changes', () => {
    const base = [{ sectionId: '1.1', contentHtml: 'a' }]
    const modified = [{ sectionId: '1.1', contentHtml: 'b' }]
    expect(hashSections(base)).not.toBe(hashSections(modified))
  })

  it('distinguishes between differently labelled sections with same content', () => {
    const a = [{ sectionId: '1.1', contentHtml: 'same' }]
    const b = [{ sectionId: '1.2', contentHtml: 'same' }]
    expect(hashSections(a)).not.toBe(hashSections(b))
  })

  it('empty section set is a stable hash', () => {
    expect(hashSections([])).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSections([])).toBe(hashSections([]))
  })
})
