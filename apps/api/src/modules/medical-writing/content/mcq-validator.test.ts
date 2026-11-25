// Tests for the CME MCQ structural validator (Package D-3).

import { describe, expect, it } from 'vitest'
import { validateMcqStructure, isMcqGatedType } from './mcq-validator.js'

describe('validateMcqStructure — happy-path valid MCQs', () => {
  it('passes a well-formed 1-question block (4 options, correct-answer footer)', () => {
    const html = `
      <p>Question 1: Which agent is first-line for PD-L1 ≥50% metastatic NSCLC?</p>
      <ul>
        <li>A. Pembrolizumab monotherapy</li>
        <li>B. Platinum doublet chemotherapy</li>
        <li>C. EGFR TKI</li>
        <li>D. Nivolumab + ipilimumab</li>
      </ul>
      <p>Correct answer: A</p>
    `
    const r = validateMcqStructure(html)
    expect(r.looksLikeMcq).toBe(true)
    expect(r.questionCount).toBeGreaterThanOrEqual(1)
    expect(r.optionCount).toBeGreaterThanOrEqual(4)
    expect(r.correctMarkerCount).toBeGreaterThanOrEqual(1)
    expect(r.structurallyValid).toBe(true)
  })

  it('passes a 2-question block (8 options total, 2 correct markers)', () => {
    const html = `
      <p>1. Which agent is first-line?</p>
      <p>A. X</p><p>B. Y</p><p>C. Z</p><p>D. W</p>
      <p>Correct answer: A</p>
      <p>2. Which biomarker is measured?</p>
      <p>A. PD-L1</p><p>B. EGFR</p><p>C. ALK</p><p>D. ROS1</p>
      <p>Correct answer: A</p>
    `
    const r = validateMcqStructure(html)
    expect(r.questionCount).toBeGreaterThanOrEqual(2)
    expect(r.optionCount).toBeGreaterThanOrEqual(8)
    expect(r.structurallyValid).toBe(true)
  })
})

describe('validateMcqStructure — invalid MCQ shapes', () => {
  it('flags when options are missing a correct-answer marker', () => {
    const html = `
      <p>Question 1: Which agent is first-line?</p>
      <p>A. X</p><p>B. Y</p><p>C. Z</p><p>D. W</p>
    `
    const r = validateMcqStructure(html)
    expect(r.looksLikeMcq).toBe(true)
    expect(r.structurallyValid).toBe(false)
    expect(r.correctMarkerCount).toBe(0)
  })

  it('flags when options are fewer than 4', () => {
    const html = `
      <p>Question 1: What is true?</p>
      <p>A. X</p><p>B. Y</p>
      <p>Correct answer: A</p>
    `
    const r = validateMcqStructure(html)
    expect(r.structurallyValid).toBe(false)
    expect(r.optionCount).toBe(2)
  })

  it('flags when correct-marker count does not match question count', () => {
    const html = `
      <p>1. Q1?</p><p>A. X</p><p>B. Y</p><p>C. Z</p><p>D. W</p>
      <p>Correct answer: A</p>
      <p>2. Q2?</p><p>A. X</p><p>B. Y</p><p>C. Z</p><p>D. W</p>
    `
    const r = validateMcqStructure(html)
    expect(r.structurallyValid).toBe(false)
  })
})

describe('validateMcqStructure — non-MCQ content is left alone', () => {
  it('returns structurallyValid=true on plain prose (looksLikeMcq=false)', () => {
    const html = `<p>This is a background section about NSCLC epidemiology. No questions here.</p>`
    const r = validateMcqStructure(html)
    expect(r.looksLikeMcq).toBe(false)
    expect(r.structurallyValid).toBe(true)
  })

  it('returns structurallyValid=true on empty input', () => {
    expect(validateMcqStructure('').structurallyValid).toBe(true)
    expect(validateMcqStructure('<p></p>').structurallyValid).toBe(true)
  })
})

describe('isMcqGatedType', () => {
  it('only gates cme_module', () => {
    expect(isMcqGatedType('cme_module')).toBe(true)
    expect(isMcqGatedType('pil')).toBe(false)
    expect(isMcqGatedType('mi_letter')).toBe(false)
    expect(isMcqGatedType('hcp_slide_deck')).toBe(false)
  })
})
