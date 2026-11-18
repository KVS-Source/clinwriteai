// Worker-side regulatory policy resolver + render helpers — mirror of
// apps/api/src/modules/regulatory-writing/policy/*. Reads
// regulatory_type_policies / regulatory_ai_prompt_records /
// regulatory_best_practice_records.
//
// Pure functions: no DB, no clock, no provider SDK. Re-exports Module A's
// SECTION_GROUNDING_RULES so clinical + scientific + medical + regulatory
// all speak the same grounding contract.

import { SECTION_GROUNDING_RULES as CLINICAL_GROUNDING_RULES } from './policy-prompt.js'

export interface RegPolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface RegPolicyDigest {
  principles: RegPolicyPrinciple[]
}

export interface RegPolicySectionRule {
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export type RegPolicySectionRules = Record<string, RegPolicySectionRule[]>

export interface RegPolicyRowForAi {
  id:                 string
  docType:            string
  version:            number
  smePrompt:          string
  bestPracticeDigest: RegPolicyDigest
  sectionRules:       RegPolicySectionRules
  regulatoryTrack:    string | null
  reviewTierFormula:  string | null
}

interface PrismaLike {
  regulatoryTypePolicy: {
    findFirst(args: {
      where: { docType: string; version?: number; isCurrent?: boolean; retiredAt?: null }
      orderBy?: { version?: 'desc' | 'asc' }
    }): Promise<unknown>
  }
  regulatoryAiPromptRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
  regulatoryBestPracticeRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
}

export async function resolveRegPolicyForDocument(
  prisma: PrismaLike,
  args:   {
    docType:                              string
    regTypePolicyVersionAtCreate:         number | null
    regAiPromptRecordId?:                 string | null
    regBestPracticeRecordId?:             string | null
  },
): Promise<RegPolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRaw = args.regAiPromptRecordId
    ? await prisma.regulatoryAiPromptRecord.findUnique({ where: { id: args.regAiPromptRecordId } })
    : await prisma.regulatoryAiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const promptRow = promptRaw ? (promptRaw as Record<string, unknown>) : null

  const bpRaw = args.regBestPracticeRecordId
    ? await prisma.regulatoryBestPracticeRecord.findUnique({ where: { id: args.regBestPracticeRecordId } })
    : await prisma.regulatoryBestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const bpRow = bpRaw ? (bpRaw as Record<string, unknown>) : null

  const policyRaw = args.regTypePolicyVersionAtCreate !== null
    ? await prisma.regulatoryTypePolicy.findFirst({
        where: { docType, version: args.regTypePolicyVersionAtCreate },
      })
    : await prisma.regulatoryTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })
  const policyRow = policyRaw ? (policyRaw as Record<string, unknown>) : null

  if (!promptRow && !bpRow && !policyRow) return null

  return {
    id:                 String(promptRow?.id        ?? policyRow?.id        ?? bpRow!.id),
    docType:            String(promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType),
    version:            Number(promptRow?.version   ?? policyRow?.version   ?? bpRow!.version),
    smePrompt:          String(promptRow?.smePrompt ?? policyRow?.smePrompt ?? ''),
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as RegPolicyDigest) ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as RegPolicySectionRules) ?? {},
    regulatoryTrack:    policyRow?.regulatoryTrack ? String(policyRow.regulatoryTrack) : null,
    reviewTierFormula:  policyRow?.reviewTierFormula ? String(policyRow.reviewTierFormula) : null,
  }
}

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderRegWholeDocPrinciples(digest: RegPolicyDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderRegSectionRules(
  sectionKey: string,
  digest:     RegPolicyDigest,
  rules:      RegPolicySectionRules,
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

export function renderRegPolicyPromptBlock(
  policy:     RegPolicyRowForAi | null,
  sectionKey: string | null = null,
): string {
  if (!policy) return ''
  const parts: string[] = []
  if (policy.smePrompt.trim().length > 0) {
    parts.push(`SME PROMPT (regulatory policy v${policy.version})`, policy.smePrompt.trim())
  }
  if (policy.regulatoryTrack) {
    parts.push('', `REGULATORY TRACK: ${policy.regulatoryTrack}`)
  }
  const whole = renderRegWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (sectionKey) {
    const sec = renderRegSectionRules(sectionKey, policy.bestPracticeDigest, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  return parts.join('\n')
}

export const SECTION_GROUNDING_RULES = CLINICAL_GROUNDING_RULES
