// Master Library search inside a document's text. A term matches at the start of a word: "test" finds test,
// tests and testing, but not Gastrointestinal or latest. Plain substring matching used to bring up every long
// document for a common word, with nothing on screen to say why. The title is still matched anywhere in it,
// since the title is what the reader sees.

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g
const escapeRegex = (term: string) => term.replace(REGEX_SPECIALS, '\\$&')

/** A term for a SQL LIKE / Prisma `contains`: "%" and "_" are wildcards there, so a search for "%" matched every
 *  title. Backslash is LIKE's escape character in Postgres, so each of the three gets one in front. */
export const likeLiteral = (term: string) => term.replace(/[\\%_]/g, '\\$&')

/** Postgres (ARE) pattern for `body ~* pattern`: \m is "start of a word". */
export const wordStartPattern = (term: string) => `\\m${escapeRegex(term)}`

/** The same rule in JavaScript, for finding where in the text it matched: like \m, a word character must follow
 *  a non-word one (so a term starting with "(" never matches, as in Postgres). */
const wordStartRegex = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])${escapeRegex(term)}`, 'iu')

const EXCERPT_SIDE = 70

/**
 * A short piece of the text around the first match, for the "Found in text" line: whole words only, "…" where it
 * was cut. Null if the term isn't in the text (it was matched some other way).
 */
export function textExcerpt(body: string | null | undefined, term: string): string | null {
  // The library stores plain text already (plain-text.ts runs when it is written). Not flattened again here:
  // a "<" in an uploaded document would make that drop everything up to the next ">".
  const text = (body ?? '').replace(/\s+/g, ' ').trim()
  const m = wordStartRegex(term).exec(text)
  if (!m) return null
  let start = Math.max(0, m.index - EXCERPT_SIDE)
  let end = Math.min(text.length, m.index + term.length + EXCERPT_SIDE)
  // Don't cut a word in half at either end.
  if (start > 0) { const space = text.indexOf(' ', start); if (space !== -1 && space < m.index) start = space + 1 }
  if (end < text.length) { const space = text.lastIndexOf(' ', end); if (space > m.index + term.length) end = space }
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
