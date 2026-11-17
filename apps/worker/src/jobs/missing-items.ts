// What the AI drafter could not take from the sources, read back from the section it wrote.
//
// The drafter marks each missing item in place as [TBD: what is needed] and never writes a paragraph
// explaining that the sources lack information (that text used to go through review and was even
// signed). The markers are what the placeholder check, the ICH E3 progress and the signature gate
// catch; this lists them for the job log so a writer can see what each section still needs.

const MARKER = /\[\s*TBD\b\s*:?\s*([^\]]*)\]/gi
const MAX_ITEMS = 12
const MAX_LEN = 140

/** The "what is needed" text of every [TBD: ...] marker in the HTML ("" markers are reported as "unspecified"). */
export function extractMissingItems(html: string): string[] {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  const items: string[] = []
  for (const m of text.matchAll(MARKER)) {
    const item = (m[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN) || 'unspecified'
    if (!items.includes(item)) items.push(item)
    if (items.length >= MAX_ITEMS) break
  }
  return items
}
