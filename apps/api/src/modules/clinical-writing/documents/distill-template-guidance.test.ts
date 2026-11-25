// Tests for the content-guidance extraction phase (migration 104,
// Package 2 of the "template guidance + regenerate guardrails" plan).
//
// Only the pure helpers are covered here — the Claude call itself is an
// integration concern. The gate is the hallucination firewall; the merge
// is what the create service will snapshot from. Both need to be solid
// before the create path starts relying on them.

import { describe, expect, it } from 'vitest'
import { __test__ } from '../../../../../worker/src/jobs/distill-template.js'

const { gateGuidanceString, applyGuidanceGate, mergeGuidanceIntoSections, parseGuidanceResponse } = __test__

describe('gateGuidanceString — hallucination firewall', () => {
  it('keeps a concrete, imperative string', () => {
    const r = gateGuidanceString('Include the study objectives, primary and secondary endpoints, and the statistical methods used.')
    expect(r.kept).toBeTruthy()
    expect(r.rejectedReason).toBeNull()
  })

  it('nulls out empty / whitespace input without flagging', () => {
    expect(gateGuidanceString(null)).toEqual({ kept: null, rejectedReason: null })
    expect(gateGuidanceString(undefined)).toEqual({ kept: null, rejectedReason: null })
    expect(gateGuidanceString('')).toEqual({ kept: null, rejectedReason: null })
    expect(gateGuidanceString('   ')).toEqual({ kept: null, rejectedReason: null })
  })

  it('rejects anything shorter than 30 chars as likely noise', () => {
    const r = gateGuidanceString('Cover it briefly')
    expect(r.kept).toBeNull()
    expect(r.rejectedReason).toBe('guidance:too_short')
  })

  it('rejects generic hedging openings that signal synthesis', () => {
    const r = gateGuidanceString('This section should describe the clinical outcomes and relevant findings.')
    expect(r.kept).toBeNull()
    expect(r.rejectedReason).toBe('guidance:generic_hedge')
  })

  it('rejects strings without any imperative verb (the Claude signal is probably padding)', () => {
    const r = gateGuidanceString('A general overview of relevant clinical considerations and context around the study population.')
    expect(r.kept).toBeNull()
    expect(r.rejectedReason).toBe('guidance:no_imperative')
  })
})

describe('applyGuidanceGate — bulk apply across Claude output', () => {
  it('counts rejections separately for instructions vs guidance and keeps only passing fields', () => {
    const out = applyGuidanceGate({
      s1: {
        instructions: 'Describe the study population, inclusion criteria, and exclusion criteria.',
        guidance:     'Short',    // too short — rejected
      },
      s2: {
        instructions: null,
        guidance:     'This section should present the safety data clearly.',  // generic hedge
      },
      s3: {
        instructions: 'List all serious adverse events observed during the trial, grouped by SOC.',
        guidance:     'State concisely; defer detailed narratives to the appendix.',
      },
    })
    expect(out.instructionsExtracted).toBe(2)
    expect(out.guidanceExtracted).toBe(1)
    expect(out.rejectedForHallucinationRisk).toBe(2)
    expect(out.byId.get('s1')).toEqual({ instructions: 'Describe the study population, inclusion criteria, and exclusion criteria.', guidance: null })
    expect(out.byId.has('s2')).toBe(false)
    expect(out.byId.get('s3')?.guidance).toMatch(/concisely/)
  })
})

describe('mergeGuidanceIntoSections — layers gated fields onto the template outline', () => {
  it('adds instructions and guidance only where the gated map has them, leaves other sections untouched', () => {
    const sections = [
      { id: 's1', number: '1', title: 'Intro' },
      { id: 's2', number: '2', title: 'Methods' },
      { id: 's3', number: '3', title: 'Results' },
    ]
    const byId = new Map<string, { instructions: string | null; guidance: string | null }>()
    byId.set('s1', { instructions: 'Cover the rationale for the study and the therapeutic area context.', guidance: null })
    byId.set('s3', { instructions: null, guidance: 'Present efficacy results first; discuss safety findings in a later subsection.' })
    const { sections: merged, merged: mergedCount } = mergeGuidanceIntoSections(sections, byId)
    expect(mergedCount).toBe(2)
    expect(merged[0]).toMatchObject({ id: 's1', instructions: expect.stringMatching(/rationale/) })
    expect(merged[0]).not.toHaveProperty('guidance')
    expect(merged[1]).toEqual({ id: 's2', number: '2', title: 'Methods' })
    expect(merged[2]).toMatchObject({ id: 's3', guidance: expect.stringMatching(/efficacy/) })
    expect(merged[2]).not.toHaveProperty('instructions')
  })

  it('skips sections where both fields gated to null', () => {
    const sections = [{ id: 's1', number: '1', title: 'Intro' }]
    const byId = new Map<string, { instructions: string | null; guidance: string | null }>()
    byId.set('s1', { instructions: null, guidance: null })
    const { merged } = mergeGuidanceIntoSections(sections, byId)
    expect(merged).toBe(0)
  })
})

describe('parseGuidanceResponse — robust to fences and wrappers', () => {
  it('parses a bare object keyed by section id', () => {
    const raw = `{"s1":{"instructions":"x","guidance":"y"}}`
    const out = parseGuidanceResponse(raw)
    expect('ok' in out).toBe(true)
  })

  it('accepts a {sections: {...}} wrapper', () => {
    const raw = `{"sections":{"s1":{"instructions":"x","guidance":null}}}`
    const out = parseGuidanceResponse(raw)
    expect('ok' in out).toBe(true)
    if ('ok' in out) expect(out.ok.s1).toEqual({ instructions: 'x', guidance: null })
  })

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n{"s1":{"instructions":"x","guidance":"y"}}\n```'
    const out = parseGuidanceResponse(raw)
    expect('ok' in out).toBe(true)
  })

  it('returns a fail reason on malformed JSON', () => {
    const out = parseGuidanceResponse('not json')
    expect('fail' in out).toBe(true)
  })

  it('skips keys that do not match the section-id shape rather than failing', () => {
    const raw = `{"s1":{"instructions":"x","guidance":null},"bad key":{"instructions":"y"}}`
    const out = parseGuidanceResponse(raw)
    expect('ok' in out).toBe(true)
    if ('ok' in out) {
      expect(out.ok.s1).toBeDefined()
      expect(Object.keys(out.ok)).toEqual(['s1'])
    }
  })
})
