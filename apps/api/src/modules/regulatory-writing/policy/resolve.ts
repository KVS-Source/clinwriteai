// API-side regulatory policy resolver + render helpers.
// Mirror of apps/worker/src/jobs/regulatory-policy-prompt.ts for use
// from the /ai-suggest route + future section-context endpoints.

import type { PrismaClient } from '@prisma/client'
import {
  SECTION_GROUNDING_RULES as CLINICAL_SECTION_GROUNDING_RULES,
  renderSectionTemplateNL,
} from '../../platform/document-type-policy/resolve.js'
import type { SectionTemplateFormat } from '../../platform/section-template/schema.js'

export interface RegPolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface RegBestPracticeDigest {
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
  bestPracticeDigest: RegBestPracticeDigest
  sectionRules:       RegPolicySectionRules
  regulatoryTrack:    string | null
  reviewTierFormula:  string | null
}

export async function resolveForRegulatoryDocument(
  prisma: PrismaClient,
  args: {
    docType:                      string
    regTypePolicyVersionAtCreate: number | null
    regAiPromptRecordId?:         string | null
    regBestPracticeRecordId?:     string | null
  },
): Promise<RegPolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRow = args.regAiPromptRecordId
    ? await prisma.regulatoryAiPromptRecord.findUnique({ where: { id: args.regAiPromptRecordId } })
    : await prisma.regulatoryAiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  const bpRow = args.regBestPracticeRecordId
    ? await prisma.regulatoryBestPracticeRecord.findUnique({ where: { id: args.regBestPracticeRecordId } })
    : await prisma.regulatoryBestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  const policyRow = args.regTypePolicyVersionAtCreate !== null
    ? await prisma.regulatoryTypePolicy.findFirst({
        where: { docType, version: args.regTypePolicyVersionAtCreate },
      })
    : await prisma.regulatoryTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })

  if (!promptRow && !bpRow && !policyRow) return null

  return {
    id:                 promptRow?.id        ?? policyRow?.id        ?? bpRow!.id,
    docType:            promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType,
    version:            promptRow?.version   ?? policyRow?.version   ?? bpRow!.version,
    smePrompt:          promptRow?.smePrompt ?? policyRow?.smePrompt ?? '',
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as unknown as RegBestPracticeDigest) ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as unknown as RegPolicySectionRules) ?? {},
    regulatoryTrack:    policyRow?.regulatoryTrack ?? null,
    reviewTierFormula:  policyRow?.reviewTierFormula ?? null,
  }
}

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderRegWholeDocPrinciples(digest: RegBestPracticeDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderRegSectionRules(
  sectionKey: string,
  digest:     RegBestPracticeDigest,
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
  policy:                RegPolicyRowForAi | null,
  sectionKey:            string | null = null,
  sectionTemplateFormat: SectionTemplateFormat | null = null,
): string {
  if (!policy && !sectionTemplateFormat) return ''
  const parts: string[] = []
  if (policy && policy.smePrompt.trim().length > 0) {
    parts.push(`SME PROMPT (regulatory policy v${policy.version})`, policy.smePrompt.trim())
  }
  if (policy?.regulatoryTrack) {
    parts.push('', `REGULATORY TRACK: ${policy.regulatoryTrack}`)
  }
  // BP removed per product decision — BP is author guidance, not AI steering. (M-F.1)
  const whole = "" // was: renderRegWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (policy && sectionKey) {
    const sec = renderRegSectionRules(sectionKey, { principles: [] }, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  if (sectionKey && sectionTemplateFormat) {
    const tpl = renderSectionTemplateNL(sectionTemplateFormat, sectionKey)
    if (tpl) parts.push('', tpl)
  }
  return parts.join('\n')
}

export const SECTION_GROUNDING_RULES = CLINICAL_SECTION_GROUNDING_RULES
