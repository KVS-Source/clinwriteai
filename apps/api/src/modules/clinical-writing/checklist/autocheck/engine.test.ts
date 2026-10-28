import { describe, expect, it } from 'vitest'
import { evaluateItems, type ItemForAutoCheck } from './engine.js'
import type { SectionContentForCheck } from './content-strategies.js'

const sections: SectionContentForCheck[] = [
  { sectionNumber: '10.1', contentHtml: 'Clean prose',               wordCount: 100 },
  { sectionNumber: '11',   contentHtml: 'Still has [TBD] markers',   wordCount: 500 },
]

function item(overrides: Partial<ItemForAutoCheck>): ItemForAutoCheck {
  return { id: 'i-x', autoCompleteOn: null, status: 'pending', ...overrides }
}

describe('autocheck engine — evaluateItems', () => {
  it('ignores items without an autoCompleteOn tag', () => {
    const r = evaluateItems([item({ autoCompleteOn: null })], sections)
    expect(r).toEqual([])
  })

  it('ignores non-pending items (completed stays completed)', () => {
    const r = evaluateItems([
      item({ id: 'i-done', autoCompleteOn: 'content-min-words:50:10.1', status: 'complete' }),
      item({ id: 'i-waived', autoCompleteOn: 'content-min-words:50:10.1', status: 'waived' }),
    ], sections)
    expect(r).toEqual([])
  })

  it('evaluates content-min-words → completed', () => {
    const r = evaluateItems([item({ id: 'i-wc', autoCompleteOn: 'content-min-words:50:10.1' })], sections)
    expect(r).toHaveLength(1)
    expect(r[0].shouldComplete).toBe(true)
    expect(r[0].result.kind).toBe('completed')
  })

  it('evaluates content-min-words → pending when under threshold', () => {
    const r = evaluateItems([item({ id: 'i-wc', autoCompleteOn: 'content-min-words:9999:10.1' })], sections)
    expect(r).toHaveLength(1)
    expect(r[0].shouldComplete).toBe(false)
    expect(r[0].result.kind).toBe('pending')
  })

  it('evaluates content-no-placeholders → pending when [TBD] present', () => {
    const r = evaluateItems([item({ id: 'i-nph', autoCompleteOn: 'content-no-placeholders' })], sections)
    expect(r).toHaveLength(1)
    expect(r[0].shouldComplete).toBe(false)
    expect(r[0].result.kind).toBe('pending')
  })

  it('references-complete dispatches (was deferred originally)', () => {
    const r = evaluateItems([
      item({ id: 'rc-dirty', autoCompleteOn: 'references-complete' }),
    ], sections)
    expect(r).toHaveLength(1)
    expect(r[0].result.kind).toBe('completed') // clean sample sections, no citation placeholders
  })

  it('ai-pass dispatches but returns pending when no result cached', () => {
    const r = evaluateItems([
      item({ id: 'ai-x', autoCompleteOn: 'ai-pass:consistency' }),
    ], sections)
    expect(r).toHaveLength(1)
    expect(r[0].result.kind).toBe('pending')
    if (r[0].result.kind === 'pending') expect(r[0].result.reason).toContain('no result cached')
  })

  it('signal:tlf-validated dispatches using the provided SignalContext', () => {
    const r = evaluateItems(
      [item({ id: 'sig-tlf', autoCompleteOn: 'signal:tlf-validated' })],
      sections,
      {
        tlfPackageValidated: true,
        signatureMeanings: [],
        crmMeetingsComplete: false,
        crmMeetingCount: 0,
      },
    )
    expect(r).toHaveLength(1)
    expect(r[0].result.kind).toBe('completed')
  })

  it('marks truly unknown strategies as skipped with "unknown"', () => {
    const r = evaluateItems([item({ id: 'u', autoCompleteOn: 'wat-is-this' })], sections)
    expect(r).toHaveLength(1)
    expect(r[0].result.kind).toBe('skipped')
    if (r[0].result.kind === 'skipped') expect(r[0].result.reason).toContain('unknown strategy')
  })

  it('mixed batch: multiple items evaluated independently', () => {
    const r = evaluateItems([
      item({ id: 'ok',      autoCompleteOn: 'content-min-words:50:10.1' }),           // completed
      item({ id: 'short',   autoCompleteOn: 'content-min-words:200:10.1' }),          // pending (100<200)
      item({ id: 'placeholder', autoCompleteOn: 'content-no-placeholders' }),         // pending ([TBD])
      item({ id: 'notag',   autoCompleteOn: null }),                                  // ignored
    ], sections)
    expect(r.map(e => e.itemId)).toEqual(['ok', 'short', 'placeholder'])
    expect(r.map(e => e.shouldComplete)).toEqual([true, false, false])
  })
})
