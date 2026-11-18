// SectionTemplate — per-section formatting rules authored as natural
// language. Flipped from structured JSON to prose in migration 91 so
// admins write the exact text the AI reads on every draft + rewrite —
// no translation step, no schema drift, no renderer parity to guard.
//
// Storage shape is a plain string (plain text or markdown). The resolver
// wraps it with a "SECTION TEMPLATE (<key>) — follow these formatting
// rules" header so Claude knows what the block is for.

import { z } from 'zod'

/** Rules body — plain text or markdown. 10k char cap so a single
 *  verbose template doesn't blow out the AI context on every rewrite
 *  (the block is injected on every /ai-suggest + initial-draft call). */
export const sectionTemplateFormatRulesSchema = z.string().max(10_000)

export type SectionTemplateFormatRules = z.infer<typeof sectionTemplateFormatRulesSchema>

// --- API request / response schemas -------------------------------------

export const createSectionTemplateSchema = z.object({
  docType:     z.string().min(1).max(80),
  sectionKey:  z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.\-§]+$/),
  formatRules: sectionTemplateFormatRulesSchema.default(''),
}).strict()

export const updateSectionTemplateDraftSchema = z.object({
  formatRules: sectionTemplateFormatRulesSchema,
}).strict()

export const retireSectionTemplateSchema = z.object({
  reason: z.string().min(1).max(500),
}).strict()

export type CreateSectionTemplateInput      = z.infer<typeof createSectionTemplateSchema>
export type UpdateSectionTemplateDraftInput = z.infer<typeof updateSectionTemplateDraftSchema>
