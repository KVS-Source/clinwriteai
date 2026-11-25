// The drafter's hidden "sources-used" comment (worker: jobs/source-usage.ts): read, validated, and never saved.

import { describe, expect, it } from 'vitest'
import { extractSourceUsage, sourceUsageInstruction } from '../../../../../worker/src/jobs/source-usage.js'

describe('extractSourceUsage', () => {
  it('returns only the named sources and removes the comment', () => {
    expect(extractSourceUsage('<!-- sources-used: 2, 5 -->\n<p>Text</p>', 10)).toEqual({ html: '<p>Text</p>', used: [1, 4] })
  })
  it('"none" is an empty list; no comment at all is unknown', () => {
    expect(extractSourceUsage('<!-- sources-used: none -->\n<p>[TBD: x]</p>', 10)).toEqual({ html: '<p>[TBD: x]</p>', used: [] })
    expect(extractSourceUsage('<p>Text</p>', 10)).toEqual({ html: '<p>Text</p>', used: null })
  })
  it('ignores numbers that were not attached, and repeats', () => {
    expect(extractSourceUsage('<!--sources-used: 3, 3, 1, 0, 99-->', 3).used).toEqual([0, 2])
    expect(extractSourceUsage('<!-- sources-used: 99 --><p>x</p>', 3)).toEqual({ html: '<p>x</p>', used: null })
  })
  it('an unreadable value is unknown, and still never reaches the document', () => {
    expect(extractSourceUsage('<!-- sources-used: the protocol --><p>x</p>', 3)).toEqual({ html: '<p>x</p>', used: null })
  })
  it('finds it wherever the model put it', () => {
    expect(extractSourceUsage('<p>x</p>\n<!-- Sources-Used: 1 -->', 2)).toEqual({ html: '<p>x</p>', used: [0] })
  })
  it('keeps other comments', () => {
    expect(extractSourceUsage('<!-- sources-used: 1 --><!-- keep --><p>x</p>', 2).html).toBe('<!-- keep --><p>x</p>')
  })
  it('asks for nothing when nothing is attached', () => {
    expect(sourceUsageInstruction(0)).toBeNull()
    expect(sourceUsageInstruction(2)).toContain('sources-used')
  })
})
