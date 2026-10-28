import { describe, expect, it } from 'vitest'
import { AI_PASS_PROFILES, buildAiPassPrompt, parseAiPassResponse } from './ai-pass-prompt.js'

describe('buildAiPassPrompt', () => {
  it('includes the profile instruction + response-format rule', () => {
    const prompt = buildAiPassPrompt(AI_PASS_PROFILES.consistency, [
      { sectionNumber: '10.1', contentHtml: 'Section body here' },
    ])
    expect(prompt).toContain('clinical writing quality reviewer')
    expect(prompt).toContain('End your reply with EXACTLY one JSON line')
    expect(prompt).toContain('"criticalIssues"')
    expect(prompt).toContain('### Section 10.1')
    expect(prompt).toContain('Section body here')
  })

  it('joins multiple sections with blank lines', () => {
    const prompt = buildAiPassPrompt(AI_PASS_PROFILES.tone, [
      { sectionNumber: '1', contentHtml: 'First' },
      { sectionNumber: '2', contentHtml: 'Second' },
    ])
    expect(prompt).toContain('### Section 1\nFirst')
    expect(prompt).toContain('### Section 2\nSecond')
  })
})

describe('parseAiPassResponse', () => {
  it('parses a clean JSON summary line', () => {
    const r = parseAiPassResponse(
      'Analysis follows...\n{"criticalIssues": 0, "summary": "All sections consistent"}',
    )
    expect(r).toEqual({ criticalIssues: 0, summary: 'All sections consistent' })
  })

  it('parses with criticalIssues > 0', () => {
    const r = parseAiPassResponse('Observations:\n{"criticalIssues": 3, "summary": "Three term mismatches"}')
    expect(r.criticalIssues).toBe(3)
    expect(r.summary).toContain('Three term mismatches')
  })

  it('picks the LAST JSON block when multiple are present', () => {
    const r = parseAiPassResponse(
      'Draft: {"criticalIssues": 99, "summary": "wrong"}\nFinal:\n{"criticalIssues": 1, "summary": "right"}',
    )
    expect(r).toEqual({ criticalIssues: 1, summary: 'right' })
  })

  it('safe-fails when no JSON block present', () => {
    const r = parseAiPassResponse('I think everything is fine, but no JSON provided.')
    expect(r.criticalIssues).toBe(1)
    expect(r.summary).toContain('parse-fail')
  })

  it('safe-fails on malformed JSON', () => {
    const r = parseAiPassResponse('Summary:\n{criticalIssues: "wat", summary: broken}')
    expect(r.criticalIssues).toBe(1)
    expect(r.summary).toContain('parse-fail')
  })

  it('safe-fails on non-integer criticalIssues', () => {
    const r = parseAiPassResponse('{"criticalIssues": "many", "summary": "unknown"}')
    expect(r.criticalIssues).toBe(1)
    expect(r.summary).toContain('parse-fail')
    expect(r.summary).toContain('not a non-negative integer')
  })

  it('floors fractional criticalIssues', () => {
    const r = parseAiPassResponse('{"criticalIssues": 2.9, "summary": "found 2.9 somehow"}')
    expect(r.criticalIssues).toBe(2)
  })

  it('safe-fails on negative criticalIssues', () => {
    const r = parseAiPassResponse('{"criticalIssues": -1, "summary": "weird"}')
    expect(r.criticalIssues).toBe(1)
    expect(r.summary).toContain('parse-fail')
  })

  it('supplies a default summary when the model omitted it', () => {
    const r = parseAiPassResponse('{"criticalIssues": 0}')
    expect(r.criticalIssues).toBe(0)
    expect(r.summary).toBe('(no summary)')
  })
})
