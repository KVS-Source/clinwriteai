// Policy resolution for AI assembly.
//
// Every AI call (initial draft + /ai-suggest rewrite) needs the policy
// that was in force for the document: the SME prompt, the whole-doc BP
// principles, and any per-section rules. Two cases:
//
//   1. Document has policyVersionAtCreate pinned → read that exact
//      (docType, version). Keeps the rule-set stable across later
//      policy bumps so a document drafted under v3 keeps being
//      rewritten under v3.
//
//   2. No pin (document predates migration 65 OR no policy existed
//      when it was created) → read the current policy for the doc
//      type. Matches how the New Document wizard would see it today.
//
// Returns null when neither path finds a row — the caller falls back
// to the built-in prompts.
//
// `renderPolicyPromptBlock` is the one shape both the API-side route
// (/ai-suggest) and the worker-side initial-draft job inject into the
// Claude system prompt. The worker has a parity mirror of this file
// at apps/worker/src/jobs/policy-prompt.ts — keep them in lock-step
// (the parity test fails loudly otherwise).

import type { PrismaClient } from '@prisma/client'
import {
  renderSectionRules,
  type BestPracticeDigest,
  type SectionRules,
} from './schema.js'
import type { SectionTemplateFormat } from '../section-template/schema.js'

export interface PolicyRowForAi {
  id:                 string
  docType:            string
  version:            number
  smePrompt:          string
  bestPracticeDigest: BestPracticeDigest
  sectionRules:       SectionRules
}

/** Read the rule-set that applies to a document for AI assembly.
 *
 *  Resolution precedence (first match wins per source entity):
 *
 *  SME prompt + section rules (AiPromptRecord — Phase 1, migration 73):
 *    1. Document has aiPromptRecordId pinned → load THAT exact row.
 *    2. Latest approved AiPromptRecord for this docType.
 *    3. Legacy fallback → DocumentTypePolicy.smePrompt + .sectionRules.
 *
 *  BP digest (BestPracticeRecord — Phase 2, migration 74):
 *    1. Document has bestPracticeRecordId pinned → load THAT exact row's digest.
 *    2. Latest approved BestPracticeRecord for this docType → its digest.
 *    3. Legacy fallback → DocumentTypePolicy.bestPracticeDigest.
 *
 *  DocumentTypePolicy row is loaded alongside (pinned by
 *  policyVersionAtCreate, else current) so both the legacy fallback
 *  paths above remain available until Phase 3 drops the columns.
 *
 *  Null return → the caller falls back to the built-in prompts.
 *
 *  The returned `PolicyRowForAi` mixes the sources transparently; the
 *  `version` + `id` fields reflect whichever SME-prompt source they
 *  came from so audit + the preview panel still render meaningful
 *  labels. */
export async function resolveForDocument(
  prisma: PrismaClient,
  args: {
    docType:                 string
    policyVersionAtCreate:   number | null
    aiPromptRecordId?:       string | null               // migration 73 pin on Document
    bestPracticeRecordId?:   string | null               // migration 74 pin on Document
  },
): Promise<PolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  // AiPromptRecord path (Phase 1).
  const promptRow = args.aiPromptRecordId
    ? await prisma.aiPromptRecord.findUnique({ where: { id: args.aiPromptRecordId } })
    : await prisma.aiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  // BestPracticeRecord path (Phase 2).
  const bpRow = args.bestPracticeRecordId
    ? await prisma.bestPracticeRecord.findUnique({ where: { id: args.bestPracticeRecordId } })
    : await prisma.bestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })

  // Legacy DocumentTypePolicy row (fallback for both SME + BP until Phase 3).
  const policyRow = args.policyVersionAtCreate !== null
    ? await prisma.documentTypePolicy.findUnique({
        where: { docType_version: { docType, version: args.policyVersionAtCreate } },
      })
    : await prisma.documentTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })

  if (!promptRow && !bpRow && !policyRow) return null

  // Prefer the AiPromptRecord's smePrompt + sectionRules; prefer the
  // BestPracticeRecord's digest; fall back to the policy row for anything
  // missing. The `id` + `version` reflect the AI-prompt source so the
  // preview panel's "SME PROMPT (policy v<N>)" label stays meaningful.
  return {
    id:                 promptRow?.id        ?? policyRow?.id        ?? bpRow!.id,
    docType:            promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType,
    version:            promptRow?.version   ?? policyRow?.version   ?? bpRow!.version,
    smePrompt:          promptRow?.smePrompt ?? policyRow?.smePrompt ?? '',
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as unknown as BestPracticeDigest) ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as unknown as SectionRules) ?? {},
  }
}

