// Relevant pages per section. When a build plan asks for it (sourcePages) and the sources are long, each section is
// sent only the source pages that match it, word for word with their page numbers, instead of every file. The
// study facts reach every section through the fact sheet, so a page a search misses costs detail, never a key fact,
// and what the section can't support becomes [TBD].
//
// Matching is a keyword ranking (BM25) of every page against the section's title, its template instructions and
// guidance. Pages without text (scans) can't be ranked; they are sent to every section as PDF pages, the same set
// each time so the model can cache them.

import { exampleTitle } from './source-files.js'
import type { IndexedSource } from './fact-sheet.js'
import type { SourceBlock } from './source-blocks.js'

const STOP = new Set(('the and for with that this from are was were will shall should must may can not any all its into per '
  + 'section study protocol include including describe describes each other such than then there their these those which who '
  + 'whom what when where how also been being have has had use used using within without about above below between').split(' '))

const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(w => !STOP.has(w))

/** Protocols name the same things differently; a section title's word also finds these (at the lower weight). */
const SYNONYMS: Record<string, string[]> = {
  intervention: ['treatment', 'drug', 'dose', 'dosing', 'administration'],
  participants: ['subjects', 'patients'],
  participant: ['subject', 'patient'],
  benefit: ['risk', 'benefits', 'risks'],
  withdrawal: ['discontinuation', 'withdraw'],
  concomitant: ['prohibited', 'permitted', 'medications'],
  adherence: ['compliance'],
  pharmacokinetic: ['pharmacokinetics'],
  aesis: ['special', 'interest'],
  hypotheses: ['hypothesis', 'power'],
}

export interface PageRef { no: number; page: number }

type TokenisedPage = { no: number; page: number; text: string; plain: string; length: number; counts: Map<string, number> }

/** Lower case, anything but letters and digits as single spaces: for phrase matching. */
const flat = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `

/**
 * A table of contents (or list of tables) names every heading, so it would outrank the pages that hold the
 * content. It is recognised by its many lines ending in a page number after dot leaders or a wide gap.
 */
export function isContentsPage(text: string): boolean {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const entries = lines.filter(l => /(\.{3,}|…{2,}|\s{3,})\s*\d{1,3}$/.test(l) || /^\d+(\.\d+)*\.?\s+\S.*\s\d{1,3}$/.test(l)).length
  return entries >= 8 && entries >= lines.length * 0.3
}
const tokenCache = new WeakMap<IndexedSource[], TokenisedPage[]>()

/** Each page with text and its word counts, worked out once per set of sources (every section ranks the same pages). */
function tokenised(sources: IndexedSource[]): TokenisedPage[] {
  const cached = tokenCache.get(sources)
  if (cached) return cached
  const out = sources.flatMap(s => s.pages.map((text, i) => ({ no: s.no, page: i + 1, text })))
    .filter(p => p.text.trim().length >= 20 && !isContentsPage(p.text))
    .map(p => {
      const ws = words(p.text)
      const counts = new Map<string, number>()
      for (const w of ws) counts.set(w, (counts.get(w) ?? 0) + 1)
      return { ...p, plain: flat(p.text), length: ws.length, counts }
    })
  tokenCache.set(sources, out)
  return out
}

/**
 * The best-matching pages for a section, highest first, within a character budget. `title` is the section's title:
 * a page with it as a phrase (usually its heading) ranks well above pages that only share its words. `context` (the
 * template's instructions and guidance) adds words of lower weight.
 */
export function rankPages(sources: IndexedSource[], title: string, budgetChars: number, context = ''): PageRef[] {
  const titleTerms = new Set(words(title))
  const synonyms = [...titleTerms].flatMap(t => SYNONYMS[t] ?? [])
  const terms = [...new Set([...titleTerms, ...words(context), ...synonyms])]
  if (terms.length === 0) return []
  const pages = tokenised(sources)
  if (pages.length === 0) return []
  const avg = pages.reduce((n, p) => n + p.length, 0) / pages.length
  const df = new Map(terms.map(t => [t, pages.filter(p => p.counts.has(t)).length]))
  const k1 = 1.2, b = 0.75
  const scored = pages.map(p => {
    let score = 0
    for (const t of terms) {
      const tf = p.counts.get(t) ?? 0
      if (!tf) continue
      const idf = Math.log(1 + (pages.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
      score += (titleTerms.has(t) ? 1 : 0.3) * idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * p.length / avg))
    }
    const phrase = flat(title)
    if (phrase.trim().length >= 4 && p.plain.includes(phrase)) score *= 3
    return { ...p, score }
  }).filter(p => p.score > 0).sort((x, y) => y.score - x.score)

  const out: PageRef[] = []
  let used = 0
  for (const p of scored) {
    if (used + p.text.length > budgetChars) continue
    used += p.text.length
    out.push({ no: p.no, page: p.page })
  }
  return out
}

/** The chosen pages as one text block per source, pages in order, each under its page number. */
export function pageBlocks(sources: IndexedSource[], refs: PageRef[]): SourceBlock[] {
  return sources.flatMap((s): SourceBlock[] => {
    const pages = refs.filter(r => r.no === s.no).map(r => r.page).sort((a, b) => a - b)
    if (pages.length === 0) return []
    const title = `${s.example ? exampleTitle(s.title) : s.title} (pages ${pages.join(', ')})`.slice(0, 480)
    return [{ type: 'document', title, source: { type: 'text', media_type: 'text/plain', data: pages.map(p => `[Page ${p}]\n${s.pages[p - 1]!.trim()}`).join('\n\n') } }]
  })
}

/** Pages without text, per source (1-based). */
export const scannedPages = (s: IndexedSource) => s.pages.flatMap((t, i) => (t.trim().length < 20 ? [i + 1] : []))
