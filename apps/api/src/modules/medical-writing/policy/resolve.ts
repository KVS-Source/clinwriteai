// API-side med content policy resolver + render helpers.
// Mirror of apps/worker/src/jobs/med-policy-prompt.ts for use from
// the /ai-suggest route + future section-context endpoints.

import type { PrismaClient } from '@prisma/client'
import { SECTION_GROUNDING_RULES as CLINICAL_SECTION_GROUNDING_RULES } from '../../platform/document-type-policy/resolve.js'

export interface MedPolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface MedBestPracticeDigest {
  principles: MedPolicyPrinciple[]
}

export interface MedPolicySectionRule {
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export type MedPolicySectionRules = Record<string, MedPolicySectionRule[]>

export interface MedPolicyRowForAi {
  id:                 string
  docType:            string
  version:            number
  smePrompt:          string
  bestPracticeDigest: MedBestPracticeDigest
  sectionRules:       MedPolicySectionRules
  complianceTrack:    string | null
  reviewTierFormula:  string | null
}

export async function resolveForMedContent(
  prisma: PrismaClient,
  args: {
    docType:                              string
    medContentTypePolicyVersionAtCreate:  number | null
    medContentAiPromptRecordId?:          string | null
    medContentBestPracticeRecordId?:      string | null
  },
): Promise<MedPolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRow = args.medContentAiPromptRecordId
    ? await prisma.medContentAiPromptRecord.findUnique({ where: { id: args.medContentAiPromptRecordId } })
    : await prisma.medContentAiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  const bpRow = args.medContentBestPracticeRecordId
    ? await prisma.medContentBestPracticeRecord.findUnique({ where: { id: args.medContentBestPracticeRecordId } })
    : await prisma.medContentBestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  const policyRow = args.medContentTypePolicyVersionAtCreate !== null
    ? await prisma.medContentTypePolicy.findFirst({
        where: { docType, version: args.medContentTypePolicyVersionAtCreate },
      })
    : await prisma.medContentTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })

  if (!promptRow && !bpRow && !policyRow) return null

  return {
    id:                 promptRow?.id        ?? policyRow?.id        ?? bpRow!.id,
    docType:            promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType,
    version:            promptRow?.version   ?? policyRow?.version   ?? bpRow!.version,
    smePrompt:          promptRow?.smePrompt ?? policyRow?.smePrompt ?? '',
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as unknown as MedBestPracticeDigest) ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as unknown as MedPolicySectionRules) ?? {},
    complianceTrack:    policyRow?.complianceTrack ?? null,
    reviewTierFormula:  policyRow?.reviewTierFormula ?? null,
  }
}

// --- renderers (parity with worker version) -----------------------------

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderMedWholeDocPrinciples(digest: MedBestPracticeDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderMedSectionRules(
  sectionKey: string,
  digest:     MedBestPracticeDigest,
  rules:      MedPolicySectionRules,
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

export function renderMedPolicyPromptBlock(
  policy:     MedPolicyRowForAi | null,
  sectionKey: string | null = null,
): string {
  if (!policy) return ''
  const parts: string[] = []
  if (policy.smePrompt.trim().length > 0) {
    parts.push(`SME PROMPT (med-content policy v${policy.version})`, policy.smePrompt.trim())
  }
  if (policy.complianceTrack) {
    parts.push('', `COMPLIANCE TRACK: ${policy.complianceTrack}`)
  }
  // BP removed per product decision — BP is author guidance, not AI steering. (M-F.1)
  const whole = "" // was: renderMedWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (sectionKey) {
    const sec = renderMedSectionRules(sectionKey, { principles: [] }, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  return parts.join('\n')
}

export const SECTION_GROUNDING_RULES = CLINICAL_SECTION_GROUNDING_RULES
