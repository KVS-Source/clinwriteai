// Compact carry prompt — rides along on every AI section-rewrite call.
//
// Distils the SME "Initiate Clinical Trial Protocol Drafting" prompt down
// to the invariants that must hold on every per-section rewrite. The full
// SME prompt stays on the initial-draft path (worker). This one is for the
// existing /ai-suggest flow, where the model edits one section at a time
// and needs just enough context to:
//   - cite the right next Vancouver number (brief.references.nextNumber)
//   - reference only tables / figures / appendices that actually exist
//     (brief.inventory)
//   - respect sponsor policy (brief.sponsor.*) and jurisdiction
//     (brief.document.jurisdictions)
//   - flag missing / conflicting / unverifiable things instead of
//     hallucinating — using the four escape-hatch tokens the chat-event
//     parser will pick up in step C:
//       [Information Required: <what>]
//       [Conflict: <A> vs <B>]
//       [Reference Verification Required: <sourceId>]
//       [Missing Cross-Ref Target: <item>]
//
// Returns (systemPrompt, userPrompt) so the gateway caller can hand both
// to the Anthropic Messages API without any further assembly.
//
// Pure — no DB, no network, no clock. Deterministic output for a given
// input, so the prompt wording can be snapshot-tested.

import type { DocumentBrief } from '../document-brief/schema.js'

export interface CarryPromptSection {
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  contentHtml:   string
}

export interface CarryPromptSourceExcerpt {
  /** Display name — upload title, filename, or fallback. */
  title:   string
  /** Pre-trimmed excerpt the caller already fit under its budget. */
  excerpt: string
}

export interface BuildCarryPromptInputs {
  brief:    DocumentBrief
  section:  CarryPromptSection
  sources?: CarryPromptSourceExcerpt[]
  /** User instruction — "tighten this paragraph", "convert to
   *  numbered list", etc. The one piece the model is being asked to act
   *  on this turn. */
  ask:      string
}

export interface CarryPromptResult {
  systemPrompt: string
  userPrompt:   string
}

// --------------------------------------------------------------------------
// Role line — tweaks the phrasing per doc type so the same hard rules land
// against the right register. All other rules are doc-type-agnostic.

const ROLE_BY_DOC_TYPE: Record<string, string> = {
  'protocol':
    'Regulatory medical writer editing one section of a clinical trial protocol (ICH M11 / CeSHarP).',
  'protocol-amendment':
    'Regulatory medical writer editing one section of a clinical trial protocol amendment.',
}

function roleFor(docType: string): string {
  return ROLE_BY_DOC_TYPE[docType]
    ?? `Regulatory medical writer editing one section of a ${docType.replace(/-/g, ' ')}.`
}

// --------------------------------------------------------------------------
// System prompt — the stable, doc-wide invariants. Short on purpose; the
// model doesn't need the whole SME preamble on every rewrite, just the
// rules that constrain *this* output.

export function buildSystemPrompt(brief: DocumentBrief): string {
  const jx = brief.document.jurisdictions.length
    ? brief.document.jurisdictions.join(', ')
    : 'none specified — flag jurisdiction-specific content as needing clarification'

  const sp = brief.sponsor
  const lines: string[] = [
    `ROLE`,
    roleFor(brief.document.type),
    `Output only the rewritten section body — no preamble, no meta-commentary, no section number/title restated.`,
    ``,
    `HARD RULES (never violate)`,
    `1. Do not fabricate clinical facts, numbers, criteria, dates, statistics, references, DOIs, or citation numbers.`,
    `   If a fact is missing, emit \`[Information Required: <what is needed>]\` inline.`,
    `2. If sources contradict, do not pick one. Emit \`[Conflict: <A> vs <B> — needs clarification]\`.`,
    `3. Do not initiate approval, final-sign-off, or e-signature language. This is a draft: ${brief.document.draftLabel}.`,
    ``,
    `STYLE`,
    `- Scientific, concise, no marketing phrasing.`,
    `- Jurisdictions in scope: ${jx}.`,
    `- Citation style: ${sp.citationStyle}.`,
    `- Table footnote style: ${sp.tableFootnoteStyle}.`,
    `- Abbreviations: ${sp.abbreviationPolicy}.`,
    ``,
    `CROSS-REFERENCES`,
    `- Section refs use the form "Refer to Section X.Y for <topic>." Only reference section numbers listed under \`outline\` in the brief.`,
    `- Table / figure / listing / appendix refs use the item's \`ref\` exactly as it appears under \`inventory\` in the brief ("As shown in Table 3.", "see Figure 1", etc.).`,
    `- If you need to reference an item not in the brief's inventory, emit \`[Missing Cross-Ref Target: <item>]\` instead of inventing the reference.`,
    ``,
    `CITATIONS (Vancouver)`,
    `- Superscript Arabic numerals, first-appearance order.`,
    `- Reuse the same number for repeat citations of the same source.`,
    `- A brand-new source gets the number \`brief.references.nextNumber\`; never invent your own number.`,
    `- Never invent DOI, authors, year, journal, volume, issue, pages. If a source lacks those details, emit \`[Reference Verification Required: <sourceId>]\`.`,
    `- Distinguish bibliographic superscripts from table footnote markers (a, b, c…).`,
    ``,
    `FLAG TOKENS — summary`,
    `- \`[Information Required: ...]\`           missing fact`,
    `- \`[Conflict: ...]\`                        source disagreement`,
    `- \`[Reference Verification Required: ...]\` incomplete bibliographic record`,
    `- \`[Missing Cross-Ref Target: ...]\`        inventory gap`,
    ``,
    `Always prefer emitting a flag token to silently fabricating.`,
  ]

  return lines.join('\n')
}

// --------------------------------------------------------------------------
// User prompt — the dynamic inputs. Order matters:
//   1. <brief>     — authoritative, model reads first
//   2. <section>   — the thing being edited
//   3. <sources>   — reference excerpts (optional)
//   4. <ask>       — what to do, last so it's most recent in attention

export function buildUserPrompt(inputs: Omit<BuildCarryPromptInputs, 'brief'> & { brief: DocumentBrief }): string {
  const { brief, section, sources, ask } = inputs

  const briefJson = JSON.stringify(brief, null, 2)
  const sectionBlock = [
    `§${section.sectionNumber} ${section.sectionTitle}`,
    ``,
    section.contentHtml || '(section is currently empty)',
  ].join('\n')

  const sourcesBlock = (sources && sources.length > 0)
    ? sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}`).join('\n\n')
    : '(no source excerpts supplied for this turn)'

  return [
    `<brief>`,
    briefJson,
    `</brief>`,
    ``,
    `<section id="${section.sectionId}">`,
    sectionBlock,
    `</section>`,
    ``,
    `<sources>`,
    sourcesBlock,
    `</sources>`,
    ``,
    `<ask>`,
    ask.trim(),
    `</ask>`,
  ].join('\n')
}

// --------------------------------------------------------------------------
// Public entrypoint — assembles both halves. Callers pass to the gateway.

export function buildCarryPrompt(inputs: BuildCarryPromptInputs): CarryPromptResult {
  return {
    systemPrompt: buildSystemPrompt(inputs.brief),
    userPrompt:   buildUserPrompt(inputs),
  }
}
