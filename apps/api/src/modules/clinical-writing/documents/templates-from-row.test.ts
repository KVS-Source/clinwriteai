// A template row's sections become a new document's sections. Only a section that opts in with `seedContent: true`
// starts with the template's own content (the protocol's front pages, which are forms to fill in); every other
// section starts empty, to be written or drafted following its plain-language rules.

import { describe, expect, it } from 'vitest'
import { templateSectionsFromRow } from './templates.js'

describe('templateSectionsFromRow', () => {
  const rows = [
    { id: 'fm-1', number: 'i', title: 'Title page', seedContent: true, defaultContentHtml: '<p>CLINICAL STUDY PROTOCOL</p><table><tbody><tr><td><p>x</p></td></tr></tbody></table>' },
    { id: 'm11-1', number: '1', title: 'Protocol Summary', defaultContentHtml: '<p>AUTHORING INSTRUCTIONS | Provide a concise synopsis.</p>', formatRules: 'Heading 1.' },
    { id: 'old-1', number: '2', title: 'A section of an older template' },
    { id: 'm11-2', number: '3', title: 'US only', usOnly: true },
  ]

  it('seeds only the sections that opt in, and leaves every other section empty', () => {
    const out = templateSectionsFromRow(rows, [])
    expect(out.map(s => s.sectionId)).toEqual(['fm-1', 'm11-1', 'old-1'])
    expect(out[0]!.contentHtml).toContain('CLINICAL STUDY PROTOCOL')
    expect(out[0]!.contentHtml).toContain('<table>')
    expect(out[1]!.contentHtml).toBe('')      // its default text is guidance, not document content
    expect(out[2]!.contentHtml).toBe('')
    expect(out.every(s => s.ichStatus === 'not_started')).toBe(true)
  })

  it('does not seed when seedContent is set but there is no content to seed', () => {
    const out = templateSectionsFromRow([{ id: 'a', number: '1', title: 'A', seedContent: true }, { id: 'b', number: '2', title: 'B', seedContent: true, defaultContentHtml: 42 }], [])
    expect(out.map(s => s.contentHtml)).toEqual(['', ''])
  })

  it('keeps the US-only section for a US submission', () => {
    expect(templateSectionsFromRow(rows, ['US']).map(s => s.sectionId)).toContain('m11-2')
  })

  it('returns nothing for a malformed list', () => {
    expect(templateSectionsFromRow({ not: 'an array' })).toEqual([])
    expect(templateSectionsFromRow([{ id: 1 }, null, 'x'])).toEqual([])
  })
})
