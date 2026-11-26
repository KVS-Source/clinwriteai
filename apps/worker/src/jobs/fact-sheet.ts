// The study fact sheet: the key facts of the study (title, protocol number, drug, dose, population, sample size,
// endpoints …), extracted once at the start of a draft from the EVIDENCE sources, each with its file, page and an
// exact quote. Code then looks for every quote in that file's text; a fact whose quote isn't there, whose numbers
// aren't in its quote, or that came from an example source becomes [TBD] and is flagged. Every section is drafted
// with the checked values, so the same facts appear everywhere and none is invented.
//
// Which facts a document type has comes from its build plan (factSheet.fields). The sheet is stored on the document
// (documents.fact_sheet) and reused by later runs (resume, targeted re-drafts) while the sources stay the same.

import { pageTexts } from './source-blocks.js'

export interface FactField { key: string; label: string; hint?: string }

export type FactStatus = 'verified' | 'not_stated' | 'failed_check'

export interface Fact {
  key:     string
  label:   string
  /** The checked value; '[TBD]' unless status is 'verified'. */
  value:   string
  status:  FactStatus
  source?: { id: string; title: string; page: number | null }
  quote?:  string
  /** Why the fact is not used (failed_check), or what the model said it found. */
  reason?: string
  /** The value the model gave, kept when the check failed so the writer can look at it. */
  claimed?: string
}

export interface FactSheet {
  extractedAt: string
  model:       string
  /** The sources it was extracted from; a different set means it is extracted again. */
  sourceIds:   string[]
  facts:       Fact[]
}

/** One source's text by page (PDF pages; Word and text files in parts of about 3,000 characters). */
export interface IndexedSource {
  no:    number                 // 1-based, as numbered in the prompt's source list
  id:    string
  title: string
  example: boolean
  pages: string[]               // '' for a page without text
}

const PART_CHARS = 3000

export async function indexSources(sources: Array<{ id: string; title: string; bytes: Buffer; text?: string; example: boolean }>): Promise<IndexedSource[]> {
  const out: IndexedSource[] = []
  for (const [i, s] of sources.entries()) {
    let pages: string[]
    if (s.text !== undefined) {
      const plain = s.text.replace(/<[^>]+>/g, ' ')
      pages = []
      for (let at = 0; at < plain.length; at += PART_CHARS) pages.push(plain.slice(at, at + PART_CHARS))
    } else {
      pages = await pageTexts(s.bytes).catch(() => [])
    }
    out.push({ no: i + 1, id: s.id, title: s.title, example: s.example, pages })
  }
  return out
}

export function factSheetPrompt(fields: FactField[], sources: IndexedSource[]): string {
  return [
    'Extract the key facts of THIS study from the attached sources, for a study fact sheet that every section of the document will use.',
    `Sources:\n${sources.map(s => `${s.no}. ${s.title}${s.example ? ' (EXAMPLE: never take facts from it)' : ' (EVIDENCE)'}`).join('\n')}`,
    'Rules:',
    '- Use only EVIDENCE sources. Sources marked EXAMPLE are samples or other studies; never take a fact from them.',
    '- value: the fact as the source states it, short (a phrase or one sentence). Do not combine, convert or calculate.',
    '- source: the number of the source it is in. page: its page number (the [Page n] marker, or the PDF page).',
    '- quote: the exact words from that page that state it, copied character for character, 5 to 40 words, including the value itself.',
    '- If the evidence does not state a fact, give value "TBD" with no quote. Never guess, never use general knowledge.',
    `Facts:\n${fields.map(f => `- ${f.key}: ${f.label}${f.hint ? ` (${f.hint})` : ''}`).join('\n')}`,
    'Answer with only a JSON array, one object per fact, in this form and nothing else:',
    '[{"key":"<key>","value":"<value or TBD>","source":<number or null>,"page":<number or null>,"quote":"<exact quote or empty>"}]',
  ].join('\n\n')
}

interface Answer { key: string; value: string; source: number | null; page: number | null; quote: string }

export function parseFactAnswer(text: string): Answer[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let raw: unknown
  try { raw = JSON.parse(text.slice(start, end + 1)) } catch { return [] }
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r): Answer[] => {
    const o = (r ?? {}) as Record<string, unknown>
    if (typeof o.key !== 'string') return []
    return [{
      key: o.key,
      value: typeof o.value === 'string' ? o.value.trim().slice(0, 500) : '',
      source: typeof o.source === 'number' ? o.source : null,
      page: typeof o.page === 'number' ? o.page : null,
      quote: typeof o.quote === 'string' ? o.quote.trim().slice(0, 1000) : '',
    }]
  })
}

