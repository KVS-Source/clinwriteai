// Must-preserve manifest extractor + diff — pure regex, pure diff.
// This is the hallucination firewall. Correctness here is load-bearing:
// a false negative here means the AI drops a reference silently; a false
// positive means we trigger a retry we didn't need and burn tokens.

import { describe, expect, it } from 'vitest'
import {
  acronymsUsed,
  diff,
  EMPTY_MANIFEST,
  extractManifest,
  renderForPrompt,
} from './must-preserve.js'

describe('extractManifest — citation markers', () => {
  it('captures [N], [Smith 2023], [Smith et al., 2023a], [Ref-X], [cite:…] styles', () => {
    const html = `<p>See [1], [Smith 2023], [Smith et al., 2023a], [Ref-12], [cite:p_ab12], and (Jones 2020).</p>`
    const m = extractManifest(html)
    expect(m.citationMarkers).toEqual(
      expect.arrayContaining(['[1]', '[Smith 2023]', '[Smith et al., 2023a]', '[Ref-12]', '[cite:p_ab12]', '(Jones 2020)'])
    )
  })

  it('captures ranged / list citations', () => {
    const html = `<p>Evidence from [1-3] and [2,5,7] supports this.</p>`
    const m = extractManifest(html)
    expect(m.citationMarkers).toEqual(expect.arrayContaining(['[1-3]', '[2,5,7]']))
  })
})

describe('extractManifest — cross-references', () => {
  it('captures §x.y.z, Section N, Table N, Figure N, Appendix A, Fig. N', () => {
    const html = `<p>Refer to §4.2.1 and Section 11.4; the results are in Table 3 and Figure 2.1. Baseline data appears in Appendix A. Secondary endpoints in Fig. 2.</p>`
    const m = extractManifest(html)
    expect(m.crossRefs).toEqual(expect.arrayContaining(['§4.2.1', 'Section 11.4', 'Table 3', 'Figure 2.1', 'Appendix A', 'Fig. 2']))
  })
})

describe('extractManifest — numeric values', () => {
  it('captures values with units and statistical operators, with context', () => {
    const html = `<p>The dose was 25 mg/kg daily for 12 weeks in n=120 subjects (p<0.05, 95% CI).</p>`
    const m = extractManifest(html)
    const raws = m.numbers.map(n => n.raw)
    expect(raws).toEqual(expect.arrayContaining(['25 mg/kg', '12 weeks', 'n=120', 'p<0.05', '95% CI']))
    for (const n of m.numbers) expect(n.context.length).toBeGreaterThan(0)
  })

  it('skips bare numbers without units or operators (avoids flooding)', () => {
    const html = `<p>Patient 5 completed 3 visits.</p>`
    const m = extractManifest(html)
    expect(m.numbers).toEqual([])
  })
})

describe('extractManifest — study identifiers', () => {
  it('captures NCT, EudraCT, IND, generic Protocol/Study IDs', () => {
    const html = `<p>Registered as NCT01234567 and EudraCT 2026-000001-00. US IND 54321. Study ID AB-2026-04 referenced on the cover.</p>`
    const m = extractManifest(html)
    expect(m.studyIds).toEqual(expect.arrayContaining(['NCT01234567', 'EudraCT 2026-000001-00', 'IND 54321', 'Study ID AB-2026-04']))
  })
})

describe('extractManifest — defined acronyms', () => {
  it('captures only acronyms defined with an expansion in parentheses', () => {
    const html = `<p>Adverse event (AE) and serious AE (SAE) definitions apply. ALT was elevated. AST stayed normal.</p>`
    const m = extractManifest(html)
    expect(m.acronyms).toEqual(expect.arrayContaining(['AE', 'SAE']))
    expect(m.acronyms).not.toContain('ALT')
    expect(m.acronyms).not.toContain('AST')
  })
})

describe('extractManifest — robust to HTML noise', () => {
  it('handles tags, entities, lists and empty input', () => {
    expect(extractManifest('')).toEqual(EMPTY_MANIFEST)
    const html = `<ul><li>Dose: 50&nbsp;mg daily.</li></ul><p>See &sect;4.2.</p>`
    const m = extractManifest(html)
    expect(m.numbers.length).toBeGreaterThan(0)
  })

  it('does not match across tag boundaries that would create false citations', () => {
    const html = `<p>text [</p><p>1] text</p>`
    const m = extractManifest(html)
    expect(m.citationMarkers).not.toContain('[1]')
  })
})

