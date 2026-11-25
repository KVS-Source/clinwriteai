// The template's own signature block (e.g. the Protocol's "Document approval and version history": Function /
// signatory | Name / title | Signature / date), filled with the recorded e-signatures when a signed copy is
// drawn. The stored text is never changed: the signatures are bound to its hash.
//
// The block's printed rows are functions ("Biostatistics approver [Pending]") the system doesn't record, so a
// signature is never put against one of them: the unfilled rows give way to one row per person who signed.
// A row someone filled in by hand stays as written.

import type { Block, TableCell } from './final-pdf-html.js'

export interface BlockSignature { role: string; name: string; signature: string }

type Table = Extract<Block, { kind: 'table' }>

// Empty, a dash / underscores, or "[anything]".
const isPlaceholder = (text: string) => /^(\[[^\]]*\]|[_\s.–—-]*)$/.test(text.trim())

interface Columns { role: number; name: number; signature: number; date: number }

function columnsOf(table: Table): Columns | null {
  const [head, ...body] = table.rows
  if (!head || body.length === 0) return null
  const plain = table.rows.every(r => r.length === head.length && r.every(c => c.colSpan === 1 && c.rowSpan === 1))
  if (!plain) return null
  const find = (re: RegExp, not: number[] = []) => head.findIndex((c, i) => !not.includes(i) && re.test(c.text))
  const signature = find(/signature/i)
  if (signature < 0) return null
  const role = find(/function|signatory|\brole\b/i, [signature])
  const name = find(/\bname\b/i, [signature, role])
  if (role < 0 || name < 0) return null
  return { role, name, signature, date: find(/\bdate\b/i, [signature, role, name]) }
}

/** The first table in these blocks that is a signature block still to be filled, with its columns. */
function findBlock(blocks: Block[]): { index: number; table: Table; columns: Columns } | null {
  for (const [index, b] of blocks.entries()) {
    if (b.kind !== 'table') continue
    const columns = columnsOf(b)
    if (columns && b.rows.slice(1).some(r => isPlaceholder(r[columns.signature]!.text))) return { index, table: b, columns }
  }
  return null
}

export const hasSignatureBlock = (blocks: Block[]): boolean => findBlock(blocks) !== null

/** The blocks with their signature block filled, and where it is; null when there is none. */
export function fillSignatureBlock(blocks: Block[], signatures: BlockSignature[]): { blocks: Block[]; index: number } | null {
  const found = findBlock(blocks)
  if (!found) return null
  const { index, table, columns } = found
  const [head, ...body] = table.rows
  const kept = body.filter(r => !isPlaceholder(r[columns.signature]!.text))
  const signed = signatures.map(s => head!.map((_, i): TableCell => ({
    text: i === columns.role ? s.role : i === columns.name ? s.name : i === columns.signature ? s.signature : '',
    bold: false, header: false, colSpan: 1, rowSpan: 1,
  })))
  const filled: Table = { ...table, rows: [head!, ...kept, ...signed] }
  return { blocks: blocks.map((b, i) => (i === index ? filled : b)), index }
}