/** Render the policy as a plain-text block ready to append to a system
 *  prompt. Returns '' when the policy has nothing to add (no SME
 *  prompt, no principles, no section rules). When `sectionKey` is
 *  passed, the output also includes the section-scoped rules.
 *
 *  `sectionTemplateFormat` (migration 90) — when provided, appends a
 *  SECTION TEMPLATE block rendered as natural-language formatting
 *  rules. Claude follows NL formatting instructions more reliably
 *  than raw JSON and the token cost is ~3x lower. The format JSON
 *  itself is the authoritative record on SectionTemplate/SectionContent
 *  rows; this is the AI-facing projection. */
export function renderPolicyPromptBlock(
  policy:                PolicyRowForAi | null,
  sectionKey:            string | null = null,
  sectionTemplateFormat: SectionTemplateFormat | null = null,
): string {
  if (!policy && !sectionTemplateFormat) return ''
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
  if (sectionKey && sectionTemplateFormat) {
    const tpl = renderSectionTemplateNL(sectionTemplateFormat, sectionKey)
    if (tpl) parts.push('', tpl)
  }
  return parts.join('\n')
}

/** Translate the structured SectionTemplateFormat into natural-language
 *  formatting rules the model will follow. Empty blocks are skipped so
 *  a minimal template (e.g. just a font) produces a short, readable
 *  block. Keep in lock-step with the worker copy in
 *  apps/worker/src/jobs/policy-prompt.ts (parity-tested). */
