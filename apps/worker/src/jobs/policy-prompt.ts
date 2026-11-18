// DocumentTypePolicy → system-prompt block, worker-side mirror.
//
// This is a copy of apps/api/src/modules/platform/document-type-policy/
// resolve.ts (the worker is its own package and imports nothing from
// apps/api; the parity test at policy-prompt-parity.test.ts asserts
// the render output matches character-for-character). Keep the two
// files in lock-step — drift here means the initial-draft worker's
// system prompt disagrees with the per-section rewrite's prompt on
// the same document.
//
// Scope — pure. No DB, no clock, no provider SDK. The caller fetches
// the policy row and hands the structured value in.

export interface PolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface PolicyDigest {
  principles: PolicyPrinciple[]
}

export interface PolicySectionRule {
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export type PolicySectionRules = Record<string, PolicySectionRule[]>

export interface PolicyRowForAi {
  id:                 string
  docType:            string
  version:            number
  smePrompt:          string
  bestPracticeDigest: PolicyDigest
  sectionRules:       PolicySectionRules
}

// --- resolver ------------------------------------------------------------

interface PrismaLike {
  documentTypePolicy: {
    findUnique(args: { where: { docType_version: { docType: string; version: number } } }): Promise<unknown>
    findFirst(args: { where: { docType: string; isCurrent: boolean; retiredAt: null } }): Promise<unknown>
  }
  aiPromptRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
  bestPracticeRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
}

/** Mirror of apps/api resolveForDocument.
 *
 *  Resolution precedence (per source entity):
 *
 *  SME prompt + section rules (AiPromptRecord — Phase 1):
 *    1. Document has aiPromptRecordId pinned → load THAT exact row.
 *    2. Latest approved AiPromptRecord for this docType.
 *    3. Legacy fallback → DocumentTypePolicy.smePrompt + .sectionRules.
 *
 *  BP digest (BestPracticeRecord — Phase 2):
 *    1. Document has bestPracticeRecordId pinned → load THAT exact row's digest.
 *    2. Latest approved BestPracticeRecord for this docType → its digest.
 *    3. Legacy fallback → DocumentTypePolicy.bestPracticeDigest. */
export async function resolveForDocument(
  prisma: PrismaLike,
  args:   {
    docType:                string
    policyVersionAtCreate:  number | null
    aiPromptRecordId?:      string | null
    bestPracticeRecordId?:  string | null
  },
): Promise<PolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRaw = args.aiPromptRecordId
    ? await prisma.aiPromptRecord.findUnique({ where: { id: args.aiPromptRecordId } })
    : await prisma.aiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const promptRow = promptRaw ? (promptRaw as Record<string, unknown>) : null

  const bpRaw = args.bestPracticeRecordId
    ? await prisma.bestPracticeRecord.findUnique({ where: { id: args.bestPracticeRecordId } })
    : await prisma.bestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const bpRow = bpRaw ? (bpRaw as Record<string, unknown>) : null

  const policyRaw = args.policyVersionAtCreate !== null
    ? await prisma.documentTypePolicy.findUnique({
        where: { docType_version: { docType, version: args.policyVersionAtCreate } },
      })
    : await prisma.documentTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })
  const policyRow = policyRaw ? (policyRaw as Record<string, unknown>) : null

  if (!promptRow && !bpRow && !policyRow) return null

  return {
    id:                 String(promptRow?.id        ?? policyRow?.id        ?? bpRow!.id),
    docType:            String(promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType),
    version:            Number(promptRow?.version   ?? policyRow?.version   ?? bpRow!.version),
    smePrompt:          String(promptRow?.smePrompt ?? policyRow?.smePrompt ?? ''),
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as PolicyDigest)                     ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as PolicySectionRules)           ?? {},
  }
}

// --- renderers (parity with apps/api schema.ts render helpers) ----------

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderWholeDocPrinciples(digest: PolicyDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderSectionRules(
  sectionKey: string,
  digest:     PolicyDigest,
  rules:      PolicySectionRules,
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

/** Mirror of apps/api renderPolicyPromptBlock. */
export function renderPolicyPromptBlock(
  policy:                     PolicyRowForAi | null,
  sectionKey:                 string | null = null,
  sectionTemplateFormatRules: string | null = null,
): string {
  if (!policy && !sectionTemplateFormatRules) return ''
  const parts: string[] = []
  if (policy && policy.smePrompt.trim().length > 0) {
    parts.push(`SME PROMPT (policy v${policy.version})`, policy.smePrompt.trim())
  }
  // BP removed per product decision — BP is author guidance, not AI steering. (M-F.1)
  const whole = "" // was: renderWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (policy && sectionKey) {
    const sec = renderSectionRules(sectionKey, { principles: [] }, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  if (sectionKey && sectionTemplateFormatRules) {
    const tpl = renderSectionTemplateNL(sectionTemplateFormatRules, sectionKey)
    if (tpl) parts.push('', tpl)
  }
  return parts.join('\n')
}

// --- SectionTemplate renderer (migration 90, flipped to NL in 91) -------
//
// Worker-side mirror of apps/api/src/modules/platform/document-type-policy/
// resolve.ts renderSectionTemplateNL. Parity test asserts identical output.

export function renderSectionTemplateNL(
  rules:      string,
  sectionKey: string,
): string {
  const trimmed = rules.trim()
  if (!trimmed) return ''
  return `SECTION TEMPLATE (${sectionKey}) — follow these formatting rules\n${trimmed}`
}

/** Fixed product-level grounding rules for every single-section AI call.
 *  Mirror of apps/api resolve.ts SECTION_GROUNDING_RULES. Keep in
 *  lock-step — parity test fails on drift. */
export const SECTION_GROUNDING_RULES = [
  'SECTION GROUNDING RULES (product guardrails — always applied)',
  '- The attached source documents are the authoritative primary references for every fact, figure, date, numeric value, name, and citation in this section. Prefer verbatim quote or close paraphrase from the attachments over anything you can derive on your own.',
  '- When the attached sources genuinely do not contain information the section needs, insert a bracketed placeholder — [TBD: what is needed] — rather than fabricating. Never invent numbers, patient counts, dates, trial identifiers, or citations.',
  '- You are rewriting a single section only. Do not rewrite other sections or expand this one beyond its scope. Any "Additional context" below is reference material, not an edit target.',
  '- Preserve existing reference markers (superscripts, [1], §9.4 Table 3, etc.) unless the instruction says otherwise. A new claim that cites an attached source needs a visible reference.',
].join('\n')
