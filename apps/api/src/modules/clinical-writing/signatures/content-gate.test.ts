import { describe, expect, it } from 'vitest'
import { checkSignableContent, contentBlockedBody } from './content-gate.js'
import { ICH_E3_SECTIONS } from '../ich-e3/catalog.js'

const text = '<p>Real section text.</p>'
const fullCsr = () => ICH_E3_SECTIONS.map(d => ({ sectionId: d.sectionId, contentHtml: text }))

describe('checkSignableContent — a full CSR', () => {
  it('passes when all 18 mandatory sections have text and no markers', () => {
    expect(checkSignableContent({ documentType: 'csr_full', sections: fullCsr() })).toEqual({ ok: true, problems: [] })
    expect(checkSignableContent({ documentType: 'csr-full', sections: fullCsr() }).ok).toBe(true)
  })

  it('names every empty or missing mandatory section (the "Test e sign" case: 17 of 18 empty)', () => {
    const sections = fullCsr().map((s, i) => (i === 0 ? s : { ...s, contentHtml: '<p></p>' }))
    const r = checkSignableContent({ documentType: 'csr-full', sections })
    expect(r.ok).toBe(false)
    expect(r.problems).toHaveLength(17)
    expect(r.problems[0]).toEqual({ section: '§2 Synopsis', reason: 'empty' })
    expect(checkSignableContent({ documentType: 'csr_full', sections: [] }).problems).toHaveLength(18)
  })

  it('refuses drafting markers left in a section', () => {
    const sections = fullCsr().map(s => (s.sectionId === 's5' ? { ...s, contentHtml: '<p>Approved by [TBD] on [XX]</p>' } : s))
    expect(checkSignableContent({ documentType: 'csr_full', sections }).problems).toEqual([{ section: '§5 Ethics', reason: 'placeholders', placeholders: 2 }])
  })

  it('lets a waived section stay empty, and ignores the US-only §16.4', () => {
    const sections = fullCsr().filter(s => s.sectionId !== 's3')
    expect(checkSignableContent({ documentType: 'csr_full', sections, waivedCodes: ['§3'] }).ok).toBe(true)
    expect(checkSignableContent({ documentType: 'csr_full', sections }).problems).toEqual([{ section: '§3 Table of Contents', reason: 'empty' }])
  })

  it('accepts subsections standing in for a section (§11 written as s11_4)', () => {
    const sections = fullCsr().map(s => (s.sectionId === 's11' ? { sectionId: 's11_4', contentHtml: text } : s))
    expect(checkSignableContent({ documentType: 'csr_full', sections }).ok).toBe(true)
  })
})

describe('checkSignableContent — any other document type', () => {
  it('every section the document has needs text and no markers', () => {
    const sections = [
      { sectionId: 'p1', sectionNumber: '1', sectionTitle: 'Background', contentHtml: text },
      { sectionId: 'p2', sectionNumber: '2', sectionTitle: 'Objectives', contentHtml: '' },
      { sectionId: 'p3', sectionNumber: '3', sectionTitle: 'Design', contentHtml: '<p>[INSERT design]</p>' },
    ]
    expect(checkSignableContent({ documentType: 'protocol', sections }).problems).toEqual([
      { section: '2 Objectives', reason: 'empty' },
      { section: '3 Design', reason: 'placeholders', placeholders: 1 },
    ])
    expect(checkSignableContent({ documentType: 'protocol', sections: [sections[0]!] }).ok).toBe(true)
  })
})

describe('contentBlockedBody', () => {
  it('says how many and which sections, shortening a long list', () => {
    const problems = Array.from({ length: 8 }, (_, i) => ({ section: `§${i + 1} X`, reason: 'empty' as const }))
    const body = contentBlockedBody({ ok: false, problems })
    expect(body).toMatchObject({ error: 'content_incomplete', problemCount: 8 })
    expect(body.message).toContain('8 sections are empty or have placeholders left')
    expect(body.message).toContain('and 3 more')
    expect(contentBlockedBody({ ok: false, problems: [{ section: '§1 X', reason: 'placeholders', placeholders: 1 }] }).message)
      .toContain('1 section is empty or has placeholders left. §1 X (1 placeholder left).')
  })
})
