import { describe, expect, it } from 'vitest'
import {
  canAdvancePublication,
  InvalidPublicationStageError,
  nextPublicationStage,
} from './publication-stage.js'

describe('publication stage machine', () => {
  it('walks forward through the lifecycle', () => {
    expect(canAdvancePublication('planning', 'authoring')).toBe(true)
    expect(canAdvancePublication('authoring', 'review')).toBe(true)
    expect(canAdvancePublication('review', 'submission')).toBe(true)
    expect(canAdvancePublication('submission', 'published')).toBe(true)
  })

  it('permits reviewer and R&R bounces back to authoring', () => {
    expect(canAdvancePublication('review', 'authoring')).toBe(true)
    expect(canAdvancePublication('submission', 'authoring')).toBe(true)
  })

  it('refuses skipping stages', () => {
    expect(canAdvancePublication('planning', 'review')).toBe(false)
    expect(canAdvancePublication('authoring', 'submission')).toBe(false)
  })

  it('treats published as terminal — no transitions out', () => {
    expect(nextPublicationStage('published')).toBeNull()
    expect(canAdvancePublication('published', 'submission')).toBe(false)
  })

  it('error message lists allowed next stages', () => {
    const err = new InvalidPublicationStageError('planning', 'published')
    expect(err.message).toMatch(/planning → published/)
    expect(err.message).toMatch(/authoring/)
  })
})
