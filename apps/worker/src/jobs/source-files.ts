// Reading source files for the AI drafter, and what each one may be used for.
//
// A source is linked to a document as
//   evidence — this study's own material; facts may come from it;
//   example  — a sample, template or another study's document; structure and wording only.
// (document_sources.role, set in the New Document wizard — see the API's source-check.ts.)
//
// PDFs are sent as PDFs (or as text when long — source-blocks.ts). Word .docx files are sent as simple HTML (tables
// kept) and plain-text files as they are.
// Anything else (PowerPoint, Excel, old .doc, images) can't be read; the wizard refuses those for an AI draft.

export type SourceRole = 'evidence' | 'example'
export type SourceKind = 'pdf' | 'word' | 'text' | 'other'

const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'md', 'json'])

/** Same rule as the API's source-inspect.ts sourceKind. */
export function sourceKind(fileName: string, contentType: string | null): SourceKind {
  const dot = fileName.lastIndexOf('.')
  const ext = dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
  const type = (contentType ?? '').toLowerCase()
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf'
  if (ext === 'docx') return 'word'
  if (TEXT_EXTENSIONS.has(ext) || type.startsWith('text/')) return 'text'
  return 'other'
}

/**
 * The content of a Word or plain-text source. Throws when it has no text, so the caller treats it as unreadable.
 *
 * A Word file is read as simple HTML, so its tables keep their rows and columns (doses, visit schedules and
 * endpoints often sit in tables) and its headings and lists stay recognisable. Images are left out.
 */
export async function readSourceText(bytes: Buffer, kind: 'word' | 'text'): Promise<string> {
  let text: string
  if (kind === 'word') {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.convertToHtml(
      { buffer: bytes },
      // Images can't be used, and as data: URIs they would only cost tokens.
      { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) },
    )
    text = compactWordHtml(value ?? '')
    if (visibleText(text).length < 20) throw new Error('the file has no readable text')
    return text
  }
  text = bytes.toString('utf8').trim()
  if (text.length < 20) throw new Error('the file has no readable text')
  return text
}

const BLOCK_END = /<\/(p|h[1-6]|li|tr|table|ul|ol)>/g
const BLOCK_START = /<(table|ul|ol)>/g

/**
 * mammoth's HTML, trimmed to what carries meaning: headings, paragraphs, lists and tables (cells keep colspan /
 * rowspan). Images, links, ids and other attributes are dropped, and each block goes on its own line.
 */
export function compactWordHtml(html: string): string {
  return html
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<\/?a\b[^>]*>/gi, '')
    .replace(/<(\w+)\b([^>]*)>/g, (_m, tag: string, attrs: string) => {
      const keep = [...attrs.matchAll(/\b(colspan|rowspan)="(\d+)"/gi)].map(m => ` ${m[1]!.toLowerCase()}="${m[2]}"`).join('')
      return `<${tag.toLowerCase()}${keep}>`
    })
    .replace(/<p><\/p>/g, '')
    // Inside a table cell, paragraphs become line breaks, so each row stays on one line.
    .replace(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/g, (_m, tag: string, attrs: string, inner: string) =>
      `<${tag}${attrs}>${inner.replace(/<\/p>\s*<p>/g, '<br>').replace(/<\/?p>/g, '').trim()}</${tag}>`)
    .replace(BLOCK_END, m => `${m}\n`)
    .replace(BLOCK_START, m => `${m}\n`)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

export const isExample = (role: string | null | undefined) => role === 'example'

/** How an example source is titled when sent to the model, so the label travels with the file itself. */
export const exampleTitle = (title: string) => `EXAMPLE ONLY, not this study: ${title}`

/** Added to the drafting and checking prompts when at least one source is an example. */
export const EXAMPLE_SOURCES_RULE = [
  'EVIDENCE AND EXAMPLE SOURCES',
  '- Sources marked EXAMPLE are samples, templates or documents of OTHER studies. Use them only for structure, headings, the order of content and standard wording.',
  '- Never take a fact from an EXAMPLE source: no study title or number, drug or product name, dose, regimen, population, sample size, endpoint, visit, date, country, site, sponsor, investigator, statistic or reference.',
  '- Facts come only from EVIDENCE sources. When the evidence does not state something, write [TBD: what is needed], even if an example shows a value for it.',
].join('\n')
