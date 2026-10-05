import { describe, expect, it } from 'vitest'
import {
  canTransitionDocument,
  InvalidDocumentTransitionError,
  nextDocumentStates,
} from './document-status.js'

describe('document status machine', () => {
  it('walks the happy path through sign-off', () => {
    expect(canTransitionDocument('not_started', 'in_authoring')).toBe(true)
    expect(canTransitionDocument('in_authoring', 'in_review')).toBe(true)
    expect(canTransitionDocument('in_review', 'crm_in_progress')).toBe(true)
    expect(canTransitionDocument('crm_in_progress', 'pending_signature')).toBe(true)
    expect(canTransitionDocument('pending_signature', 'signed')).toBe(true)
  })

  it('permits reviewer bounces back to author', () => {
    expect(canTransitionDocument('in_review', 'in_authoring')).toBe(true)
    expect(canTransitionDocument('crm_in_progress', 'in_authoring')).toBe(true)
    expect(canTransitionDocument('pending_signature', 'in_authoring')).toBe(true)
  })

  it('refuses self-transitions', () => {
    expect(canTransitionDocument('in_authoring', 'in_authoring')).toBe(false)
  })

  it('refuses skipping ahead', () => {
    expect(canTransitionDocument('in_authoring', 'signed')).toBe(false)
    expect(canTransitionDocument('not_started', 'in_review')).toBe(false)
  })

  it('treats signed as terminal', () => {
    expect(nextDocumentStates('signed')).toEqual([])
    expect(canTransitionDocument('signed', 'in_authoring')).toBe(false)
  })

  it('error message names the invalid transition and valid next states', () => {
    const err = new InvalidDocumentTransitionError('in_authoring', 'signed')
    expect(err.message).toMatch(/in_authoring → signed/)
    expect(err.message).toMatch(/in_review/)
  })
})
