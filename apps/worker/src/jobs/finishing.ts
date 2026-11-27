// Finishing a drafted document in code, once drafting and the checking passes are done (build plan `finishing`).
// None of this is left to the AI, so none of it can be invented:
//
//   - Cross-references. Sections refer to each other as [XREF: 8.3]. Code checks the section exists in the template
//     and writes "Section 8.3"; anything else becomes [TBD: …] and the section is flagged (dropped_cross_ref).
//   - References. Sections cite published works as [REF: Smith 2021 | 2 | 45] (author and year, the source that
//     lists it, the page). Code finds the full entry in that EVIDENCE source, numbers the references in order of
//     first use (or author-year, per the policy), and writes the References section. A reference it can't find in
//     the evidence becomes [TBD: …] and the section is flagged (invented_citation).
//   - Abbreviations. Every abbreviation used must be spelled out somewhere ("Full Name (FN)"); undefined ones are
//     flagged (undefined_acronym). If the template has an abbreviations section, code writes the list.
//   - Contents. If the template has a contents section, code writes it from the template's headings.
//   - Fact consistency. The sample size and protocol number in every section are compared with the fact sheet;
//     a different value is flagged (number_drift).

import type { FactSheet, IndexedSource } from './fact-sheet.js'

export type ReferenceStyle = 'numbered' | 'author_year'

export interface FinishSection { id: string; number: string; title: string; html: string }

export interface FinishInput {
  /** Every template section, in template order, with its current text. */
  sections:      FinishSection[]
  /** The document's sources, indexed by page (examples are never used for references). */
  sources:       IndexedSource[]
  referenceStyle: ReferenceStyle
  factSheet:     FactSheet | null
  builtByCode:   Array<{ number: string; kind: string }>
  options:       { crossReferences?: boolean; references?: boolean; abbreviations?: boolean; factConsistency?: boolean }
}

export interface FinishReport {
  crossReferences: { resolved: number; broken: Array<{ section: string; target: string }> }
  references:      { cited: number; listed: number; notFound: Array<{ section: string; citation: string }> }
  abbreviations:   { defined: number; undefined: Array<{ acronym: string; sections: string[] }> }
  mismatches:      Array<{ section: string; fact: string; expected: string; found: string }>
}

export interface FinishResult {
  /** New text for the sections that changed. */
  html:   Map<string, string>
  /** Flags to add, per section id. */
  flags:  Map<string, string[]>
  report: FinishReport
}

const REF = /\[REF:\s*([^\]|]+?)\s*(?:\|\s*(\d+)\s*(?:\|\s*(?:p(?:age)?\.?\s*)?(\d+))?)?\s*\]/gi
const XREF = /\[XREF:\s*([^\]]+?)\s*\]/gi

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------------------------------------------------------------- cross-references

const xrefTarget = (target: string) => target.replace(/^(section|sect\.?|§)\s*/i, '').trim()

function resolveXref(target: string, sections: FinishSection[]): FinishSection | null {
  const t = xrefTarget(target)
  const byNumber = sections.find(s => s.number.trim() === t.replace(/\.$/, ''))
  if (byNumber) return byNumber
  const nt = norm(t)
  return sections.find(s => norm(s.title) === nt) ?? sections.find(s => nt.length >= 6 && norm(s.title).includes(nt)) ?? null
}

/**
 * A sub-heading the AI numbered inside a template section, e.g. "10.4.3 Secondary Efficacy Analyses" in §10.4: the
 * target number, when the nearest template section above it has that heading. Not there → null (still broken).
 */
function resolveSubHeading(target: string, sections: FinishSection[], htmlOf: (s: FinishSection) => string): string | null {
  const t = xrefTarget(target).replace(/\.$/, '')
  if (!/^\d+(\.\d+){2,}$/.test(t)) return null
  const parts = t.split('.')
  for (let n = parts.length - 1; n >= 1; n--) {
    const parent = sections.find(s => s.number.trim() === parts.slice(0, n).join('.'))
    if (!parent) continue
    // The number at the start of a heading: followed by its title, not by "]" (another marker) or more digits.
    const heading = new RegExp(`(^|\\s)${t.replace(/\./g, '\\.')}\\.?\\s+\\p{Lu}`, 'u')
    return heading.test(text(htmlOf(parent))) ? t : null
  }
  return null
}

// ---------------------------------------------------------------- references

