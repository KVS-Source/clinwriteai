// Module 5 (CSR) read-only gate for the Regulatory ai-suggest route
// (Package R-4, migration 105). Business rule DD-D-001: Module 5
// nodes are read-only — their content is sourced from Clinical Writing
// documents (CSRs in Module A) and must be edited there, not inside
// the regulatory submission. The gate returns a structured verdict so
// the route can 403 with a helpful message BEFORE invoking any AI.
//
// Resolution path:
//   RegulatoryDocument.id → EctdGranularityNode(s) where
//     documentId = that id → if any node has moduleSection starting
//     with "5" AND isReadOnly=true, the document is Module 5.
//
// Best-effort: if no EctdGranularityNode is mapped to the document,
// the gate returns { readOnly: false } — safe-default. Legitimate
// rewrites on unmapped sections proceed normally.

import type { PrismaClient } from '@prisma/client'

export interface EctdGateVerdict {
  /** True when the document maps to at least one read-only Module 5 node.
   *  Calling route returns 403 with the message below. */
  readOnly:      boolean
  /** Human-readable reason surfaced to the author. */
  message:       string
  /** The matched moduleSection code(s), for audit. */
  moduleSections: string[]
}

export async function checkModule5Gate(
  prisma: PrismaClient,
  regulatoryDocumentId: string,
): Promise<EctdGateVerdict> {
  try {
    const nodes = await prisma.ectdGranularityNode.findMany({
      where:  { documentId: regulatoryDocumentId },
      select: { moduleSection: true, isReadOnly: true },
    })
    const module5 = nodes.filter(n => n.isReadOnly && n.moduleSection.startsWith('5'))
    if (module5.length === 0) {
      return { readOnly: false, message: '', moduleSections: [] }
    }
    return {
      readOnly: true,
      message:
        'Module 5 (CSR) sections are sourced from Clinical Writing documents and are read-only here. ' +
        'Edit the CSR in Module A (Clinical Writing), then re-sync the regulatory submission.',
      moduleSections: module5.map(n => n.moduleSection),
    }
  } catch {
    // Soft-default to allow — better to let legitimate rewrites through
    // than block them on a transient DB error.
    return { readOnly: false, message: '', moduleSections: [] }
  }
}

/** Response body shape for 403 returns. Stable so clients can match
 *  by `error: 'module_5_readonly'`. */
export const MODULE_5_READONLY_FORBIDDEN = {
  error: 'module_5_readonly',
} as const
