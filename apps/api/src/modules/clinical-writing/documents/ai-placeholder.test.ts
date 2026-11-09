// Placeholder text from an unconfigured AI must not be saved into a section.

import { describe, expect, it } from 'vitest'
import { containsAiPlaceholder } from './ai-placeholder.js'

const off = {} as NodeJS.ProcessEnv

describe('containsAiPlaceholder', () => {
  it.each([
    ['gateway stub', '<p>[STUB_claude-opus-4-7] Would respond to a prompt of length 412.</p>'],
    ['stub with attachments', '[STUB_gpt-4o] Would respond to a prompt of length 9 with 1 image(s).'],
    ['first-draft worker, no key', '<p><em>[AI-drafted initial content — ANTHROPIC_API_KEY not set, deterministic stub shown instead.]</em></p>'],
    ['first-draft worker, failed call', '<p><em>[Draft fell back to stub — Claude call failed: 401]</em></p>'],
  ])('flags %s', (_name, html) => {
    expect(containsAiPlaceholder(html, off)).toBe(true)
  })

  it('does not flag real content, empty text or ordinary square brackets', () => {
    expect(containsAiPlaceholder('<p>Patients received 10 mg [see Table 14.1.2].</p>', off)).toBe(false)
    expect(containsAiPlaceholder('', off)).toBe(false)
    expect(containsAiPlaceholder(null, off)).toBe(false)
  })

  it('lets the text through when the dev/CI stub is explicitly allowed', () => {
    expect(containsAiPlaceholder('[STUB_claude-x] Would respond to a prompt of length 1.', { AI_ALLOW_STUB: '1' } as NodeJS.ProcessEnv)).toBe(false)
  })
})
