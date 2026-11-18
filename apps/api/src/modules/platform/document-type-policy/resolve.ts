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
 *  Resolution precedence (first match wins per source entity):
 *
 *  SME prompt + section rules (AiPromptRecord — Phase 1, migration 73):
 *    1. Document has aiPromptRecordId pinned → load THAT exact row.
 *    2. Latest approved AiPromptRecord for this docType.
 *    3. Legacy fallback → DocumentTypePolicy.smePrompt + .sectionRules.
 *
 *  BP digest (BestPracticeRecord — Phase 2, migration 74):
 *    1. Document has bestPracticeRecordId pinned → load THAT exact row's digest.
 *    2. Latest approved BestPracticeRecord for this docType → its digest.
 *    3. Legacy fallback → DocumentTypePolicy.bestPracticeDigest.
 *
 *  DocumentTypePolicy row is loaded alongside (pinned by
 *  policyVersionAtCreate, else current) so both the legacy fallback
 *  paths above remain available until Phase 3 drops the columns.
 *
 *  Null return → the caller falls back to the built-in prompts.
 *
 *  The returned `PolicyRowForAi` mixes the sources transparently; the
 *  `version` + `id` fields reflect whichever SME-prompt source they
 *  came from so audit + the preview panel still render meaningful
 *  labels. */
export async function resolveForDocument(
  prisma: PrismaClient,
  args: {
    docType:                 string
    policyVersionAtCreate:   number | null
    aiPromptRecordId?:       string | null               // migration 73 pin on Document
    bestPracticeRecordId?:   string | null               // migration 74 pin on Document
  },
): Promise<PolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  // AiPromptRecord path (Phase 1).
  const promptRow = args.aiPromptRecordId
    ? await prisma.aiPromptRecord.findUnique({ where: { id: args.aiPromptRecordId } })
    : await prisma.aiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  // BestPracticeRecord path (Phase 2).
  const bpRow = args.bestPracticeRecordId
    ? await prisma.bestPracticeRecord.findUnique({ where: { id: args.bestPracticeRecordId } })
    : await prisma.bestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  // Legacy DocumentTypePolicy row (fallback for both SME + BP until Phase 3).
  const policyRow = args.policyVersionAtCreate !== null
    ? await prisma.documentTypePolicy.findUnique({
        where: { docType_version: { docType, version: args.policyVersionAtCreate } },
      })
    : await prisma.documentTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })

  if (!promptRow && !bpRow && !policyRow) return null

  // Prefer the AiPromptRecord's smePrompt + sectionRules; prefer the
  // BestPracticeRecord's digest; fall back to the policy row for anything
  // missing. The `id` + `version` reflect the AI-prompt source so the
  // preview panel's "SME PROMPT (policy v<N>)" label stays meaningful.
  return {
    id:                 promptRow?.id        ?? policyRow?.id        ?? bpRow!.id,
    docType:            promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType,
    version:            promptRow?.version   ?? policyRow?.version   ?? bpRow!.version,
    smePrompt:          promptRow?.smePrompt ?? policyRow?.smePrompt ?? '',
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as unknown as BestPracticeDigest) ?? { principles: [] },
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
  // BP removed per product decision — BP is author guidance, not AI steering. (M-F.1)
  const whole = "" // was: renderWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (sectionKey) {
    const sec = renderSectionRules(sectionKey, { principles: [] }, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  return parts.join('\n')
}

/** Fixed product-level grounding rules for every single-section AI call.
 *
 *  Prepended to the system prompt in both the API (/ai-suggest) and the
 *  worker (ai_initial_draft). Mirrored character-identically in the web
 *  preview (apps/web/src/platform/screens/AiPrompts.tsx renderDrafterScaffolding)
 *  so admins see the real guardrail text.
 *
 *  Why in scaffolding, not policy: these rules are product-wide — never
 *  vary by doc type and admins can't turn them off. They codify the
 *  "linked sources auto-attach" contract (auto-attach added 2026-11-17)
 *  so the model knows attached documents are authoritative primary
 *  sources, not optional reading.
 *
 *  Keep in lock-step with the worker copy in
 *  apps/worker/src/jobs/policy-prompt.ts (parity-tested). */
export const SECTION_GROUNDING_RULES = [
  'SECTION GROUNDING RULES (product guardrails — always applied)',
  '- The attached source documents are the authoritative primary references for every fact, figure, date, numeric value, name, and citation in this section. Prefer verbatim quote or close paraphrase from the attachments over anything you can derive on your own.',
  '- When the attached sources genuinely do not contain information the section needs, insert a bracketed placeholder — [TBD: what is needed] — rather than fabricating. Never invent numbers, patient counts, dates, trial identifiers, or citations.',
  '- You are rewriting a single section only. Do not rewrite other sections or expand this one beyond its scope. Any "Additional context" below is reference material, not an edit target.',
  '- Preserve existing reference markers (superscripts, [1], §9.4 Table 3, etc.) unless the instruction says otherwise. A new claim that cites an attached source needs a visible reference.',
].join('\n')
