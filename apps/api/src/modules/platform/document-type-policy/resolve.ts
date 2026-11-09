// Policy resolution for AI assembly.
//
// Every AI call (initial draft + /ai-suggest rewrite) needs the policy
// that was in force for the document: the SME prompt, the whole-doc BP
// principles, and any per-section rules. Two cases:
//
//   1. Document has policyVersionAtCreate pinned → read that exact
//      (docType, version). Keeps the rule-set stable across later
//      policy bumps so a document drafted under v3 keeps being
//      rewritten under v3.
//
//   2. No pin (document predates migration 65 OR no policy existed
//      when it was created) → read the current policy for the doc
//      type. Matches how the New Document wizard would see it today.
//
// Returns null when neither path finds a row — the caller falls back
// to the built-in prompts.
//
// `renderPolicyPromptBlock` is the one shape both the API-side route
// (/ai-suggest) and the worker-side initial-draft job inject into the
// Claude system prompt. The worker has a parity mirror of this file
// at apps/worker/src/jobs/policy-prompt.ts — keep them in lock-step
// (the parity test fails loudly otherwise).

import type { PrismaClient } from '@prisma/client'
import {
  renderWholeDocPrinciples,
  renderSectionRules,
  type BestPracticeDigest,
  type SectionRules,
} from './schema.js'

export interface PolicyRowForAi {
  id:                 string
  docType:            string
  version:            number
  smePrompt:          string
  bestPracticeDigest: BestPracticeDigest
  sectionRules:       SectionRules
}

/** Read the policy that applies to a document. Pinned version first,
 *  else current. Doc type is normalised to the underscored canonical
 *  form (ADR 0001) to match the write path. */
export async function resolveForDocument(
  prisma: PrismaClient,
  args: { docType: string; policyVersionAtCreate: number | null },
): Promise<PolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')
  const row = args.policyVersionAtCreate !== null
    ? await prisma.documentTypePolicy.findUnique({
        where: { docType_version: { docType, version: args.policyVersionAtCreate } },
      })
    : await prisma.documentTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })
  if (!row) return null
  return {
    id:                 row.id,
    docType:            row.docType,
    version:            row.version,
    smePrompt:          row.smePrompt,
    bestPracticeDigest: (row.bestPracticeDigest as unknown as BestPracticeDigest) ?? { principles: [] },
    sectionRules:       (row.sectionRules       as unknown as SectionRules)       ?? {},
  }
}

/** Render the policy as a plain-text block ready to append to a system
 *  prompt. Returns '' when the policy has nothing to add (no SME
 *  prompt, no principles, no section rules). When `sectionKey` is
 *  passed, the output also includes the section-scoped rules. */
export function renderPolicyPromptBlock(
  policy:     PolicyRowForAi | null,
  sectionKey: string | null = null,
): string {
  if (!policy) return ''
  const parts: string[] = []
  if (policy.smePrompt.trim().length > 0) {
    parts.push(`SME PROMPT (policy v${policy.version})`, policy.smePrompt.trim())
  }
  const whole = renderWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (sectionKey) {
    const sec = renderSectionRules(sectionKey, policy.bestPracticeDigest, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  return parts.join('\n')
}
