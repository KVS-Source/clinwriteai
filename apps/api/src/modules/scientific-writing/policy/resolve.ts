// API-side publication policy resolver + render helpers.
//
// Mirror of apps/api/src/modules/platform/document-type-policy/resolve.ts
// scoped to publications. The /ai-suggest route (Phase M-B.4) and the
// section-context route (Phase M-B.6) both inject the composed policy
// block the worker's ai_initial_draft already uses.
//
// Parity contract: output of `renderPubPolicyPromptBlock` here must
// match character-for-character what
// apps/worker/src/jobs/pub-policy-prompt.ts renders. A parity test
// (policy-prompt-parity.test.ts in this folder) guards drift.

import type { PrismaClient } from '@prisma/client'
import { SECTION_GROUNDING_RULES as CLINICAL_SECTION_GROUNDING_RULES } from '../../platform/document-type-policy/resolve.js'

export interface PubPolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface PubBestPracticeDigest {
  principles: PubPolicyPrinciple[]
}

export interface PubPolicySectionRule {
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export type PubPolicySectionRules = Record<string, PubPolicySectionRule[]>

export interface PubPolicyRowForAi {
  id:                 string
  docType:            string
  version:            number
  smePrompt:          string
  bestPracticeDigest: PubBestPracticeDigest
  sectionRules:       PubPolicySectionRules
  guidelineKey:       string | null
}

/** Resolve the publication policy that applies to a publication for AI
 *  assembly. Mirrors Module A's resolver shape. */
export async function resolveForPublication(
  prisma: PrismaClient,
  args: {
    docType:                       string
    pubTypePolicyVersionAtCreate:  number | null
    publicationAiPromptRecordId?:  string | null
    publicationBestPracticeRecordId?: string | null
  },
): Promise<PubPolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRow = args.publicationAiPromptRecordId
    ? await prisma.publicationAiPromptRecord.findUnique({ where: { id: args.publicationAiPromptRecordId } })
    : await prisma.publicationAiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  const bpRow = args.publicationBestPracticeRecordId
    ? await prisma.publicationBestPracticeRecord.findUnique({ where: { id: args.publicationBestPracticeRecordId } })
    : await prisma.publicationBestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  const policyRow = args.pubTypePolicyVersionAtCreate !== null
    ? await prisma.publicationTypePolicy.findFirst({
        where: { docType, version: args.pubTypePolicyVersionAtCreate },
      })
    : await prisma.publicationTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })

  if (!promptRow && !bpRow && !policyRow) return null

  return {
    id:                 promptRow?.id        ?? policyRow?.id        ?? bpRow!.id,
    docType:            promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType,
    version:            promptRow?.version   ?? policyRow?.version   ?? bpRow!.version,
    smePrompt:          promptRow?.smePrompt ?? policyRow?.smePrompt ?? '',
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as unknown as PubBestPracticeDigest) ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as unknown as PubPolicySectionRules) ?? {},
    guidelineKey:       policyRow?.guidelineKey ?? null,
  }
}

// --- renderers (parity with worker/jobs/pub-policy-prompt.ts) -----------

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderPubWholeDocPrinciples(digest: PubBestPracticeDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderPubSectionRules(
  sectionKey: string,
  digest:     PubBestPracticeDigest,
  rules:      PubPolicySectionRules,
): string {
  const fromDigest = digest.principles.filter(p => p.scope === `section:${sectionKey}`)
  const fromRules  = rules[sectionKey] ?? []
  const all = [
    ...fromDigest.map(p => ({ severity: p.severity, text: p.text })),
    ...fromRules,
  ]
  if (all.length === 0) return ''
  const ordered = [...all].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(r => `[${r.severity.toUpperCase()}] ${r.text}`).join('\n')
}

export function renderPubPolicyPromptBlock(
  policy:     PubPolicyRowForAi | null,
  sectionKey: string | null = null,
): string {
  if (!policy) return ''
  const parts: string[] = []
  if (policy.smePrompt.trim().length > 0) {
    parts.push(`SME PROMPT (publication policy v${policy.version})`, policy.smePrompt.trim())
  }
  if (policy.guidelineKey) {
    parts.push('', `REPORTING GUIDELINE: ${policy.guidelineKey}`)
  }
  const whole = renderPubWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (sectionKey) {
    const sec = renderPubSectionRules(sectionKey, policy.bestPracticeDigest, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  return parts.join('\n')
}

/** Re-export Module A's SECTION_GROUNDING_RULES so clinical + scientific
 *  writing speak the same grounding contract (sources authoritative, no
 *  fabrication, single-section scope, preserve references). */
export const SECTION_GROUNDING_RULES = CLINICAL_SECTION_GROUNDING_RULES
