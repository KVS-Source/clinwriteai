import { afterEach, describe, expect, it } from 'vitest'
import {
  _resetAiPassCache,
  getAiPassResult,
  getAllAiPassResultsForDocument,
  putAiPassResult,
} from './ai-pass-cache.js'

afterEach(() => _resetAiPassCache())

describe('ai-pass cache', () => {
  it('put + get returns the stored result', () => {
    putAiPassResult('d-1', 'consistency', 'v-1', { criticalIssues: 0, summary: 'clean' })
    expect(getAiPassResult('d-1', 'consistency', 'v-1')).toEqual({ criticalIssues: 0, summary: 'clean' })
  })

  it('get returns undefined for a different version (version-scoped cache)', () => {
    putAiPassResult('d-1', 'consistency', 'v-1', { criticalIssues: 0, summary: 'clean' })
    expect(getAiPassResult('d-1', 'consistency', 'v-2')).toBeUndefined()
  })

  it('get returns undefined for a different profile', () => {
    putAiPassResult('d-1', 'consistency', 'v-1', { criticalIssues: 0, summary: 'clean' })
    expect(getAiPassResult('d-1', 'tone', 'v-1')).toBeUndefined()
  })

  it('profile lookup is case-insensitive', () => {
    putAiPassResult('d-1', 'Consistency', 'v-1', { criticalIssues: 0, summary: 'clean' })
    expect(getAiPassResult('d-1', 'CONSISTENCY', 'v-1')).toBeDefined()
    expect(getAiPassResult('d-1', 'consistency', 'v-1')).toBeDefined()
  })

  it('getAllAiPassResultsForDocument returns a map of profile → result', () => {
    putAiPassResult('d-1', 'consistency', 'v-1', { criticalIssues: 0, summary: 'ok' })
    putAiPassResult('d-1', 'tone',        'v-1', { criticalIssues: 2, summary: 'inconsistent' })
    putAiPassResult('d-1', 'consistency', 'v-2', { criticalIssues: 1, summary: 'later' })  // different version, excluded
    putAiPassResult('d-2', 'consistency', 'v-1', { criticalIssues: 0, summary: 'other-doc' }) // different doc, excluded

    const results = getAllAiPassResultsForDocument('d-1', 'v-1')
    expect(Object.keys(results).sort()).toEqual(['consistency', 'tone'])
    expect(results.consistency).toEqual({ criticalIssues: 0, summary: 'ok' })
    expect(results.tone).toEqual({ criticalIssues: 2, summary: 'inconsistent' })
  })

  it('getAllAiPassResultsForDocument returns empty when nothing cached', () => {
    expect(getAllAiPassResultsForDocument('d-nothing', 'v-1')).toEqual({})
  })
})
