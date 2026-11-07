// Unit tests for intentToAsk — the collapse of the /ai-suggest intent
// switch into a single <ask> string the carry prompt carries.

import { describe, expect, it } from 'vitest'
import { intentToAsk } from './intent-to-ask.js'

describe('intentToAsk', () => {
  it('returns a fixed clarity instruction for tighten', () => {
    expect(intentToAsk({ intent: 'tighten' })).toMatch(/Rewrite this section for clarity/)
  })

  it('returns a plain-English instruction for explain', () => {
    expect(intentToAsk({ intent: 'explain' })).toMatch(/plain English/i)
  })

  it('returns a draft-from-scratch instruction for draft_from_source', () => {
    expect(intentToAsk({ intent: 'draft_from_source' })).toMatch(/Draft this section/i)
  })

  it('returns the custom prompt verbatim for custom (trimmed)', () => {
    expect(intentToAsk({ intent: 'custom', customPrompt: '  Make it two sentences.  ' })).toBe('Make it two sentences.')
  })

  it('returns a complete-section edit instruction for edit without selection', () => {
    const ask = intentToAsk({ intent: 'edit', customPrompt: 'Fix tense' })
    expect(ask).toMatch(/return the COMPLETE revised section/)
    expect(ask).toContain('Instruction: Fix tense')
  })

  it('returns a passage-only edit instruction for edit with selection', () => {
    const ask = intentToAsk({
      intent:        'edit',
      customPrompt:  'Fix grammar',
      selectionText: 'The results was good.',
    })
    expect(ask).toMatch(/revised passage/i)
    expect(ask).toContain('Fix grammar')
    expect(ask).toContain('The results was good.')
  })

  it('restricts edit HTML to the allowed tag set', () => {
    const ask = intentToAsk({ intent: 'edit', customPrompt: 'x' })
    expect(ask).toContain('p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td')
  })
})
