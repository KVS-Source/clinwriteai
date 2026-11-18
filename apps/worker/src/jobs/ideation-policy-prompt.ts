// Worker-side ideation policy resolver + render helpers — mirror of
// apps/api/src/modules/ideation/policy/*. Reads
// ideation_type_policies / ideation_ai_prompt_records /
// ideation_best_practice_records.
//
// Pure functions: no DB, no clock, no provider SDK. Re-exports Module A's
// SECTION_GROUNDING_RULES so clinical + scientific + medical + regulatory + ideation
// all speak the same grounding contract.

import { SECTION_GROUNDING_RULES as CLINICAL_GROUNDING_RULES } from './policy-prompt.js'

export interface IdeaPolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface IdeaPolicyDigest {
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
  bestPracticeDigest: IdeaPolicyDigest
  sectionRules:       IdeaPolicySectionRules
  channelHint:    string | null
  reviewTierFormula:  string | null
}

interface PrismaLike {
  ideationTypePolicy: {
    findFirst(args: {
      where: { docType: string; version?: number; isCurrent?: boolean; retiredAt?: null }
      orderBy?: { version?: 'desc' | 'asc' }
    }): Promise<unknown>
  }
  ideationAiPromptRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
  ideationBestPracticeRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
}

export async function resolveIdeationPolicyForArtefact(
  prisma: PrismaLike,
  args:   {
    docType:                              string
    ideationTypePolicyVersionAtCreate:         number | null
    ideationAiPromptRecordId?:                 string | null
    ideationBestPracticeRecordId?:             string | null
  },
): Promise<IdeaPolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRaw = args.ideationAiPromptRecordId
    ? await prisma.ideationAiPromptRecord.findUnique({ where: { id: args.ideationAiPromptRecordId } })
    : await prisma.ideationAiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const promptRow = promptRaw ? (promptRaw as Record<string, unknown>) : null

  const bpRaw = args.ideationBestPracticeRecordId
    ? await prisma.ideationBestPracticeRecord.findUnique({ where: { id: args.ideationBestPracticeRecordId } })
    : await prisma.ideationBestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const bpRow = bpRaw ? (bpRaw as Record<string, unknown>) : null

  const policyRaw = args.ideationTypePolicyVersionAtCreate !== null
    ? await prisma.ideationTypePolicy.findFirst({
        where: { docType, version: args.ideationTypePolicyVersionAtCreate },
      })
    : await prisma.ideationTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })
  const policyRow = policyRaw ? (policyRaw as Record<string, unknown>) : null

  if (!promptRow && !bpRow && !policyRow) return null

  return {
    id:                 String(promptRow?.id        ?? policyRow?.id        ?? bpRow!.id),
    docType:            String(promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType),
    version:            Number(promptRow?.version   ?? policyRow?.version   ?? bpRow!.version),
    smePrompt:          String(promptRow?.smePrompt ?? policyRow?.smePrompt ?? ''),
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as IdeaPolicyDigest) ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as IdeaPolicySectionRules) ?? {},
    channelHint:    policyRow?.channelHint ? String(policyRow.channelHint) : null,
    reviewTierFormula:  policyRow?.reviewTierFormula ? String(policyRow.reviewTierFormula) : null,
  }
}

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderIdeaWholeDocPrinciples(digest: IdeaPolicyDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderIdeaSectionRules(
  sectionKey: string,
  digest:     IdeaPolicyDigest,
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
  const whole = renderIdeaWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (sectionKey) {
    const sec = renderIdeaSectionRules(sectionKey, policy.bestPracticeDigest, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  return parts.join('\n')
}

export const SECTION_GROUNDING_RULES = CLINICAL_GROUNDING_RULES
