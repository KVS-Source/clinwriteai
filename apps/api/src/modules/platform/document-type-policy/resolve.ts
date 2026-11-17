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

/** Read the rule-set that applies to a document for AI assembly.
 *
 *  Resolution precedence (first match wins):
 *    1. Document has aiPromptRecordId pinned → load THAT exact row. Keeps
 *       smePrompt + sectionRules frozen even after admins approve newer
 *       AI prompt versions. (Pin added in migration 73.)
 *    2. Latest approved AiPromptRecord for this docType. Phase-1 default
 *       for documents created after the pointer refactor. BP digest still
 *       comes from the policy row (Phase 2 promotes BP separately).
 *    3. DocumentTypePolicy pinned by policyVersionAtCreate → legacy path
 *       for documents created before migration 73.
 *    4. Current DocumentTypePolicy for the docType → bare fallback for
 *       documents that predate even the policy pin (migration 65).
 *
 *  Null return → the caller falls back to the built-in prompts.
 *
 *  The identity of the returned `PolicyRowForAi` is: smePrompt + rules from
 *  (1)/(2) if either hits, else from (3)/(4). The `version` + `id` fields
 *  reflect whichever source they came from so audit + the preview panel
 *  still render meaningful labels. */
export async function resolveForDocument(
  prisma: PrismaClient,
  args: {
    docType:                 string
    policyVersionAtCreate:   number | null
    aiPromptRecordId?:       string | null               // migration 73 pin on Document
  },
): Promise<PolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  // 1 + 2: try the AiPromptRecord path first.
  const promptRow = args.aiPromptRecordId
    ? await prisma.aiPromptRecord.findUnique({ where: { id: args.aiPromptRecordId } })
    : await prisma.aiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  // BP digest still rides on DocumentTypePolicy for Phase 1. Load the
  // relevant policy row so the drafter still sees whole-doc principles +
  // (where no AiPromptRecord-sourced rules exist) the policy's own
  // sectionRules.
  const policyRow = args.policyVersionAtCreate !== null
    ? await prisma.documentTypePolicy.findUnique({
        where: { docType_version: { docType, version: args.policyVersionAtCreate } },
      })
    : await prisma.documentTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })

  if (!promptRow && !policyRow) return null

  // Prefer the AiPromptRecord's smePrompt + sectionRules when present.
  // Fall back to the policy row for the legacy shape.
  return {
    id:                 promptRow?.id        ?? policyRow!.id,
    docType:            promptRow?.docType   ?? policyRow!.docType,
    version:            promptRow?.version   ?? policyRow!.version,
    smePrompt:          promptRow?.smePrompt ?? policyRow?.smePrompt ?? '',
    bestPracticeDigest: (policyRow?.bestPracticeDigest as unknown as BestPracticeDigest) ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as unknown as SectionRules) ?? {},
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