/** Lower case, every run of anything but letters and digits made one space, so line breaks and dashes don't matter. */
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** The numbers in a text: "1,200" and "1200" are the same number, "2,5" (decimal comma) is 2.5. */
const numbersIn = (s: string) =>
  (s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2').match(/\d+(?:[.,]\d+)?/g) ?? []).map(n => n.replace(',', '.'))
const isTbd = (v: string) => !v || /^\[?\s*(tbd|not stated|unknown|n\/?a|none)\b/i.test(v)

/** Where the quote is in the source: the cited page, a page next to it (or across the break), or anywhere. */
function findQuote(src: IndexedSource, quote: string, page: number | null): number | null {
  const q = norm(quote)
  if (!q) return null
  const at = (p: number) => (src.pages[p - 1] !== undefined && norm(src.pages[p - 1]!).includes(q) ? p : null)
  const across = (p: number) => (src.pages[p - 1] !== undefined && src.pages[p] !== undefined && norm(`${src.pages[p - 1]} ${src.pages[p]}`).includes(q) ? p : null)
  // A quote wholly on one page wins over one spanning a page break.
  const near = page ? [page, page - 1, page + 1] : []
  for (const p of near) if (at(p)) return p
  for (const p of near) if (across(p)) return p
  for (let p = 1; p <= src.pages.length; p++) if (at(p)) return p
  for (let p = 1; p <= src.pages.length; p++) if (across(p)) return p
  return null
}

/** Checks every answer in code; anything that can't be confirmed becomes [TBD] with the reason. */
export function verifyFacts(fields: FactField[], answers: Answer[], sources: IndexedSource[]): Fact[] {
  return fields.map((f): Fact => {
    const a = answers.find(x => x.key === f.key)
    const base = { key: f.key, label: f.label }
    if (!a || isTbd(a.value)) return { ...base, value: '[TBD]', status: 'not_stated' }
    const fail = (reason: string, src?: IndexedSource, page?: number | null): Fact => ({
      ...base, value: '[TBD]', status: 'failed_check', reason, claimed: a.value, quote: a.quote || undefined,
      ...(src ? { source: { id: src.id, title: src.title, page: page ?? a.page } } : {}),
    })
    const src = sources.find(s => s.no === a.source)
    if (!src) return fail('No source was named for it.')
    if (src.example) return fail('It was taken from an example source, which is never used for facts.', src)
    if (!a.quote) return fail('No quote was given to check it against.', src)
    const page = findQuote(src, a.quote, a.page)
    if (page === null) {
      const scanned = a.page !== null && src.pages[a.page - 1] !== undefined && src.pages[a.page - 1]!.trim().length < 20
      return fail(scanned ? 'Its page is a scan with no text, so the quote could not be checked.' : 'The quote was not found in the source.', src)
    }
    const quoteNumbers = new Set(numbersIn(a.quote))
    const missing = numbersIn(a.value).filter(n => !quoteNumbers.has(n))
    if (missing.length) return fail(`The number${missing.length === 1 ? '' : 's'} ${missing.join(', ')} in the value ${missing.length === 1 ? 'is' : 'are'} not in the quote.`, src, page)
    return { ...base, value: a.value, status: 'verified', source: { id: src.id, title: src.title, page }, quote: a.quote }
  })
}

/** The fact sheet as every section sees it. */
export function factSheetBlock(sheet: FactSheet): string {
  if (sheet.facts.length === 0) return ''
  return [
    'STUDY FACT SHEET (extracted from the evidence and checked against it). Wherever this section states one of these facts, use exactly this value. A value of [TBD] is not stated in the evidence: write [TBD: <the fact>] in its place, never a guess and never a value from an example source.',
    ...sheet.facts.map(f => `- ${f.label}: ${f.status === 'verified' ? f.value : '[TBD]'}${f.status === 'verified' && f.source ? ` (${f.source.title}${f.source.page ? `, p. ${f.source.page}` : ''})` : ''}`),
  ].join('\n')
}

export const sameSources = (sheet: FactSheet | null | undefined, ids: string[]) =>
  !!sheet && sheet.sourceIds.length === ids.length && [...sheet.sourceIds].sort().join() === [...ids].sort().join()

export function asFactSheet(raw: unknown): FactSheet | null {
  const s = raw as Partial<FactSheet> | null
  return s && Array.isArray(s.facts) && Array.isArray(s.sourceIds) ? (s as FactSheet) : null
}
