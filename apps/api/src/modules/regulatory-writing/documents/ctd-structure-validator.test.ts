import { describe, it, expect } from 'vitest'
import { validateCtdStructure, isCtdGatedType, ctdModulePath } from './ctd-structure-validator.js'

describe('ctdModulePath', () => {
  it('extracts module path from CTD docTypes', () => {
    expect(ctdModulePath('ctd_m2_5_clinical_overview')).toBe('2.5')
    expect(ctdModulePath('ctd_m2_7_clinical_summary')).toBe('2.7')
    expect(ctdModulePath('ctd_m2_6_nonclin_summary')).toBe('2.6')
    expect(ctdModulePath('ctd_m2_3_qos')).toBe('2.3')
  })

  it('returns null for non-CTD or unmapped CTD docTypes', () => {
    expect(ctdModulePath('cover_letter')).toBeNull()
    expect(ctdModulePath('ha_response_narrative')).toBeNull()
    expect(ctdModulePath('risk_benefit_statement')).toBeNull()
    // M2.4 narrative overview — intentionally unmapped.
    expect(ctdModulePath('ctd_m2_4_nonclin_overview')).toBeNull()
  })
})

describe('isCtdGatedType', () => {
  it('fires on supported CTD module docTypes', () => {
    expect(isCtdGatedType('ctd_m2_5_clinical_overview')).toBe(true)
    expect(isCtdGatedType('ctd_m2_7_clinical_summary')).toBe(true)
  })
  it('skips non-CTD content', () => {
    expect(isCtdGatedType('cover_letter')).toBe(false)
    expect(isCtdGatedType('ha_response_narrative')).toBe(false)
  })
})

describe('validateCtdStructure', () => {
  it('passes through non-CTD docTypes with no flagging', () => {
    const r = validateCtdStructure('<p>Section 2.5.9 referenced.</p>', '', 'cover_letter')
    expect(r.gated).toBe(false)
    expect(r.structurallyValid).toBe(true)
    expect(r.invalidRefs).toHaveLength(0)
  })

  it('accepts canonical subsection refs on M2.5', () => {
    const html = '<p>See §2.5.3 for clinical pharmacology and §2.5.4 for efficacy.</p>'
    const r = validateCtdStructure(html, '', 'ctd_m2_5_clinical_overview')
    expect(r.gated).toBe(true)
    expect(r.structurallyValid).toBe(true)
    expect(r.invalidRefs).toHaveLength(0)
  })

  it('accepts deeper nested canonical refs (2.5.3.2)', () => {
    const html = '<p>As described in Section 2.5.3.2.1 of the overview.</p>'
    const r = validateCtdStructure(html, '', 'ctd_m2_5_clinical_overview')
    expect(r.structurallyValid).toBe(true)
  })

  it('flags invented subsection refs that share the module top', () => {
    const html = '<p>Refer to §2.5.9 (nonexistent) and §2.5.1.</p>'
    const r = validateCtdStructure(html, '', 'ctd_m2_5_clinical_overview')
    expect(r.gated).toBe(true)
    expect(r.structurallyValid).toBe(false)
    expect(r.invalidRefs).toContain('2.5.9')
    expect(r.invalidRefs).not.toContain('2.5.1')
  })

  it('ignores invented refs to other modules', () => {
    const html = '<p>See Section 4.2.3 of the toxicology summary.</p>'
    const r = validateCtdStructure(html, '', 'ctd_m2_5_clinical_overview')
    expect(r.structurallyValid).toBe(true)
  })

  it('ignores a non-canonical ref that was already in the pre-call body', () => {
    const preCall = '<p>Per our custom §2.5.99 convention, see appendix.</p>'
    const after   = '<p>Per our custom §2.5.99 convention, see appendix.</p>'
    const r = validateCtdStructure(after, preCall, 'ctd_m2_5_clinical_overview')
    expect(r.structurallyValid).toBe(true)
    expect(r.invalidRefs).toHaveLength(0)
  })

  it('does flag a NEW non-canonical ref even when another non-canonical ref was pre-call', () => {
    const preCall = '<p>Per our §2.5.99 convention.</p>'
    const after   = '<p>Per our §2.5.99 convention. See also §2.5.9.</p>'
    const r = validateCtdStructure(after, preCall, 'ctd_m2_5_clinical_overview')
    expect(r.invalidRefs).toEqual(['2.5.9'])
  })

  it('validates M2.3 (QOS) against S/P/A/R subsections', () => {
    const ok = validateCtdStructure('<p>See §2.3.S.2 and §2.3.P.5.</p>', '', 'ctd_m2_3_qos')
    expect(ok.structurallyValid).toBe(true)
    const bad = validateCtdStructure('<p>See §2.3.X (invented) and §2.3.S.</p>', '', 'ctd_m2_3_qos')
    expect(bad.invalidRefs).toContain('2.3.X')
  })

  it('validates M2.7 (Clinical Summary) with 6 canonical children', () => {
    const ok = validateCtdStructure('<p>See §2.7.5 literature references.</p>', '', 'ctd_m2_7_clinical_summary')
    expect(ok.structurallyValid).toBe(true)
    const bad = validateCtdStructure('<p>See §2.7.9 (invented).</p>', '', 'ctd_m2_7_clinical_summary')
    expect(bad.invalidRefs).toContain('2.7.9')
  })

  it('accepts the module top itself as a canonical ref', () => {
    const r = validateCtdStructure('<p>Overview §2.5 provides context.</p>', '', 'ctd_m2_5_clinical_overview')
    expect(r.structurallyValid).toBe(true)
  })
})