export function renderSectionTemplateNL(
  fmt:        SectionTemplateFormat,
  sectionKey: string,
): string {
  const lines: string[] = [`SECTION TEMPLATE (${sectionKey}) — follow these formatting rules`]
  const { page, font, paragraph, heading, list, table, references, numbering, notes } = fmt

  if (page) {
    const bits: string[] = []
    if (page.size)        bits.push(`${page.size}`)
    if (page.orientation) bits.push(page.orientation)
    if (page.columns && page.columns > 1) bits.push(`${page.columns} columns`)
    const m = page.margins
    if (m && (m.top || m.right || m.bottom || m.left)) {
      bits.push(`margins top/right/bottom/left ${m.top ?? '-'}/${m.right ?? '-'}/${m.bottom ?? '-'}/${m.left ?? '-'}pt`)
    }
    if (bits.length) lines.push(`Page: ${bits.join(', ')}.`)
    if (page.header?.enabled) {
      const t = page.header.text ? ` text "${page.header.text}"` : ''
      lines.push(`Header: enabled${t}.`)
    }
    if (page.footer?.enabled) {
      const pn = page.footer.pageNumber ? ', include page number' : ''
      const t  = page.footer.text ? ` text "${page.footer.text}"` : ''
      lines.push(`Footer: enabled${t}${pn}.`)
    }
  }

  if (font) {
    const bits: string[] = []
    if (font.family) bits.push(font.family)
    if (font.size)   bits.push(`${font.size}pt`)
    if (font.weight && font.weight !== 'normal') bits.push(typeof font.weight === 'number' ? `weight ${font.weight}` : font.weight)
    if (font.style  && font.style  !== 'normal') bits.push(font.style)
    if (font.underline && font.underline !== 'none') bits.push(`${font.underline} underline`)
    if (font.color)  bits.push(font.color)
    if (bits.length) lines.push(`Font: ${bits.join(', ')}.`)
  }

  if (paragraph) {
    const bits: string[] = []
    if (paragraph.alignment)           bits.push(paragraph.alignment)
    if (paragraph.lineHeight)          bits.push(`${paragraph.lineHeight} line-height`)
    if (paragraph.spaceBefore)         bits.push(`${paragraph.spaceBefore}pt before`)
    if (paragraph.spaceAfter)          bits.push(`${paragraph.spaceAfter}pt after`)
    const ind = paragraph.indent
    if (ind && (ind.firstLine || ind.left || ind.right)) {
      bits.push(`indent first-line/left/right ${ind.firstLine ?? 0}/${ind.left ?? 0}/${ind.right ?? 0}pt`)
    }
    if (paragraph.keepTogether) bits.push('keep paragraph together')
    if (paragraph.keepWithNext) bits.push('keep with next')
    if (bits.length) lines.push(`Paragraphs: ${bits.join(', ')}.`)
  }

  if (heading) {
    const bits: string[] = []
    if (heading.level)       bits.push(`H${heading.level}`)
    if (heading.font?.size)  bits.push(`${heading.font.size}pt`)
    if (heading.font?.weight && heading.font.weight !== 'normal') bits.push(typeof heading.font.weight === 'number' ? `weight ${heading.font.weight}` : `${heading.font.weight}`)
    if (heading.font?.color) bits.push(heading.font.color)
    if (heading.spaceBefore) bits.push(`${heading.spaceBefore}pt before`)
    if (heading.spaceAfter)  bits.push(`${heading.spaceAfter}pt after`)
    if (heading.numbering?.format) bits.push(`numbering "${heading.numbering.format}"`)
    if (bits.length) lines.push(`Headings: ${bits.join(', ')}.`)
  }

  if (list) {
    const bits: string[] = []
    if (list.type && list.type !== 'none') bits.push(`${list.type} list`)
    if (list.marker) bits.push(`marker "${list.marker}"`)
    if (list.levels?.length) {
      bits.push(`${list.levels.length}-level nesting`)
    }
    if (bits.length) lines.push(`Lists: ${bits.join(', ')}.`)
  }

  if (table) {
    const bits: string[] = []
    if (table.borderStyle && table.borderStyle !== 'none') {
      bits.push(`${table.borderStyle} ${table.borderWidth ?? 0.5}pt ${table.borderColor ?? '#000000'} borders`)
    }
    if (table.headerRow?.fill) {
      bits.push(`header row fill ${table.headerRow.fill}` + (table.headerRow.fontWeight === 'bold' ? ' bold' : ''))
    }
    if (table.cellPadding) bits.push(`${table.cellPadding}pt cell padding`)
    if (table.rowBanding?.enabled) {
      bits.push(`row banding${table.rowBanding.altFill ? ` alt-fill ${table.rowBanding.altFill}` : ''}`)
    }
    if (bits.length) lines.push(`Tables: ${bits.join(', ')}.`)
  }

  if (references?.style) {
    const sep = references.separator ? ` separator "${references.separator}"` : ''
    lines.push(`References: ${references.style} style${sep}.`)
  }

  if (numbering?.sections) {
    const fmtStr = numbering.format ? `, format "${numbering.format}"` : ''
    const start  = numbering.startAt ? `, starts at ${numbering.startAt}` : ''
    lines.push(`Section numbering: auto${fmtStr}${start}.`)
  }

  if (notes) lines.push('', 'ADDITIONAL FORMATTING NOTES', notes.trim())

  // No content other than the header? Skip the block entirely so the
  // prompt stays clean.
  return lines.length > 1 ? lines.join('\n') : ''
}

/** Fixed product-level grounding rules for every single-section AI call.
 *
 *  Prepended to the system prompt in both the API (/ai-suggest) and the
 *  worker (ai_initial_draft). Mirrored character-identically in the web
 *  preview (apps/web/src/platform/screens/AiPrompts.tsx renderDrafterScaffolding)
 *  so admins see the real guardrail text.
 *
 *  Why in scaffolding, not policy: these rules are product-wide — never
 *  vary by doc type and admins can't turn them off. They codify the
 *  "linked sources auto-attach" contract (auto-attach added 2026-11-17)
 *  so the model knows attached documents are authoritative primary
 *  sources, not optional reading.
 *
 *  Keep in lock-step with the worker copy in
 *  apps/worker/src/jobs/policy-prompt.ts (parity-tested). */
export const SECTION_GROUNDING_RULES = [
  'SECTION GROUNDING RULES (product guardrails — always applied)',
  '- The attached source documents are the authoritative primary references for every fact, figure, date, numeric value, name, and citation in this section. Prefer verbatim quote or close paraphrase from the attachments over anything you can derive on your own.',
  '- When the attached sources genuinely do not contain information the section needs, insert a bracketed placeholder — [TBD: what is needed] — rather than fabricating. Never invent numbers, patient counts, dates, trial identifiers, or citations.',
  '- You are rewriting a single section only. Do not rewrite other sections or expand this one beyond its scope. Any "Additional context" below is reference material, not an edit target.',
  '- Preserve existing reference markers (superscripts, [1], §9.4 Table 3, etc.) unless the instruction says otherwise. A new claim that cites an attached source needs a visible reference.',
].join('\n')
