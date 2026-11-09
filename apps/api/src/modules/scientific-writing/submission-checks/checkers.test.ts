// Unit tests for the real submission checkers.

import { describe, expect, it } from 'vitest'
import {
  CHECKER_BY_LABEL,
  checkCitationsHaveDoi,
  checkCoiStatements,
  hasCheckerFor,
  type CheckerInputs,
} from './checkers.js'

function base(over: Partial<CheckerInputs> = {}): CheckerInputs {
  return { citations: [], authors: [], ...over }
}

describe('checkCitationsHaveDoi', () => {
  it('passes when there are no non-source citations yet', () => {
    const r = checkCitationsHaveDoi(base())
    expect(r.state).toBe('pass')
    expect(r.note).toMatch(/No non-source citations/i)
  })

  it('passes when every non-source citation has a DOI in the fullRef (doi: prefix)', () => {
    const r = checkCitationsHaveDoi(base({
      citations: [
        { pmid: '1', fullRef: 'Smith J. Lancet. 2024. doi:10.1016/S0140-6736(24)00001-X', isSourceDocument: false },
        { pmid: '2', fullRef: 'Chen L. NEJM. 2025. 10.1056/NEJMoa260XXXX',               isSourceDocument: false },
      ],
    }))
    expect(r.state).toBe('pass')
    expect(r.note).toMatch(/All 2 citations have DOIs/)
  })

  it('skips isSourceDocument citations (CSRs have no DOI)', () => {
    const r = checkCitationsHaveDoi(base({
      citations: [
        { pmid: null, fullRef: 'VELORA-301 CSR v3', isSourceDocument: true },
      ],
    }))
    expect(r.state).toBe('pass')
  })

  it('warns when some non-source citations are missing a DOI', () => {
    const r = checkCitationsHaveDoi(base({
      citations: [
        { pmid: '1', fullRef: 'Smith J. Lancet. 2024. doi:10.1016/x', isSourceDocument: false },
        { pmid: '2', fullRef: 'Chen L. NEJM. 2025.',                   isSourceDocument: false },
        { pmid: '3', fullRef: 'Patel A. Nature. 2023.',                isSourceDocument: false },
      ],
    }))
    expect(r.state).toBe('warn')
    expect(r.note).toMatch(/2 of 3 citation\(s\) missing a DOI/)
  })
})

describe('checkCoiStatements', () => {
  it('warns when no authors are listed', () => {
    expect(checkCoiStatements(base())).toMatchObject({ state: 'warn' })
  })

  it('passes when every author has coiStatus=submitted', () => {
    const r = checkCoiStatements(base({
      authors: [
        { id: 'a1', name: 'Alice', isExternal: false, coiStatus: 'submitted' },
        { id: 'a2', name: 'Bob',   isExternal: true,  coiStatus: 'submitted' },
      ],
    }))
    expect(r.state).toBe('pass')
    expect(r.note).toMatch(/All 2 author\(s\) submitted/)
  })

  it('blocks when any author has not submitted a COI', () => {
    const r = checkCoiStatements(base({
      authors: [
        { id: 'a1', name: 'Alice', isExternal: false, coiStatus: 'submitted' },
        { id: 'a2', name: 'Bob',   isExternal: true,  coiStatus: 'pending'   },
        { id: 'a3', name: 'Carol', isExternal: false, coiStatus: 'pending'   },
      ],
    }))
    expect(r.state).toBe('block')
    expect(r.note).toMatch(/2 author\(s\) have not submitted a COI/)
    expect(r.note).toContain('Bob')
    expect(r.note).toContain('Carol')
  })

  it('truncates the names list when > 3 authors are outstanding', () => {
    const r = checkCoiStatements(base({
      authors: Array.from({ length: 5 }, (_, i) =>
        ({ id: `a${i}`, name: `Auth${i}`, isExternal: false, coiStatus: 'pending' })),
    }))
    expect(r.state).toBe('block')
    expect(r.note).toMatch(/\+ 2 more/)
  })
})

describe('CHECKER_BY_LABEL', () => {
  it('maps the two known DEFAULT_CHECKS labels', () => {
    expect(hasCheckerFor('All citations have DOIs')).toBe(true)
    expect(hasCheckerFor('Conflict of interest statement')).toBe(true)
  })

  it('returns false for labels without a real checker', () => {
    expect(hasCheckerFor('Plagiarism check completed')).toBe(false)
    expect(hasCheckerFor('CONSORT checklist complete')).toBe(false)
  })

  it('each exported function maps to a live key (future-safe)', () => {
    expect(Object.values(CHECKER_BY_LABEL)).toContain(checkCitationsHaveDoi)
    expect(Object.values(CHECKER_BY_LABEL)).toContain(checkCoiStatements)
  })
})
