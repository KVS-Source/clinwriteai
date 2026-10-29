// S3 user metadata must be ASCII or the request signature fails (voice notes
// carry a '§…' section ref, documents can carry non-English filenames).

import { describe, expect, it } from 'vitest'
import { asciiMetadata } from './s3-storage.js'

describe('asciiMetadata', () => {
  it('leaves plain ASCII values unchanged', () => {
    expect(asciiMetadata({ projectId: 'proj-1', originalFilename: 'SAP v2.0 (final).pdf' }))
      .toEqual({ projectId: 'proj-1', originalFilename: 'SAP v2.0 (final).pdf' })
  })

  it('URI-encodes values with non-ASCII characters', () => {
    const out = asciiMetadata({ sectionRef: '§2 Narrative Index', originalFilename: 'Protocolo – versión 2.pdf' })
    expect(out.sectionRef).toBe('%C2%A72%20Narrative%20Index')
    expect(decodeURIComponent(out.originalFilename)).toBe('Protocolo – versión 2.pdf')
    expect(Object.values(out).every(v => /^[\x20-\x7E]*$/.test(v))).toBe(true)
  })
})
