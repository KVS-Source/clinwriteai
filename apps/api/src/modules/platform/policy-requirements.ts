// Policy requirements — per-doc-type input gates shared across every
// policy module (Clinical, Publication, Medical, Regulatory, Ideation).
//
// Each module's *TypePolicy row carries a `requirements` JSONB column
// (migration 101 for B-E, migration 100 for Clinical). The PM toggles
// which inputs the AI drafter demands before it runs. All three
// default to true — matches the previously hard-coded behaviour so
// nothing regresses when a policy created before the migration
// (defaulted on insert) is loaded.
//
// Lives in /platform because the shape is identical across modules
// and the Zod schema is cheap to share. No runtime coupling between
// modules — each service just imports the type + helper.

import { z } from 'zod'

/** Which document inputs must be present before the AI drafter can run.
 *
 *  - requireSources:  author must attach at least one usable source
 *  - requireTemplate: a document template must resolve (pinned or auto-matched)
 *  - requirePurpose:  author must state the doc's purpose at Create time
 *                     (stored on the module's existing author-prompt field,
 *                     e.g. documents.aiInstructions for Clinical).
 */
export const policyRequirementsSchema = z.object({
  requireSources:  z.boolean().default(true),
  requireTemplate: z.boolean().default(true),
  requirePurpose:  z.boolean().default(true),
}).strict()

export type PolicyRequirements = z.infer<typeof policyRequirementsSchema>

export const DEFAULT_POLICY_REQUIREMENTS: PolicyRequirements = {
  requireSources:  true,
  requireTemplate: true,
  requirePurpose:  true,
}

/** Coerce a Prisma Json column into the typed shape — null-safe for
 *  rows inserted before migration 100/101 landed (none in prod, but
 *  defensive so a bad backfill never crashes the resolver). */
export function requirementsOf(row: { requirements?: unknown }): PolicyRequirements {
  const raw = row.requirements
  if (!raw || typeof raw !== 'object') return DEFAULT_POLICY_REQUIREMENTS
  const parsed = policyRequirementsSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_POLICY_REQUIREMENTS
}
