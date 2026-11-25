// Tests for the inlined Flesch-Kincaid grade computation used by the
// Medical ai-suggest route's fk_score_raised soft validator.

import { describe, expect, it } from 'vitest'
import { computeFkGrade, isFkGatedType, FK_GATED_TYPES, FK_TARGET } from './fk-score.js'

describe('computeFkGrade — grade scoring', () => {
  it('returns grade 0 for empty / whitespace / HTML-only input', () => {
    expect(computeFkGrade('').grade).toBe(0)
    expect(computeFkGrade('   ').grade).toBe(0)
    expect(computeFkGrade('<p></p>').grade).toBe(0)
    expect(computeFkGrade('<p>   </p><br/>').grade).toBe(0)
  })

  it('scores simple patient-friendly text at a low grade', () => {
    const html = '<p>Take one pill a day. Drink water with it. Call your doctor if you feel sick.</p>'
    const { grade, words, sentences } = computeFkGrade(html)
    expect(words).toBeGreaterThan(10)
    expect(sentences).toBeGreaterThanOrEqual(3)
    expect(grade).toBeLessThan(FK_TARGET)   // well under grade 8
  })

  it('scores dense scientific prose at a high grade', () => {
    const html = `<p>Pembrolizumab demonstrated statistically significant improvement in progression-free survival compared with the comparator regimen, with concomitant administration of pemetrexed plus platinum-containing chemotherapy reinforcing the therapeutic index in metastatic non-small-cell lung carcinoma populations exhibiting PD-L1 expression levels exceeding established thresholds.</p>`
    const { grade } = computeFkGrade(html)
    expect(grade).toBeGreaterThan(FK_TARGET)
  })

  it('counts sentences across paragraphs and list items', () => {
    const html = '<p>First sentence.</p><p>Second sentence!</p><ul><li>Third item.</li><li>Fourth item?</li></ul>'
    const { sentences } = computeFkGrade(html)
    expect(sentences).toBeGreaterThanOrEqual(4)
  })

  it('tolerates HTML entities, scripts, styles in the strip step', () => {
    const html = `<style>p { color: red }</style><script>alert('x')</script><p>Take one pill&nbsp;a day. Drink water with it.</p>`
    const { words, grade } = computeFkGrade(html)
    // Script + style + nbsp entity must be stripped; the visible 11
    // words should produce a grade well under the patient-facing
    // target (very simple short-sentence text can score negative on
    // the FK formula — that's correct behaviour, not an error).
    expect(words).toBeGreaterThan(5)
    expect(grade).toBeLessThan(FK_TARGET)
  })

  it('syllable count: handles short words, silent-e, trailing -es/-ed', () => {
    // Proxy test — if the formula runs without throwing + returns a
    // plausible positive grade, the syllable counter is doing its job.
    const html = '<p>Shaped bottles baked bread inside sealed boxes filled lunches overnight.</p>'
    const { grade, syllables, words } = computeFkGrade(html)
    expect(syllables).toBeGreaterThan(words)   // most words > 1 syllable here
    expect(grade).toBeGreaterThan(0)
  })
})

describe('isFkGatedType / FK_GATED_TYPES', () => {
  it('matches patient-facing types: pil, eu_ctr_pls', () => {
    expect(isFkGatedType('pil')).toBe(true)
    expect(isFkGatedType('eu_ctr_pls')).toBe(true)
  })

  it('does not gate HCP / professional types', () => {
    expect(isFkGatedType('hcp_slide_deck')).toBe(false)
    expect(isFkGatedType('mi_letter')).toBe(false)
    expect(isFkGatedType('cme_module')).toBe(false)
    expect(isFkGatedType('disease_dossier')).toBe(false)
    expect(isFkGatedType('advisory_report')).toBe(false)
  })

  it('exposes the cutoff grade and gated-types set as constants', () => {
    expect(FK_TARGET).toBe(8.0)
    expect(FK_GATED_TYPES.has('pil')).toBe(true)
    expect(FK_GATED_TYPES.size).toBeLessThan(5)
  })
})
