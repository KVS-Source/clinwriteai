// Text extraction helpers for AI chat source attachments.
//
// Given a buffer + content-type, return readable text so the LLM can
// use the uploaded file as context. Supported today:
//
//   text/plain, text/markdown, text/csv, application/json
//     Decoded directly as UTF-8.
//
//   application/pdf
//     Parsed with pdf-parse. Returns the extracted text; silent-degrades
//     to '' on parse failure (image-only PDFs, encrypted, corrupted).
//
//   application/vnd.openxmlformats-officedocument.wordprocessingml.document
//   application/msword (treated best-effort)
//     Parsed with mammoth → raw text.
//
// Unknown types → '' + a reason the caller can surface. All extractions
// are size-capped (default 100KB of text per file) so a 500-page CSR
// doesn't blow out the token budget.

const DEFAULT_MAX_CHARS = 100_000

export interface ExtractResult {
  ok:       boolean
  text:     string
  /** Human-readable reason the extraction fell short (empty on success). */
  reason:   string
  /** Original byte size (whole file, before truncation). */
  bytes:    number
  /** Chars actually returned after the max-chars cap. */
  returned: number
}

const TEXT_LIKE_PREFIXES = ['text/', 'application/json', 'application/xml']

export async function extractTextFromBlob(
  buffer: Buffer,
  contentType: string | null,
  opts: { maxChars?: number } = {},
): Promise<ExtractResult> {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const type = (contentType ?? '').toLowerCase()
  const bytes = buffer.length

  // ---- Plain text / markdown / csv / json ----
  if (TEXT_LIKE_PREFIXES.some(p => type.startsWith(p))) {
    const text = buffer.toString('utf8')
    const truncated = text.length > maxChars ? text.slice(0, maxChars) : text
    return {
      ok: true,
      text: truncated,
      reason: text.length > maxChars ? `truncated to ${maxChars} chars (file is ${text.length} chars)` : '',
      bytes,
      returned: truncated.length,
    }
  }

  // ---- PDF ----
  if (type === 'application/pdf' || type === 'application/x-pdf') {
    try {
      const pdfParseMod = await import('pdf-parse') as unknown as {
        default?: (b: Buffer) => Promise<{ text: string }>
      } & ((b: Buffer) => Promise<{ text: string }>)
      const pdfParse = pdfParseMod.default ?? pdfParseMod
      const parsed = await pdfParse(buffer)
      const text = (parsed.text ?? '').trim()
      if (text.length === 0) {
        return {
          ok: false,
          text: '',
          reason: 'PDF had no extractable text (image-only or scanned document)',
          bytes,
          returned: 0,
        }
      }
      const truncated = text.length > maxChars ? text.slice(0, maxChars) : text
      return {
        ok: true,
        text: truncated,
        reason: text.length > maxChars ? `truncated to ${maxChars} chars (full file is ${text.length})` : '',
        bytes,
        returned: truncated.length,
      }
    } catch (err) {
      return {
        ok: false,
        text: '',
        reason: `PDF parse failed: ${err instanceof Error ? err.message : String(err)}`,
        bytes,
        returned: 0,
      }
    }
  }

  // ---- DOCX / DOC ----
  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    type === 'application/msword'
  ) {
    try {
      const mammoth = await import('mammoth')
      const parsed = await mammoth.extractRawText({ buffer })
      const text = (parsed.value ?? '').trim()
      if (text.length === 0) {
        return {
          ok: false,
          text: '',
          reason: 'Word document had no extractable text',
          bytes,
          returned: 0,
        }
      }
      const truncated = text.length > maxChars ? text.slice(0, maxChars) : text
      return {
        ok: true,
        text: truncated,
        reason: text.length > maxChars ? `truncated to ${maxChars} chars (full file is ${text.length})` : '',
        bytes,
        returned: truncated.length,
      }
    } catch (err) {
      return {
        ok: false,
        text: '',
        reason: `Word parse failed: ${err instanceof Error ? err.message : String(err)}`,
        bytes,
        returned: 0,
      }
    }
  }

  return {
    ok: false,
    text: '',
    reason: `unsupported content-type "${type || 'unknown'}" — only PDF, Word, and plain text are extracted today`,
    bytes,
    returned: 0,
  }
}
