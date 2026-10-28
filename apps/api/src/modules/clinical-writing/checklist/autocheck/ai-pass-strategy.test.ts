import { describe, expect, it } from 'vitest'
import { emptyAiPassContext, evaluateAiPass, type AiPassContext } from './ai-pass-strategy.js'

describe('evaluateAiPass', () => {
  it('skipped when profile name is missing', () => {
    const r = evaluateAiPass([], emptyAiPassContext())
    expect(r.kind).toBe('skipped')
    if (r.kind === 'skipped') expect(r.reason).toContain('missing profile')
  })

  it('pending with "run AI pass first" hint when no result cached', () => {
    const r = evaluateAiPass(['consistency'], emptyAiPassContext())
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') {
      expect(r.reason).toContain('consistency')
      expect(r.reason).toContain('no result cached')
    }
  })

  it('completed when cached result has 0 critical issues', () => {
    const ctx: AiPassContext = { consistency: { criticalIssues: 0, summary: 'All checks passed' } }
    const r = evaluateAiPass(['consistency'], ctx)
    expect(r.kind).toBe('completed')
    if (r.kind === 'completed') {
      expect(r.reason).toContain('0 critical')
      expect(r.reason).toContain('All checks passed')
    }
  })

  it('pending when cached result has > 0 critical issues', () => {
    const ctx: AiPassContext = { consistency: { criticalIssues: 3, summary: 'Terminology mismatch' } }
    const r = evaluateAiPass(['consistency'], ctx)
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') {
      expect(r.reason).toContain('3 critical')
      expect(r.reason).toContain('Terminology mismatch')
    }
  })

  it('profile name is case-insensitive on lookup', () => {
    const ctx: AiPassContext = { consistency: { criticalIssues: 0, summary: 'clean' } }
    const r = evaluateAiPass(['CONSISTENCY'], ctx)
    expect(r.kind).toBe('completed')
  })

  it('independent per profile — one cached, another not', () => {
    const ctx: AiPassContext = { terminology: { criticalIssues: 0, summary: 'ok' } }
    expect(evaluateAiPass(['terminology'], ctx).kind).toBe('completed')
    expect(evaluateAiPass(['consistency'], ctx).kind).toBe('pending')
  })
})
