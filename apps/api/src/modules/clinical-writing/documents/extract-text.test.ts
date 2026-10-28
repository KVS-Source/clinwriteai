import { describe, expect, it } from 'vitest'
import { extractTextFromBlob } from './extract-text.js'

const txt = (s: string) => Buffer.from(s, 'utf8')

describe('extractTextFromBlob — text-like types', () => {
  it('decodes text/plain as UTF-8', async () => {
    const r = await extractTextFromBlob(txt('hello world'), 'text/plain')
    expect(r.ok).toBe(true)
    expect(r.text).toBe('hello world')
    expect(r.reason).toBe('')
  })

  it('decodes text/markdown', async () => {
    const r = await extractTextFromBlob(txt('# Heading\n\nBody'), 'text/markdown')
    expect(r.ok).toBe(true)
    expect(r.text).toContain('# Heading')
  })

  it('decodes application/json', async () => {
    const r = await extractTextFromBlob(txt('{"a":1}'), 'application/json')
    expect(r.ok).toBe(true)
    expect(r.text).toBe('{"a":1}')
  })

  it('truncates at maxChars and reports the full size in reason', async () => {
    const big = 'x'.repeat(1000)
    const r = await extractTextFromBlob(txt(big), 'text/plain', { maxChars: 100 })
    expect(r.ok).toBe(true)
    expect(r.text).toHaveLength(100)
    expect(r.reason).toContain('truncated to 100 chars')
    expect(r.reason).toContain('1000')
    expect(r.returned).toBe(100)
    expect(r.bytes).toBe(1000)
  })
})

describe('extractTextFromBlob — unknown / unsupported', () => {
  it('returns a reason for an unsupported content type', async () => {
    const r = await extractTextFromBlob(txt('binary bytes'), 'image/png')
    expect(r.ok).toBe(false)
    expect(r.text).toBe('')
    expect(r.reason).toContain('unsupported content-type')
    expect(r.reason).toContain('image/png')
  })

  it('handles null content-type gracefully', async () => {
    const r = await extractTextFromBlob(txt('something'), null)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('unknown')
  })

  it('handles bogus PDF bytes without throwing', async () => {
    // Not a real PDF — pdf-parse rejects it; we want graceful fail, not a 500.
    const r = await extractTextFromBlob(txt('not a pdf at all'), 'application/pdf')
    expect(r.ok).toBe(false)
    expect(r.text).toBe('')
    expect(r.reason).toContain('PDF')
  })
})
