// Turns source PDFs into Claude content blocks, however many pages they have.
//
// Claude takes at most 600 PDF pages per request (100 on 200k-context models), and each PDF page costs several times
// its text. Plain-text documents have no page limit, so once the attached PDFs go past PDF_PAGES_AS_IS the longest ones
// are sent as text, every page included. Their pages without any text (figures, scans) are still sent as PDF pages.

export const PDF_PAGES_AS_IS = 100
const MAX_PDF_PAGES = 600
const MIN_PAGE_CHARS = 20
// Rough sizes, only for telling the writer up front that the sources can't fit the model at all.
const CHARS_PER_TOKEN = 3.5
const TOKENS_PER_PDF_PAGE = 2500
const RESERVED_TOKENS = 40_000

export interface SourcePdf { title: string; bytes: Buffer }

export type SourceBlock = {
  type:   'document'
  title:  string
  source:
    | { type: 'base64'; media_type: 'application/pdf'; data: string }
    | { type: 'text'; media_type: 'text/plain'; data: string }
  cache_control?: { type: 'ephemeral' }
}

export interface SourceBlocks {
  blocks:    SourceBlock[]
  /** Long sources: the blocks end in a cache breakpoint, so whatever precedes them must not vary between calls. */
  cached:    boolean
  asText:    Array<{ title: string; pages: number; pdfPages: number }>
  pages:     number
}

/** The sources can't be sent to this model in any form; the message says why. */
export class SourcesTooLongError extends Error {}

const contextTokens = (model: string) => (/haiku-4|sonnet-4-[05]|opus-4-[015]|claude-3/.test(model) ? 200_000 : 1_000_000)
const maxPdfPages = (model: string) => (contextTokens(model) < 1_000_000 ? 100 : MAX_PDF_PAGES)

async function pageTexts(bytes: Buffer): Promise<string[]> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(bytes) })
  try {
    return (await parser.getText({ pageJoiner: '' })).pages.map(p => p.text.trim())
  } finally {
    await parser.destroy()
  }
}

async function onlyPages(bytes: Buffer, indexes: number[]): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib')
  const from = await PDFDocument.load(bytes)
  const out = await PDFDocument.create()
  for (const page of await out.copyPages(from, indexes)) out.addPage(page)
  return Buffer.from(await out.save())
}

const pdfBlock = (title: string, bytes: Buffer): SourceBlock => ({
  type: 'document', title, source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') },
})

export async function buildSourceBlocks(sources: SourcePdf[], model: string): Promise<SourceBlocks> {
  // A file whose pages can't be read here is sent as it is; Claude may still read it.
  const texts: Array<string[] | null> = []
  for (const s of sources) texts.push(await pageTexts(s.bytes).catch(() => null))

  const total = texts.reduce((n, t) => n + (t?.length ?? 0), 0)
  const convert = new Set<number>()
  let left = total
  for (const [i, t] of [...texts.entries()].sort((a, b) => (b[1]?.length ?? 0) - (a[1]?.length ?? 0))) {
    if (left <= PDF_PAGES_AS_IS) break
    if (!t || t.every(p => p.length < MIN_PAGE_CHARS)) continue
    convert.add(i)
    left -= t.length
  }

  const blocks: SourceBlock[] = []
  const asText: SourceBlocks['asText'] = []
  let pdfPages = 0
  let chars = 0
  for (const [i, s] of sources.entries()) {
    const t = texts[i]
    if (!t || !convert.has(i)) {
      blocks.push(pdfBlock(s.title, s.bytes))
      pdfPages += t?.length ?? 0
      continue
    }
    const noText = t.flatMap((p, n) => (p.length < MIN_PAGE_CHARS ? [n] : []))
    // A protected file can't be split; its text is still sent, with the missing pages named.
    const rest = noText.length ? await onlyPages(s.bytes, noText).catch(() => null) : null
    const data = t.map((p, n) => `[Page ${n + 1}]\n${p.length < MIN_PAGE_CHARS ? (rest ? '(attached separately as a PDF page)' : '(no text on this page)') : p}`).join('\n\n')
    blocks.push({ type: 'document', title: s.title, source: { type: 'text', media_type: 'text/plain', data } })
    chars += data.length
    if (rest) {
      blocks.push(pdfBlock(`${s.title} (its pages ${noText.map(n => n + 1).join(', ')})`.slice(0, 480), rest))
      pdfPages += noText.length
    }
    asText.push({ title: s.title, pages: t.length, pdfPages: rest ? noText.length : 0 })
  }

  if (pdfPages > maxPdfPages(model)) {
    throw new SourcesTooLongError(`${pdfPages} scanned pages have no readable text, and the AI accepts at most ${maxPdfPages(model)} of those at once. Attach searchable (text) PDFs instead.`)
  }
  const tokens = Math.round(chars / CHARS_PER_TOKEN + pdfPages * TOKENS_PER_PDF_PAGE)
  if (asText.length > 0 && tokens > contextTokens(model) - RESERVED_TOKENS) {
    throw new SourcesTooLongError(`The sources are about ${tokens.toLocaleString('en-US')} tokens (${total} pages), more than ${model} can read at once (${contextTokens(model).toLocaleString('en-US')}).`)
  }

  const cached = asText.length > 0
  if (cached) blocks[blocks.length - 1]!.cache_control = { type: 'ephemeral' }
  return { blocks, cached, asText, pages: total }
}

/** All input tokens of a call, and how many of them came from the cache (Claude's input_tokens leaves both cache counts out). */
export function inputUsage(usage: { input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | undefined): { inputTokens: number; cachedTokens: number } {
  const cachedTokens = usage?.cache_read_input_tokens ?? 0
  return { inputTokens: (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + cachedTokens, cachedTokens }
}