describe('renderForPrompt', () => {
  it('returns empty string on an empty manifest', () => {
    expect(renderForPrompt(EMPTY_MANIFEST)).toBe('')
  })

  it('renders every non-empty category with the preservation directive', () => {
    const m = extractManifest(`<p>See §4.2 and [1]. Dose 10 mg. NCT12345678. Adverse event (AE).</p>`)
    const out = renderForPrompt(m)
    expect(out).toContain('MUST PRESERVE')
    expect(out).toContain('§4.2')
    expect(out).toContain('[1]')
    expect(out).toContain('10 mg')
    expect(out).toContain('NCT12345678')
    expect(out).toContain('Do NOT drop')
    expect(out).toContain('Do NOT invent new citations')
  })

  it('caps numeric values at 40 with an overflow count', () => {
    // Build a body with 50 unique mg values
    const spans = Array.from({ length: 50 }, (_, i) => `<span>${i + 1} mg/kg</span>`).join(' ')
    const m = extractManifest(spans)
    const out = renderForPrompt(m)
    expect(out).toMatch(/\+10 more/)
  })
})

describe('diff — catches dropped citations, cross-refs, numbers; flags undefined acronyms', () => {
  it('reports dropped citations and dropped cross-refs', () => {
    const before = extractManifest(`<p>See [1], [Smith 2023], §4.2, Table 3.</p>`)
    const afterHtml = `<p>See [1].</p>`
    const d = diff(before, afterHtml)
    expect(d.droppedCitations).toEqual(expect.arrayContaining(['[Smith 2023]']))
    expect(d.droppedCrossRefs).toEqual(expect.arrayContaining(['§4.2', 'Table 3']))
  })

  it('reports dropped numbers with their original context', () => {
    const before = extractManifest(`<p>Dosed 25 mg/kg in n=120 subjects.</p>`)
    const afterHtml = `<p>Dosed 25 mg/kg.</p>`
    const d = diff(before, afterHtml)
    expect(d.changedNumbers.length).toBeGreaterThan(0)
    const dropped = d.changedNumbers.find(c => c.was === 'n=120')
    expect(dropped).toBeTruthy()
    expect(dropped!.context).toMatch(/subjects/)
  })

  it('flags acronyms used in after that were never defined', () => {
    const before = extractManifest(`<p>Adverse event (AE) in subjects.</p>`)
    const afterHtml = `<p>Adverse event (AE) and ECG and PRO measurements.</p>`
    const d = diff(before, afterHtml)
    expect(d.newUndefinedAcronyms).toEqual(expect.arrayContaining(['ECG', 'PRO']))
    expect(d.newUndefinedAcronyms).not.toContain('AE')
  })

  it('separates new citations from preserved ones', () => {
    const before = extractManifest(`<p>See [1].</p>`)
    const afterHtml = `<p>See [1] and [Smith 2023].</p>`
    const d = diff(before, afterHtml)
    expect(d.newCitations).toEqual(['[Smith 2023]'])
    expect(d.droppedCitations).toEqual([])
  })

  it('does not flag common allowlist tokens (FDA, EMA, US) as undefined acronyms', () => {
    const before = extractManifest(`<p>Baseline.</p>`)
    const afterHtml = `<p>The FDA and EMA both approved the US submission.</p>`
    const d = diff(before, afterHtml)
    expect(d.newUndefinedAcronyms).not.toContain('FDA')
    expect(d.newUndefinedAcronyms).not.toContain('EMA')
    expect(d.newUndefinedAcronyms).not.toContain('US')
  })
})

describe('acronymsUsed — low-level helper', () => {
  it('returns uniq acronym tokens excluding the common allowlist', () => {
    expect(acronymsUsed('AE and SAE occurred; the FDA was notified.')).toEqual(expect.arrayContaining(['AE', 'SAE']))
    expect(acronymsUsed('AE and SAE occurred; the FDA was notified.')).not.toContain('FDA')
  })
})
