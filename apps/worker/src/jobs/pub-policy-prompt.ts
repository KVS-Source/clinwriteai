// Publication-side policy resolver + render helpers — worker-side
// mirror of apps/api/src/modules/scientific-writing/policy/*. Scope
// is identical to apps/worker/src/jobs/policy-prompt.ts but reads
// publication_type_policies / publication_ai_prompt_records /
// publication_best_practice_records instead of the clinical ones.
//
// Pure functions: no DB, no clock, no provider SDK. Caller fetches the
// policy rows and hands structured values in. Same SECTION_GROUNDING_RULES
// text as clinical writing — exported here so the drafter + validation
// workers compose the system prompt identically to Module A, modulo the
// policy block content.

import { SECTION_GROUNDING_RULES as CLINICAL_GROUNDING_RULES } from './policy-prompt.js'

export interface PubPolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface PubPolicyDigest {
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
  bestPracticeDigest: PubPolicyDigest
  sectionRules:       PubPolicySectionRules
  guidelineKey:       string | null
}

interface PrismaLike {
  publicationTypePolicy: {
    findFirst(args: {
      where: { docType: string; version?: number; isCurrent?: boolean; retiredAt?: null }
      orderBy?: { version?: 'desc' | 'asc' }
    }): Promise<unknown>
  }
  publicationAiPromptRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: {
      where: { docType: string; status: 'approved' }
      orderBy: { version: 'desc' }
    }): Promise<unknown>
  }
  publicationBestPracticeRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: {
      where: { docType: string; status: 'approved' }
      orderBy: { version: 'desc' }
    }): Promise<unknown>
  }
}

/** Resolve the policy that applies to a publication for AI assembly.
 *
 *  Precedence (per source entity):
 *
 *  SME prompt + section rules (PublicationAiPromptRecord):
 *    1. Publication's pinned publicationAiPromptRecordId.
 *    2. Latest approved PublicationAiPromptRecord for this docType.
 *    3. Legacy fallback → PublicationTypePolicy.smePrompt + sectionRules.
 *
 *  BP digest (PublicationBestPracticeRecord):
 *    1. Publication's pinned publicationBestPracticeRecordId.
 *    2. Latest approved PublicationBestPracticeRecord for this docType.
 *    3. Legacy fallback → PublicationTypePolicy.bestPracticeDigest.
 *
 *  Legacy policy row is loaded alongside so both fallback paths stay
 *  live until Phase 3 of the publications pointer refactor (same
 *  migration arc as Module A's Phase 3).
 *
 *  Null return → caller falls back to built-in defaults. */
export async function resolvePubPolicyForPublication(
  prisma: PrismaLike,
  args:   {
    docType:                       string           // flat slug — e.g. 'manuscript_full_research'
    pubTypePolicyVersionAtCreate:  number | null
    publicationAiPromptRecordId?:  string | null
    publicationBestPracticeRecordId?: string | null
  },
): Promise<PubPolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRaw = args.publicationAiPromptRecordId
    ? await prisma.publicationAiPromptRecord.findUnique({
        where: { id: args.publicationAiPromptRecordId },
      })
    : await prisma.publicationAiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const promptRow = promptRaw ? (promptRaw as Record<string, unknown>) : null

  const bpRaw = args.publicationBestPracticeRecordId
    ? await prisma.publicationBestPracticeRecord.findUnique({
        where: { id: args.publicationBestPracticeRecordId },
      })
    : await prisma.publicationBestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const bpRow = bpRaw ? (bpRaw as Record<string, unknown>) : null

  const policyRaw = args.pubTypePolicyVersionAtCreate !== null
    ? await prisma.publicationTypePolicy.findFirst({
        where: { docType, version: args.pubTypePolicyVersionAtCreate },
      })
    : await prisma.publicationTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })
  const policyRow = policyRaw ? (policyRaw as Record<string, unknown>) : null

  if (!promptRow && !bpRow && !policyRow) return null

  const digestSource = (bpRow?.digest ?? policyRow?.bestPracticeDigest) as PubPolicyDigest | undefined
  return {
    id:                 String(promptRow?.id        ?? policyRow?.id        ?? bpRow!.id),
    docType:            String(promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType),
    version:            Number(promptRow?.version   ?? policyRow?.version   ?? bpRow!.version),
    smePrompt:          String(promptRow?.smePrompt ?? policyRow?.smePrompt ?? ''),
    bestPracticeDigest: digestSource                                     ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as PubPolicySectionRules) ?? {},
    guidelineKey:       policyRow?.guidelineKey ? String(policyRow.guidelineKey) : null,
  }
}

// --- renderers (parity with clinical-writing schema render helpers) -----

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderPubWholeDocPrinciples(digest: PubPolicyDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderPubSectionRules(
  sectionKey: string,
  digest:     PubPolicyDigest,
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

/** Re-export Module A's SECTION_GROUNDING_RULES unchanged. Scientific-
 *  writing section rewrites hold to the same four product guardrails
 *  — sources are authoritative, no fabrication, single-section scope,
 *  preserve reference markers — as clinical writing. */
export const SECTION_GROUNDING_RULES = CLINICAL_GROUNDING_RULES
