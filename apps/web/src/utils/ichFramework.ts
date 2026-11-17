// Matches the guideline a checklist item cites (e.g. 'ICH E6', 'ICH E6 §6.2', 'ICH E3 §12.3') to its entry in the
// ICH Frameworks registry (Master Library), which holds the real ICH list synced from ich.org.
//   - The citation's base code is the part after 'ICH ' up to a space or '§' (E6, E3, E2F, M4E(R2)).
//   - An exact registry match wins ('ICH E3'). Otherwise the revisions of that code are tried ('ICH E6(R3)',
//     'ICH E6(R2)'): a current one before a superseded one, then the highest revision.

import type { RegulatoryFramework } from '@platform/types'

export function ichBaseCode(citation: string): string | null {
  const m = citation.trim().match(/^ICH\s+([A-Za-z]+\d+[A-Za-z]*(?:\(R\d+\))?)/i)
  return m ? m[1]!.toUpperCase() : null
}

const revision = (code: string) => Number(code.match(/\(R(\d+)\)$/)?.[1] ?? 0)

export function matchIchFramework(citation: string, registry: RegulatoryFramework[]): RegulatoryFramework | null {
  const base = ichBaseCode(citation)
  if (!base) return null
  const want = `ICH ${base}`
  const exact = registry.find(f => f.code.toUpperCase() === want)
  if (exact) return exact
  const revisions = registry.filter(f => { const c = f.code.toUpperCase(); return c.startsWith(`${want}(R`) && /\(R\d+\)$/.test(c) })
  revisions.sort((a, b) => (a.status === 'Current' ? 0 : 1) - (b.status === 'Current' ? 0 : 1) || revision(b.code) - revision(a.code))
  return revisions[0] ?? null
}

// The ICH guidelines a document's checklist cites, one entry per guideline (citations of the same guideline,
// such as 'ICH E6' and 'ICH E6 §6.2', fold together). `framework` is null when the registry doesn't have it.
export function ichGuidelinesUsed(citations: string[], registry: RegulatoryFramework[]) {
  const out = new Map<string, { base: string; citations: string[]; framework: RegulatoryFramework | null }>()
  for (const c of citations) {
    const base = ichBaseCode(c)
    if (!base) continue
    const fw = matchIchFramework(c, registry)
    const key = fw?.id ?? base
    const entry = out.get(key) ?? { base, citations: [], framework: fw }
    if (!entry.citations.includes(c)) entry.citations.push(c)
    out.set(key, entry)
  }
  return [...out.values()].sort((a, b) => (a.framework?.code ?? `ICH ${a.base}`).localeCompare(b.framework?.code ?? `ICH ${b.base}`))
}
