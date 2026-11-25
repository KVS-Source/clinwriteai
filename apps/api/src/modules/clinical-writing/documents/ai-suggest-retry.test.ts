// Tests for the retry orchestration. No real AI calls — the `call`
// function is a stub so we can script the model's output per attempt.

import { describe, expect, it, vi } from 'vitest'
import { callWithValidation, type AiSuggestCall } from './ai-suggest-retry.js'
import { extractManifest } from './must-preserve.js'

const bodyWithRefs = `
  <p>See §4.2.1, Table 3, and [Smith 2023]. Dose 25 mg/kg in n=120 (p<0.05). NCT12345678.</p>
`.trim()

describe('callWithValidation', () => {
  it('passes through on a clean first attempt — no retry', async () => {
    const call: AiSuggestCall = vi.fn(async () => ({ html: bodyWithRefs }))
    const result = await callWithValidation({
      call,
      manifestBefore:  extractManifest(bodyWithRefs),
      attachedSources: {},
    })
    expect(result.retried).toBe(false)
    expect(result.flags).toEqual([])
    expect(call).toHaveBeenCalledTimes(1)
    expect(result.trace).toHaveLength(1)
    expect(result.trace[0]!.attempt).toBe(1)
  })

  it('retries once when the first attempt drops a cross-ref, succeeds on attempt 2', async () => {
    const calls: Array<{ attempt: number; prepend: string | undefined }> = []
    const call: AiSuggestCall = async ({ prependPrompt, attempt }) => {
      calls.push({ attempt, prepend: prependPrompt })
      if (attempt === 1) {
        // Drops §4.2.1
        return { html: `<p>See Table 3 and [Smith 2023]. Dose 25 mg/kg in n=120 (p<0.05). NCT12345678.</p>` }
      }
      // Restores the dropped ref
      return { html: bodyWithRefs }
    }
    const result = await callWithValidation({
      call,
      manifestBefore:  extractManifest(bodyWithRefs),
      attachedSources: {},
    })
    expect(result.retried).toBe(true)
    expect(result.flags).toEqual([])
    expect(calls).toHaveLength(2)
    expect(calls[0]!.prepend).toBeUndefined()
    expect(calls[1]!.prepend).toBeTruthy()
    expect(calls[1]!.prepend!).toContain('§4.2.1')
    expect(result.trace).toHaveLength(2)
    expect(result.trace[0]!.retriedBecause).toBeTruthy()
    expect(result.trace[1]!.attempt).toBe(2)
  })

  it('returns attempt-2 HTML + its flags when retry ALSO fails (no third attempt)', async () => {
    const call: AiSuggestCall = vi.fn(async () => ({
      // Both attempts drop §4.2.1
      html: `<p>See Table 3. Dose 25 mg/kg. [Smith 2023]. NCT12345678.</p>`,
    }))
    const result = await callWithValidation({
      call,
      manifestBefore:  extractManifest(bodyWithRefs),
      attachedSources: {},
    })
    expect(result.retried).toBe(true)
    expect(call).toHaveBeenCalledTimes(2)   // exactly 2 — never 3
    expect(result.flags).toContain('dropped_cross_ref')
    expect(result.trace).toHaveLength(2)
  })

  it('does NOT retry on soft-only failures (number_drift, undefined_acronym)', async () => {
    const call: AiSuggestCall = vi.fn(async () => ({
      // Keeps all refs, but drops n=120 and introduces ECG (undefined acronym)
      html: `<p>See §4.2.1, Table 3, and [Smith 2023]. Dose 25 mg/kg. ECG recorded. NCT12345678.</p>`,
    }))
    const result = await callWithValidation({
      call,
      manifestBefore:  extractManifest(bodyWithRefs),
      attachedSources: {},
    })
    expect(result.retried).toBe(false)
    expect(call).toHaveBeenCalledTimes(1)
    expect(result.flags).toEqual(expect.arrayContaining(['number_drift', 'undefined_acronym']))
    expect(result.flags).not.toContain('dropped_cross_ref')
    expect(result.flags).not.toContain('invented_citation')
  })

  it('retries on invented_citation when the surname is not in attached sources', async () => {
    const before = extractManifest(`<p>Earlier work demonstrated the effect.</p>`)
    const call: AiSuggestCall = vi.fn(async ({ attempt }) => ({
      html: attempt === 1
        ? `<p>Earlier work demonstrated the effect [Jones 2024].</p>`
        : `<p>Earlier work demonstrated the effect.</p>`,
    }))
    const result = await callWithValidation({
      call,
      manifestBefore:  before,
      attachedSources: { authorSurnames: ['Smith'] },
    })
    expect(result.retried).toBe(true)
    expect(call).toHaveBeenCalledTimes(2)
    expect(result.flags).toEqual([])
  })
})
