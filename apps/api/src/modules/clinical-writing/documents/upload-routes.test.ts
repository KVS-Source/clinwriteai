// Classifier heuristic coverage — recommended by Arc 5.3 of
// docs/pivot-plan.md. The route handlers themselves are exercised by
// the CI web-integration Playwright job; these unit tests pin the
// filename → document-type mapping so renames don't silently flip
// client-visible defaults.

import { describe, it, expect } from 'vitest'
import { classifyByFilename } from './upload-routes.js'

describe('classifyByFilename', () => {
  it('matches CSR variants with high confidence', () => {
    const a = classifyByFilename('VELORA-301-CSR-v1.0.pdf')
    expect(a.documentType).toBe('csr_full')
    expect(a.typeConfidence).toBeGreaterThanOrEqual(80)
    expect(a.version).toBe('v1.0')

    const b = classifyByFilename('clinical-study-report-draft.docx')
    expect(b.documentType).toBe('csr_full')

    const c = classifyByFilename('STUDY-ABCD Clinical Study Report v2.pdf')
    expect(c.documentType).toBe('csr_full')
    expect(c.version).toBe('v2')
  })

  it('matches Protocol with high confidence', () => {
    const a = classifyByFilename('VELORA-301 Protocol v1.2.docx')
    expect(a.documentType).toBe('protocol')
    expect(a.typeConfidence).toBeGreaterThanOrEqual(85)
    expect(a.version).toBe('v1.2')
  })

  it('matches IB (word boundary) without matching unrelated strings', () => {
    expect(classifyByFilename('investigator-brochure-2024.pdf').documentType).toBe('ib')
    expect(classifyByFilename('STUDY IB v3.docx').documentType).toBe('ib')
    // Should NOT match 'IB' embedded in other words:
    expect(classifyByFilename('fibromyalgia-protocol.docx').documentType).toBe('protocol')
  })

  it('matches ICF (informed consent form)', () => {
    expect(classifyByFilename('ICF-English-v1.pdf').documentType).toBe('icf')
    expect(classifyByFilename('informed-consent-form.docx').documentType).toBe('icf')
  })

  it('matches DSUR', () => {
    expect(classifyByFilename('DSUR-2024-annual.pdf').documentType).toBe('dsur')
  })

  it('falls back to protocol with low confidence when nothing matches', () => {
    const result = classifyByFilename('random-document.pdf')
    expect(result.documentType).toBe('protocol')
    expect(result.typeConfidence).toBeLessThanOrEqual(60)
  })

  it('extracts version from v<digits>(.<digits>)? patterns', () => {
    expect(classifyByFilename('document-v3.pdf').version).toBe('v3')
    expect(classifyByFilename('document-v3.5.pdf').version).toBe('v3.5')
    expect(classifyByFilename('document-no-version.pdf').version).toBe('v0.1')
    expect(classifyByFilename('document-no-version.pdf').versionConfidence).toBeLessThanOrEqual(20)
  })

  it('always flags stub=true so UI can show "AI classifier not yet live"', () => {
    expect(classifyByFilename('whatever.pdf').stub).toBe(true)
  })
})
