// Zod schemas + types for DocumentTypePolicy.
//
// The row shape is designed so a future "did this document comply with
// the policy at the time?" audit can reconstruct the full rule set from
// (docType, policyVersionAtCreate). Nothing stored here is free-form
// outside what the Zod schemas allow — the enum on severity + the
// scope regex on principles keep the structured shape queryable.

import { z } from 'zod'

// --- best-practice digest -----------------------------------------------

/** 'whole-doc' applies the principle to every section; 'section:<key>'
 *  narrows to one section by its stable key (e.g. 's6_2'). The regex
 *  keeps the shape strict so a mistyped scope lands as 400, not as a
 *  silent no-match at AI-call time. */
const scopeSchema = z.string().refine(
  s => s === 'whole-doc' || /^section:[a-zA-Z0-9_.\-§]+$/.test(s),
  { message: "scope must be 'whole-doc' or 'section:<key>'" },
)

export const principleSchema = z.object({
  scope:    scopeSchema,
  severity: z.enum(['must', 'should', 'nice']),
  text:     z.string().min(1).max(2_000),
})

export const bestPracticeDigestSchema = z.object({
  principles:     z.array(principleSchema).default([]),
  sourcePdfId:    z.string().optional(),       // DocumentUpload.id of the uploaded BP doc
  distilledAt:    z.string().optional(),       // ISO; set by the distillation worker
  distilledModel: z.string().optional(),       // 'claude-...'
}).strict()

export type Principle          = z.infer<typeof principleSchema>
export type BestPracticeDigest = z.infer<typeof bestPracticeDigestSchema>

// --- section rules (admin-authored, outside the BP digest) ---------------

export const sectionRuleSchema = z.object({
  severity: z.enum(['must', 'should', 'nice']),
  text:     z.string().min(1).max(2_000),
})
// Keyed by the stable section key (matching `SectionContent.sectionId`).
export const sectionRulesSchema = z.record(z.string(), z.array(sectionRuleSchema))

export type SectionRule  = z.infer<typeof sectionRuleSchema>
export type SectionRules = z.infer<typeof sectionRulesSchema>

// --- policy create / update ---------------------------------------------

/** Create the first version of a policy for a doc type. */
export const createPolicySchema = z.object({
  docType:             z.string().min(1).max(80),
  smePrompt:           z.string().min(1).max(100_000),     // SME prompts can be long
  bestPracticeDigest:  bestPracticeDigestSchema.optional(),
  sectionRules:        sectionRulesSchema.optional(),
  templateId:          z.string().optional().nullable(),
  checklistTemplateId: z.string().optional().nullable(),
  ichFramework:        z.string().max(80).optional().nullable(),
})

/** Edit the current version IN PLACE — only legal when no document has
 *  been created under this version yet (service enforces). Any edit
 *  that lands on a used policy must go through bumpVersion() instead. */
export const updatePolicySchema = createPolicySchema.partial().omit({ docType: true })

/** Bump a new version. Required fields are repeated here so the admin
 *  can't accidentally wipe the SME prompt by creating a "new version"
 *  with an empty body — the whole policy document re-posts.
 *  `changeReason` is persisted in the audit chain, not the row. */
export const bumpVersionSchema = createPolicySchema.omit({ docType: true }).extend({
  changeReason: z.string().min(1).max(500),
})

export const retireSchema = z.object({
  reason: z.string().min(1).max(500),
})

export type CreatePolicyInput = z.infer<typeof createPolicySchema>
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>
export type BumpVersionInput  = z.infer<typeof bumpVersionSchema>

// --- prompt-assembly helpers --------------------------------------------
//
// render*() helpers take the structured shapes and turn them into
// the plain-text block the AI gateway reads. Pure functions so both
// the initial-draft worker and the /ai-suggest route can share them.

/** Render the 'whole-doc' principles as a flat bullet list, stable
 *  order (`must` → `should` → `nice`), each prefixed with the severity. */
export function renderWholeDocPrinciples(digest: BestPracticeDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

/** Render the section-specific principles AND section rules for one
 *  section key. Returns '' when the section has no applicable rules.
 *  The output is ready to drop straight into the AI system prompt. */
export function renderSectionRules(
  sectionKey: string,
  digest:     BestPracticeDigest,
  rules:      SectionRules,
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

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}
