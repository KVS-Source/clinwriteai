// Library entries store plain text (the `body` column), so HTML from a document
// section is flattened here: block elements become paragraph breaks, list items
// become "- " lines, inline tags are dropped and the common entities decoded.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(p|div|ul|ol|h[1-6]|blockquote|table|thead|tbody|tr|pre)\b[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (full, name: string) => ENTITIES[name.toLowerCase()] ?? full)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
