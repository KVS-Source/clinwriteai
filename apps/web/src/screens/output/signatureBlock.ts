// The template's own signature block on the Final Document screen, filled with the recorded e-signatures for
// display only (the stored, signed text is not changed). Same rule as the PDF
// (apps/api/src/modules/clinical-writing/documents/signature-block.ts): keep the two in step.

export interface BlockSignature { role: string; name: string; signature: string }

const isPlaceholder = (text: string) => /^(\[[^\]]*\]|[_\s.–—-]*)$/.test(text.trim())
const textOf = (cell: Element) => cell.textContent ?? ''

/** The section's HTML with its signature block filled, or null when it has none to fill. */
export function fillSignatureBlockHtml(html: string, signatures: BlockSignature[]): string | null {
  if (signatures.length === 0 || !/signature/i.test(html)) return null
  const body = new DOMParser().parseFromString(html, 'text/html').body
  for (const table of Array.from(body.querySelectorAll('table'))) {
    const rows = Array.from(table.rows)
    const [head, ...rest] = rows
    if (!head || rest.length === 0 || table.querySelector('table')) continue
    const width = head.cells.length
    const plain = rows.every(r => r.cells.length === width && Array.from(r.cells).every(c => c.colSpan === 1 && c.rowSpan === 1))
    if (!plain) continue
    const heads = Array.from(head.cells).map(textOf)
    const signature = heads.findIndex(h => /signature/i.test(h))
    const role = heads.findIndex((h, i) => i !== signature && /function|signatory|\brole\b/i.test(h))
    const name = heads.findIndex((h, i) => i !== signature && i !== role && /\bname\b/i.test(h))
    if (signature < 0 || role < 0 || name < 0) continue
    const open = rest.filter(r => isPlaceholder(textOf(r.cells[signature]!)))
    if (open.length === 0) continue
    const parent = open[0]!.parentElement!
    open.forEach(r => r.remove())
    for (const s of signatures) {
      const tr = body.ownerDocument.createElement('tr')
      heads.forEach((_, i) => {
        const td = body.ownerDocument.createElement('td')
        // One paragraph per line, so a name and its job title (or a signature's meaning, time and id) stack.
        const text = i === role ? s.role : i === name ? s.name : i === signature ? s.signature : ''
        for (const line of text.split('\n')) {
          const p = body.ownerDocument.createElement('p')
          p.textContent = line
          td.appendChild(p)
        }
        tr.appendChild(td)
      })
      parent.appendChild(tr)
    }
    return body.innerHTML
  }
  return null
}
