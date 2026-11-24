// Zod schemas + types for DocumentTypePolicy.
//
// The row shape is designed so a future "did this document comply with
// the policy at the time?" audit can reconstruct the full rule set from
// (docType, policyVersionAtCreate). Nothing stored here is free-form
// outside what the Zod schemas allow — the enum on severity + the
// scope regex on principles keep the structured shape queryable.

import { z } from 'zod'
import {
  policyRequirementsSchema,
  DEFAULT_POLICY_REQUIREMENTS,
  requirementsOf,
} from '../policy-requirements.js'
import type { PolicyRequirements } from '../policy-requirements.js'

// Re-export the shared policy-requirements helpers from here so clinical
// callers keep their existing `./schema` imports. The real source lives
// in /platform/policy-requirements.ts so modules B-E share the same type.
export {
  policyRequirementsSchema,
  DEFAULT_POLICY_REQUIREMENTS,
  requirementsOf,
}
export type { PolicyRequirements }

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

// (policy-requirements re-exported at the top of the file, next to the import)

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

/** Create the first version of a policy for a doc type.
 *
 *  `smePrompt` is optional: the real SME prompt lives on the AiPromptRecord
 *  entity (its own tab) and is auto-resolved per docType, so the legacy
 *  policy.smePrompt field is just a placeholder on fresh policies. When
 *  omitted, the service defaults to a "configure in AI Prompts" marker so
 *  the column satisfies NOT NULL and the policy list renders a clear
 *  "legacy" fallback until the admin publishes an AiPromptRecord. */
export const createPolicySchema = z.object({
  docType:             z.string().min(1).max(80),
  smePrompt:           z.string().max(100_000).optional(),
  bestPracticeDigest:  bestPracticeDigestSchema.optional(),
  sectionRules:        sectionRulesSchema.optional(),
  templateId:          z.string().optional().nullable(),
  checklistTemplateId: z.string().optional().nullable(),
  ichFramework:        z.string().max(80).optional().nullable(),   // DEPRECATED — see ichFrameworkNames
  ichFrameworkNames:   z.array(z.string().min(1).max(80)).max(20).optional(),
  requirements:        policyRequirementsSchema.optional(),
})

/** Default SME-prompt placeholder used on `create` when the admin opts
 *  not to provide one. Matches the legacy marker the UI used to send so
 *  existing fallback logic (ChipAiPrompt 'legacy' state) keeps working. */
export function defaultPlaceholderSmePrompt(docType: string): string {
  return `SME prompt for ${docType} — configure in AI Prompts.`
}

/** Edit the current version IN PLACE — only legal when no document has
 *  been created under this version yet (service enforces). Any edit
 *  that lands on a used policy must go through bumpVersion() instead. */
export const updatePolicySchema = createPolicySchema.partial().omit({ docType: true })

/** Bump a new version. Required fields are repeated here so the admin
 *  can't accidentally wipe the SME prompt by creating a "new version"
 *  with an empty body — the whole policy document re-posts.
 *  `changeReason` is persisted in the audit chain, not the row.
 *
 *  Note: `smePrompt` is deliberately re-required here (overrides the
 *  optional-on-create behaviour) — a version bump is a conscious edit
 *  of the policy's contents, not a fresh anchor like `create`. */
export const bumpVersionSchema = createPolicySchema.omit({ docType: true }).extend({
  smePrompt:    z.string().min(1).max(100_000),
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
