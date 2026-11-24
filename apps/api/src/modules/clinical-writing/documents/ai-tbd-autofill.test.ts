// TBD auto-fill helpers — prompt builder + response parser.
//
// The route itself is end-to-end tested elsewhere; this file pins the
// parse rules so an accidental schema change in the prompt (e.g. we
// rename "unresolvable" to "reason") lands here as a red test instead
// of garbled output in production.

import { describe, expect, it } from 'vitest'
import {
  buildAutofillPrompt,
  parseAutofillResponse,
  type TbdAutofillItem,
} from './ai-tbd-autofill.js'

const ITEMS: TbdAutofillItem[] = [
  { tbd: 'protocol number',  marker: '[TBD: protocol number]' },
  { tbd: 'primary endpoint', marker: '[TBD: primary endpoint]' },
  { tbd: 'target enrolment', marker: '[TBD: target enrolment]' },
]

describe('buildAutofillPrompt', () => {
  it('includes every TBD and every source title', () => {
    const prompt = buildAutofillPrompt(ITEMS, [
      { id: 'u1', title: 'Protocol v2',   text: 'The protocol number is XYZ-123.', truncated: false, reason: null },
      { id: 'u2', title: 'Investigator Brochure', text: '...', truncated: true,  reason: null },
    ])
    expect(prompt).toContain('protocol number')
    expect(prompt).toContain('primary endpoint')
    expect(prompt).toContain('target enrolment')
    expect(prompt).toContain('Protocol v2')
    expect(prompt).toContain('Investigator Brochure')
    expect(prompt).toContain('STRICT JSON')
  })

  it('signals when no sources are attached', () => {
    const prompt = buildAutofillPrompt(ITEMS, [])
    expect(prompt).toContain('NO SOURCE DOCUMENTS ARE ATTACHED')
  })

  it('reports per-source text-unavailable reasons inline', () => {
    const prompt = buildAutofillPrompt(ITEMS, [
      { id: 'u1', title: 'Scanned PDF', text: '', truncated: false, reason: 'no extractable text' },
    ])
    expect(prompt).toContain('[text unavailable: no extractable text]')
  })
})

describe('parseAutofillResponse', () => {
  it('splits filled vs unresolvable', () => {
    const raw = JSON.stringify({
      items: [
        { tbd: 'protocol number',  value: 'XYZ-123' },
        { tbd: 'primary endpoint', unresolvable: 'not stated in any source — requires clinical team decision' },
      ],
    })
    const r = parseAutofillResponse(raw, ITEMS)
    expect(r.filled).toEqual([
      { tbd: 'protocol number', marker: '[TBD: protocol number]', value: 'XYZ-123' },
    ])
    expect(r.unresolvable.map(u => u.tbd)).toEqual(['primary endpoint'])
    expect(r.missed.map(m => m.tbd)).toEqual(['target enrolment'])
  })

  it('reports all items as missed when response is not JSON', () => {
    const r = parseAutofillResponse('here you go: XYZ-123 is the protocol', ITEMS)
    expect(r.filled).toEqual([])
    expect(r.unresolvable).toEqual([])
    expect(r.missed.map(m => m.tbd)).toEqual(['protocol number', 'primary endpoint', 'target enrolment'])
  })

  it("strips Claude's occasional ```json fences before parsing", () => {
    const raw = '```json\n{"items":[{"tbd":"protocol number","value":"ABC-9"}]}\n```'
    const r = parseAutofillResponse(raw, ITEMS)
    expect(r.filled[0]?.value).toBe('ABC-9')
  })

  it('matches TBD text case-insensitively', () => {
    const raw = JSON.stringify({
      items: [{ tbd: 'PROTOCOL NUMBER', value: 'XYZ-123' }],
    })
    const r = parseAutofillResponse(raw, ITEMS)
    expect(r.filled[0]?.marker).toBe('[TBD: protocol number]')
  })

  it('ignores unknown TBDs the model invented', () => {
    const raw = JSON.stringify({
      items: [
        { tbd: 'protocol number', value: 'XYZ-123' },
        { tbd: 'drug half-life',  value: '12 hours' },  // not in ITEMS
      ],
    })
    const r = parseAutofillResponse(raw, ITEMS)
    expect(r.filled.map(f => f.tbd)).toEqual(['protocol number'])
  })

  it('caps overly long values to 500 chars', () => {
    const longVal = 'x'.repeat(1_000)
    const raw = JSON.stringify({ items: [{ tbd: 'protocol number', value: longVal }] })
    const r = parseAutofillResponse(raw, ITEMS)
    expect(r.filled[0]?.value?.length).toBe(500)
  })
})
