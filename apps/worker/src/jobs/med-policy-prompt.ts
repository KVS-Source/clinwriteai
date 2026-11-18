// Worker-side med-content policy resolver + render helpers — mirror of
// apps/api/src/modules/medical-writing/policy/*. Reads
// med_content_type_policies / med_content_ai_prompt_records /
// med_content_best_practice_records.
//
// Pure functions: no DB, no clock, no provider SDK. Re-exports Module
// A's SECTION_GROUNDING_RULES so clinical + scientific + medical
// writing all speak the same grounding contract.

import { SECTION_GROUNDING_RULES as CLINICAL_GROUNDING_RULES } from './policy-prompt.js'

export interface MedPolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface MedPolicyDigest {
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
  bestPracticeDigest: MedPolicyDigest
  sectionRules:       MedPolicySectionRules
  complianceTrack:    string | null
  reviewTierFormula:  string | null
}

interface PrismaLike {
  medContentTypePolicy: {
    findFirst(args: {
      where: { docType: string; version?: number; isCurrent?: boolean; retiredAt?: null }
      orderBy?: { version?: 'desc' | 'asc' }
    }): Promise<unknown>
  }
  medContentAiPromptRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
  medContentBestPracticeRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
}

export async function resolveMedPolicyForContent(
  prisma: PrismaLike,
  args:   {
    docType:                              string
    medContentTypePolicyVersionAtCreate:  number | null
    medContentAiPromptRecordId?:          string | null
    medContentBestPracticeRecordId?:      string | null
  },
): Promise<MedPolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRaw = args.medContentAiPromptRecordId
    ? await prisma.medContentAiPromptRecord.findUnique({ where: { id: args.medContentAiPromptRecordId } })
    : await prisma.medContentAiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const promptRow = promptRaw ? (promptRaw as Record<string, unknown>) : null

  const bpRaw = args.medContentBestPracticeRecordId
    ? await prisma.medContentBestPracticeRecord.findUnique({ where: { id: args.medContentBestPracticeRecordId } })
    : await prisma.medContentBestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const bpRow = bpRaw ? (bpRaw as Record<string, unknown>) : null

  const policyRaw = args.medContentTypePolicyVersionAtCreate !== null
    ? await prisma.medContentTypePolicy.findFirst({
        where: { docType, version: args.medContentTypePolicyVersionAtCreate },
      })
    : await prisma.medContentTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })
  const policyRow = policyRaw ? (policyRaw as Record<string, unknown>) : null

  if (!promptRow && !bpRow && !policyRow) return null

  return {
    id:                 String(promptRow?.id        ?? policyRow?.id        ?? bpRow!.id),
    docType:            String(promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType),
    version:            Number(promptRow?.version   ?? policyRow?.version   ?? bpRow!.version),
    smePrompt:          String(promptRow?.smePrompt ?? policyRow?.smePrompt ?? ''),
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as MedPolicyDigest) ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as MedPolicySectionRules) ?? {},
    complianceTrack:    policyRow?.complianceTrack ? String(policyRow.complianceTrack) : null,
    reviewTierFormula:  policyRow?.reviewTierFormula ? String(policyRow.reviewTierFormula) : null,
  }
}

// --- renderers ----------------------------------------------------------

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderMedWholeDocPrinciples(digest: MedPolicyDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderMedSectionRules(
  sectionKey: string,
  digest:     MedPolicyDigest,
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

export const SECTION_GROUNDING_RULES = CLINICAL_GROUNDING_RULES
