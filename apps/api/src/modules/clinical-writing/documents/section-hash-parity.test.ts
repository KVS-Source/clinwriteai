// The restore worker hashes the merged sections itself. Its hash must equal the one the API computes for the
// same content, or a restored version's stored hash would disagree with the app's. The worker file is imported
// directly so the two cannot drift apart unnoticed.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashSections as apiHash } from './service.js'
import { hashSections as workerHash, inDocumentOrder } from '../../../../../worker/src/jobs/section-hash.js'

const SECTIONS = [
  { sectionId: 's10', contentHtml: '<p>ten</p>' },
  { sectionId: 's2',  contentHtml: '<p>two <b>bold</b></p>' },
  { sectionId: 's1',  contentHtml: '' },
  { sectionId: 's3_1', contentHtml: '<ul><li>a</li></ul>' },
]

describe('restore worker hash', () => {
  it('equals the API hash for the same sections, whatever order they are given in', () => {
    expect(workerHash(SECTIONS)).toBe(apiHash(SECTIONS))
    expect(workerHash([...SECTIONS].reverse())).toBe(apiHash(SECTIONS))
  })

  it('changes when a section changes, including only its formatting', () => {
    const edited = SECTIONS.map(s => (s.sectionId === 's2' ? { ...s, contentHtml: '<p>two bold</p>' } : s))
    expect(workerHash(edited)).not.toBe(workerHash(SECTIONS))
  })

  it('is not the old separator-less hash (which disagreed with the API)', () => {
    const h = createHash('sha256')
    for (const s of [...SECTIONS].sort((a, b) => a.sectionId.localeCompare(b.sectionId))) { h.update(s.sectionId, 'utf8'); h.update(s.contentHtml, 'utf8') }
    expect(workerHash(SECTIONS)).not.toBe(h.digest('hex'))
  })
})

describe('inDocumentOrder', () => {
  it('puts s2 before s10, and s3 before s3_1 before s3_10', () => {
    const order = inDocumentOrder([{ sectionId: 's10' }, { sectionId: 's3_10' }, { sectionId: 's2' }, { sectionId: 's3_1' }, { sectionId: 's1' }, { sectionId: 's3' }])
    expect(order.map(s => s.sectionId)).toEqual(['s1', 's2', 's3', 's3_1', 's3_10', 's10'])
  })

  it('does not change the array it is given', () => {
    const input = [{ sectionId: 's10' }, { sectionId: 's2' }]
    inDocumentOrder(input)
    expect(input.map(s => s.sectionId)).toEqual(['s10', 's2'])
  })
})
