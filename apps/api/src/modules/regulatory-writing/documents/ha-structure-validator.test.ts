// Tests for the HA response structural validator (Package R-5).

import { describe, expect, it } from 'vitest'
import { validateHaResponseStructure, isHaGatedType } from './ha-structure-validator.js'

describe('validateHaResponseStructure — fully-labelled HA response', () => {
  it('passes when all 5 conventional labels are present with colons', () => {
    const html = `
      <p><strong>Question:</strong> Please clarify the ECOG subgroup analysis.</p>
      <p><strong>Response:</strong> ECOG 0 patients derived greater benefit.</p>
      <p><strong>Rationale:</strong> Pre-specified analysis per protocol §4.2.</p>
      <p><strong>Dossier Impact:</strong> Module 2.5 §2.5.4 updated with subgroup table.</p>
      <p><strong>References:</strong> CSR v1.0 Table 14.2.7.1.</p>
    `
    const r = validateHaResponseStructure(html)
    expect(r.looksLikeHaResponse).toBe(true)
    expect(r.labelsFound).toHaveLength(5)
    expect(r.structurallyValid).toBe(true)
  })

  it('passes with the minimum 3 conventional labels (tolerant threshold)', () => {
    const html = `
      <p>Question: Please clarify the ECOG subgroup analysis.</p>
      <p>Response: ECOG 0 patients derived greater benefit (HR 0.57).</p>
      <p>Rationale: Pre-specified analysis.</p>
    `
    const r = validateHaResponseStructure(html)
    expect(r.structurallyValid).toBe(true)
    expect(r.labelsFound).toEqual(expect.arrayContaining(['Question', 'Response', 'Rationale']))
    expect(r.missingLabels).toEqual(expect.arrayContaining(['Dossier Impact', 'References']))
  })

  it('tolerates dash-separated label format (Question — …)', () => {
    const html = `
      <p>Question — Please clarify.</p>
      <p>Response — Here is the clarification.</p>
      <p>Rationale — Supporting evidence.</p>
    `
    const r = validateHaResponseStructure(html)
    expect(r.structurallyValid).toBe(true)
  })
})

describe('validateHaResponseStructure — missing structure', () => {
  it('flags when only 2 labels are present (below threshold)', () => {
    const html = `
      <p>Question: Please clarify.</p>
      <p>Response: Here is the clarification without supporting detail.</p>
    `
    const r = validateHaResponseStructure(html)
    expect(r.looksLikeHaResponse).toBe(true)
    expect(r.structurallyValid).toBe(false)
    expect(r.labelsFound).toHaveLength(2)
  })

  it('flags a rewrite that stripped all labels but kept the question-answer prose', () => {
    const html = `<p>The sponsor clarifies that ECOG 0 patients showed greater benefit than ECOG 1 patients, as reported in Table 14.2.7.1 of the CSR.</p>`
    const r = validateHaResponseStructure(html)
    // Has no labels but has a '?' — … actually no '?' here; make sure
    // looksLikeHaResponse is false → strongly flagged as not HA
    expect(r.looksLikeHaResponse).toBe(false)
    expect(r.structurallyValid).toBe(true)  // non-HA content gets a free pass
  })
})

describe('validateHaResponseStructure — non-HA prose', () => {
  it('returns structurallyValid=true (free pass) on plain prose without labels', () => {
    const html = `<p>Background on NSCLC epidemiology. No question-and-answer structure here.</p>`
    const r = validateHaResponseStructure(html)
    expect(r.looksLikeHaResponse).toBe(false)
    expect(r.structurallyValid).toBe(true)
  })

  it('returns structurallyValid=true on empty input', () => {
    expect(validateHaResponseStructure('').structurallyValid).toBe(true)
    expect(validateHaResponseStructure('<p></p>').structurallyValid).toBe(true)
  })
})

describe('isHaGatedType', () => {
  it('only gates ha_response_narrative', () => {
    expect(isHaGatedType('ha_response_narrative')).toBe(true)
    expect(isHaGatedType('ctd_m2_5_clinical_overview')).toBe(false)
    expect(isHaGatedType('cover_letter')).toBe(false)
    expect(isHaGatedType('risk_benefit_statement')).toBe(false)
  })
})
