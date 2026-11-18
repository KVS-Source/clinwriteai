// API-side ideation policy resolver + render helpers.
// Mirror of apps/worker/src/jobs/ideation-policy-prompt.ts for use
// from the /ai-suggest route + future section-context endpoints.

import type { PrismaClient } from '@prisma/client'
import { SECTION_GROUNDING_RULES as CLINICAL_SECTION_GROUNDING_RULES } from '../../platform/document-type-policy/resolve.js'

export interface IdeaPolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface IdeaBestPracticeDigest {
  principles: IdeaPolicyPrinciple[]
}

export interface IdeaPolicySectionRule {
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export type IdeaPolicySectionRules = Record<string, IdeaPolicySectionRule[]>

export interface IdeaPolicyRowForAi {
  id:                 string
  docType:            string
  version:            number
  smePrompt:          string
  bestPracticeDigest: IdeaBestPracticeDigest
  sectionRules:       IdeaPolicySectionRules
  channelHint:    string | null
  reviewTierFormula:  string | null
}

export async function resolveForIdeationArtefact(
  prisma: PrismaClient,
  args: {
    docType:                      string
    ideationTypePolicyVersionAtCreate: number | null
    ideationAiPromptRecordId?:         string | null
    ideationBestPracticeRecordId?:     string | null
  },
): Promise<IdeaPolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRow = args.ideationAiPromptRecordId
    ? await prisma.ideationAiPromptRecord.findUnique({ where: { id: args.ideationAiPromptRecordId } })
    : await prisma.ideationAiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  const bpRow = args.ideationBestPracticeRecordId
    ? await prisma.ideationBestPracticeRecord.findUnique({ where: { id: args.ideationBestPracticeRecordId } })
    : await prisma.ideationBestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  const policyRow = args.ideationTypePolicyVersionAtCreate !== null
    ? await prisma.ideationTypePolicy.findFirst({
        where: { docType, version: args.ideationTypePolicyVersionAtCreate },
      })
    : await prisma.ideationTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })

  if (!promptRow && !bpRow && !policyRow) return null

  return {
    id:                 promptRow?.id        ?? policyRow?.id        ?? bpRow!.id,
    docType:            promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType,
    version:            promptRow?.version   ?? policyRow?.version   ?? bpRow!.version,
    smePrompt:          promptRow?.smePrompt ?? policyRow?.smePrompt ?? '',
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as unknown as IdeaBestPracticeDigest) ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as unknown as IdeaPolicySectionRules) ?? {},
    channelHint:    policyRow?.channelHint ?? null,
    reviewTierFormula:  policyRow?.reviewTierFormula ?? null,
  }
}

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderIdeaWholeDocPrinciples(digest: IdeaBestPracticeDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderIdeaSectionRules(
  sectionKey: string,
  digest:     IdeaBestPracticeDigest,
  rules:      IdeaPolicySectionRules,
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

export function renderIdeaPolicyPromptBlock(
  policy:     IdeaPolicyRowForAi | null,
  sectionKey: string | null = null,
): string {
  if (!policy) return ''
  const parts: string[] = []
  if (policy.smePrompt.trim().length > 0) {
    parts.push(`SME PROMPT (ideation policy v${policy.version})`, policy.smePrompt.trim())
  }
  if (policy.channelHint) {
    parts.push('', `CHANNEL HINT: ${policy.channelHint}`)
  }
  // BP removed per product decision — BP is author guidance, not AI steering. (M-F.1)
  const whole = "" // was: renderIdeaWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (sectionKey) {
    const sec = renderIdeaSectionRules(sectionKey, { principles: [] }, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  return parts.join('\n')
}

export const SECTION_GROUNDING_RULES = CLINICAL_SECTION_GROUNDING_RULES