/**
 * Resolve a [REF: ...] citation to a References-list entry.
 *
 * Two kinds of citation are supported:
 *
 *   1. DIRECT SOURCE citation — [REF: source | <N>] where N is the
 *      1-based index of the attached source. Returns that source's
 *      title verbatim, to be listed in the References section as
 *      "the attached source itself." Example: a protocol drafted from
 *      an exemplar protocol PDF cites the PDF with [REF: source | 1],
 *      and the References list carries the PDF's title. Example
 *      sources are never usable as direct-source citations.
 *
 *   2. LITERATURE citation (classical) — [REF: <Author> <Year> | <N> | <page>]
 *      where the finishing pass looks up the reference-list entry
 *      inside source N's page text. The author + year must both be
 *      extractable; sourceNo + page are optional and narrow the search.
 */
export function findReference(sources: IndexedSource[], citation: string, sourceNo: number | null, page: number | null): string | null {
  // (1) Direct source citation: literal "source" sentinel + a source number.
  if (citation.trim().toLowerCase() === 'source' && sourceNo !== null) {
    const src = sources.find(s => !s.example && s.no === sourceNo)
    return src ? src.title : null
  }
  // (2) Classical literature citation: Author + Year in a source's reference list.
  const year = citation.match(/\b(19|20)\d{2}[a-z]?\b/)?.[0]
  const author = citation.replace(/\b(19|20)\d{2}[a-z]?\b/g, ' ').match(/\p{Lu}[\p{L}'’-]+/u)?.[0]
  if (!year || !author) return null
  const evidence = sources.filter(s => !s.example && (sourceNo === null || s.no === sourceNo))
  for (const src of evidence) {
    const order = page && src.pages[page - 1] !== undefined ? [page, ...src.pages.map((_, i) => i + 1).filter(p => p !== page)] : src.pages.map((_, i) => i + 1)
    for (const p of order) {
      const entry = entryIn(src.pages[p - 1]!, author, year)
      if (entry) return entry
    }
  }
  return null
}

function entryIn(pageText: string, author: string, year: string): string | null {
  const lines = pageText.split('\n')
  // A reference-list entry starts with its author (after any "12." or "[12]"); a line that only mentions the
  // author mid-sentence is the text citing it, not the entry.
  // A numbered entry ("13. Global Initiative for Asthma. GINA report 2023.") may name the author anywhere.
  const name = author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startsWithAuthor = new RegExp(`^\\s*(?:\\[\\d+\\]|\\d+\\.)?\\s*${name}([^\\p{L}]|$)`, 'u')
  const numberedWithAuthor = new RegExp(`^\\s*(?:\\[\\d+\\]|\\d+\\.)\\s.*(^|[^\\p{L}])${name}([^\\p{L}]|$)`, 'u')
  for (let i = 0; i < lines.length; i++) {
    if (!startsWithAuthor.test(lines[i]!) && !numberedWithAuthor.test(lines[i]!)) continue
    // The entry runs on until the next entry starts ("13." / "[13]", or in an unnumbered list "Surname AB,"), a blank
    // line, or 6 lines.
    let entry = lines[i]!.trim()
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      const next = lines[j]!.trim()
      if (!next || /^(\[\d+\]|\d+\.)\s/.test(next) || /^\p{Lu}[\p{L}'’-]+,?\s+\p{Lu}{1,3}[,.]/u.test(next)) break
      entry += ` ${next}`
    }
    if (entry.includes(year)) return entry.replace(/^(\[\d+\]|\d+\.)\s*/, '').replace(/\s+/g, ' ').slice(0, 500)
  }
  return null
}

// ---------------------------------------------------------------- abbreviations

const DEFINITION = /((?:\p{L}[\p{L}'’-]*[\s-]+){0,7}\p{L}[\p{L}'’-]*)\s+\((\p{Lu}[\p{Lu}\p{N}-]{1,9}s?)\)/gu
const ACRONYM = /\b(\p{Lu}[\p{Lu}\p{N}]*\p{Lu}[\p{Lu}\p{N}]*)(s?)\b/gu
const ALWAYS_OK = new Set(['TBD', 'REF', 'XREF', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII'])

// ---------------------------------------------------------------- the whole pass

export function finishDocument(input: FinishInput): FinishResult {
  const { sections, options } = input
  const codeBuilt = new Map(input.builtByCode.map(b => [b.number, b.kind]))
  const html = new Map<string, string>()
  const flags = new Map<string, string[]>()
  const flag = (id: string, code: string) => flags.set(id, [...new Set([...(flags.get(id) ?? []), code])])
  const report: FinishReport = {
    crossReferences: { resolved: 0, broken: [] },
    references: { cited: 0, listed: 0, notFound: [] },
    abbreviations: { defined: 0, undefined: [] },
    mismatches: [],
  }
  const current = (s: FinishSection) => html.get(s.id) ?? s.html
  const drafted = sections.filter(s => !codeBuilt.has(s.number.trim()))

  // References first (in document order), so numbering follows first use.
  const listed = new Map<string, { entry: string; label: string; n: number }>()
  for (const s of drafted) {
    let out = current(s)
    if (options.crossReferences) {
      out = out.replace(XREF, (_m, target: string) => {
        const hit = resolveXref(target, sections)
        if (hit) { report.crossReferences.resolved++; return `Section ${hit.number}` }
        const sub = resolveSubHeading(target, sections, current)
        if (sub) { report.crossReferences.resolved++; return `Section ${sub}` }
        report.crossReferences.broken.push({ section: s.number, target })
        flag(s.id, 'dropped_cross_ref')
        return `[TBD: cross-reference to “${escape(target)}”]`
      })
    }
    if (options.references) {
      out = out.replace(REF, (_m, citation: string, src?: string, page?: string) => {
        // "[REF: TBD: reference needed]": the drafter had no reference to cite. A TBD to fill, not an invented citation.
        if (/^(TBD|TBC)\b/i.test(citation.trim())) return `[${citation.trim()}]`
        report.references.cited++
        const entry = findReference(input.sources, citation, src ? Number(src) : null, page ? Number(page) : null)
        if (!entry) {
          report.references.notFound.push({ section: s.number, citation: citation.trim() })
          flag(s.id, 'invented_citation')
          return `[TBD: reference for “${escape(citation.trim())}” — not found in the evidence]`
        }
        const key = norm(entry)
        let ref = listed.get(key)
        if (!ref) {
          ref = { entry, label: citation.trim().replace(/\s+/g, ' '), n: listed.size + 1 }
          listed.set(key, ref)
        }
        return input.referenceStyle === 'author_year' ? `(${escape(ref.label)})` : `[${ref.n}]`
      })
    }
    if (out !== s.html) html.set(s.id, out)
  }
  report.references.listed = listed.size

  // Abbreviations: defined anywhere, used where.
  const defined = new Map<string, string>()
  const usedIn = new Map<string, Set<string>>()
  if (options.abbreviations) {
    for (const s of drafted) {
      const t = text(current(s))
      for (const m of t.matchAll(DEFINITION)) {
        const acronym = m[2]!.replace(/s$/, '')
        // "an adverse event (AE)": the definition is about as many words as the abbreviation has letters.
        const words = m[1]!.trim().split(/[\s-]+/)
        const letters = acronym.replace(/[^\p{Lu}]/gu, '').length
        if (!defined.has(acronym)) defined.set(acronym, words.slice(-Math.max(1, Math.min(words.length, letters))).join(' '))
      }
      for (const m of t.matchAll(ACRONYM)) {
        const a = m[1]!
        if (a.length < 2 || a.length > 8 || ALWAYS_OK.has(a)) continue
        // Part of a code such as "MP-301" or "NCT-0123", not an abbreviation.
        const after = t[m.index! + m[0]!.length] ?? ''
        const before = t[m.index! - 1] ?? ''
        if (/[-/\d]/.test(after) || before === '-' || before === '/') continue
        // A heading or phrase in capitals ("INCLUSION CRITERIA") is not an abbreviation.
        const around = t.slice(Math.max(0, m.index! - 25), m.index! + a.length + 25)
        if ((around.match(/\b\p{Lu}{3,}\b/gu) ?? []).length > 1 && /\b\p{Lu}{4,}\s+\p{Lu}{4,}\b/u.test(around)) continue
        usedIn.set(a, new Set([...(usedIn.get(a) ?? []), s.id]))
      }
    }
    report.abbreviations.defined = defined.size
    for (const [acronym, ids] of usedIn) {
      if (defined.has(acronym)) continue
      report.abbreviations.undefined.push({ acronym, sections: sections.filter(s => ids.has(s.id)).map(s => s.number) })
      for (const id of ids) flag(id, 'undefined_acronym')
    }
  }

  // Fact consistency against the fact sheet.
  if (options.factConsistency && input.factSheet) {
    const fact = (key: string) => input.factSheet!.facts.find(f => f.key === key && f.status === 'verified')
    const size = fact('sample_size')
    const n = size ? Number((size.value.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+/) ?? [])[0]) : NaN
    const protocol = fact('protocol_number')
    for (const s of drafted) {
      const t = text(current(s))
      if (Number.isFinite(n)) {
        for (const m of t.matchAll(/\b(?:total of|approximately|up to|planned|enrol\w*|randomi[sz]\w*)\b[^.]{0,40}?\b(\d{1,3}(?:,\d{3})+|\d+)\s+(?:participants|subjects|patients)/gi)) {
          const found = Number(m[1]!.replace(/,/g, ''))
          // "approximately 300 participants per arm" is a share of the total, not the total.
          const after = t.slice(m.index! + m[0]!.length, m.index! + m[0]!.length + 40)
          if (/^\s*(?:per|in each|for each|each|in every)\s+(?:treatment\s+)?(?:arm|group|cohort)\b|^\s*each\b/i.test(after)) continue
          if (found !== n) {
            report.mismatches.push({ section: s.number, fact: size!.label, expected: size!.value, found: m[0]!.trim() })
            flag(s.id, 'number_drift')
          }
        }
      }
      if (protocol) {
        const expected = norm(protocol.value).replace(/ /g, '')
        for (const m of t.matchAll(/\bprotocol\s+(?:number\s+|no\.?\s+|code\s+)?([A-Z]{1,8}[- ]?\d[\w-]*)/g)) {
          if (norm(m[1]!).replace(/ /g, '') !== expected) {
            report.mismatches.push({ section: s.number, fact: protocol.label, expected: protocol.value, found: m[1]! })
            flag(s.id, 'number_drift')
          }
        }
      }
    }
  }

  // Sections built by code.
  for (const s of sections) {
    const kind = codeBuilt.get(s.number.trim())
    if (kind === 'references' && options.references) {
      const refs = [...listed.values()]
      const body = refs.length === 0
        ? '<p>No references are cited in this document.</p>'
        : input.referenceStyle === 'author_year'
          ? `<ul>${refs.sort((a, b) => a.entry.localeCompare(b.entry)).map(r => `<li>${escape(r.entry)}</li>`).join('')}</ul>`
          : `<ol>${refs.sort((a, b) => a.n - b.n).map(r => `<li>${escape(r.entry)}</li>`).join('')}</ol>`
      if (body !== s.html) html.set(s.id, body)
    } else if (kind === 'abbreviations' && options.abbreviations) {
      const rows = [...defined.entries()].sort(([a], [b]) => a.localeCompare(b))
      const body = rows.length === 0
        ? '<p>No abbreviations are used in this document.</p>'
        : `<table><thead><tr><th>Abbreviation</th><th>Definition</th></tr></thead><tbody>${rows.map(([a, d]) => `<tr><td>${escape(a)}</td><td>${escape(d)}</td></tr>`).join('')}</tbody></table>`
      if (body !== s.html) html.set(s.id, body)
    } else if (kind === 'toc') {
      const body = `<ul>${sections.filter(x => x.id !== s.id).map(x => `<li>${escape(x.number)} ${escape(x.title)}</li>`).join('')}</ul>`
      if (body !== s.html) html.set(s.id, body)
    }
  }

  return { html, flags, report }
}

/** What a section is told about markers when the plan's finishing uses them. */
export function markerInstructions(options: FinishInput['options'], outline: Array<{ number: string; title: string }>): string {
  const parts: string[] = []
  if (options.crossReferences) {
    parts.push(
      'CROSS-REFERENCES: to refer the reader to another part of this document, write [XREF: <section number>] using a number from the outline below, for example "see [XREF: 8.3]". Never type a section, table or appendix number yourself.',
      `Outline of this document:\n${outline.map(s => `${s.number} ${s.title}`).join('\n')}`,
    )
  }
  if (options.references) {
    parts.push([
      'REFERENCES: this document has TWO kinds of citation marker. Use whichever fits the claim; both become numbered entries in the References section.',
      '',
      '1) DIRECT SOURCE — when a statement is drawn directly from one of the attached EVIDENCE sources (the protocol, CSR, SAP, label, etc. itself, not a reference inside it), put [REF: source | <source number>] right after the statement. Example: a claim taken from attached source #1 → [REF: source | 1]. The finishing pass lists that attached document under References.',
      '',
      '2) LITERATURE — when a statement relies on a published work (article, guideline, label) that an EVIDENCE source itself cites in its own reference list, put [REF: <first author surname> <year> | <source number> | <page of that source listing the reference>] right after it. Example: [REF: Smith 2021 | 2 | 45]. Cite only literature that is actually listed in an EVIDENCE source; never from memory and never from an EXAMPLE source.',
      '',
      'Do not write a reference list or numbered citations yourself — the finishing pass builds the References section. If a statement needs a reference you cannot find in any attached source, write [TBD: reference needed] (no [REF: ...] marker).',
    ].join('\n'))
  }
  return parts.join('\n\n')
}
