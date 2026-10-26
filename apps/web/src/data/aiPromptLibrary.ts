// AI prompt suggestions library (sPM-ai-prompt-help).
//
// Hardcoded suggested prompts for the Help panel next to the section AI
// prompt box. Grouped by document type so the panel can show relevant
// guidance for the context the user is in. "any" prompts apply to every
// doc type and show as a trailing section.
//
// Each prompt has:
//   - `scope`: 'selection' | 'section' — tells the user which to use.
//     'selection' prompts expect the user to highlight text first; the
//     Help panel surfaces this with a chip.
//   - `label`: short title shown in the list
//   - `prompt`: the actual text filled into the prompt box when clicked
//
// To add a new document type: add a key to DOCUMENT_PROMPTS matching the
// DocumentType enum from packages/types.
// To expand: edit this file; no release gate — the UI re-reads on load.

import type { DocumentType } from '@platform/types'

export interface SuggestedPrompt {
  label:  string
  prompt: string
  scope:  'selection' | 'section'
}

export interface PromptGroup {
  title:   string
  prompts: SuggestedPrompt[]
}

const ANY_SECTION: PromptGroup = {
  title: 'Any section',
  prompts: [
    { label: 'Tighten',                 scope: 'section',   prompt: 'Rewrite this section for clarity. Preserve every data point, number, and reference.' },
    { label: 'Fix grammar + tense',     scope: 'section',   prompt: 'Fix grammatical errors and ensure consistent past tense throughout.' },
    { label: 'Convert to plain English', scope: 'section',   prompt: 'Rewrite in plain English for a non-statistician reviewer. Keep all the data; drop the jargon.' },
    { label: 'Shorten to 3 sentences',  scope: 'selection', prompt: 'Shorten the highlighted passage to no more than three sentences while keeping every data point.' },
    { label: 'Expand with detail',      scope: 'selection', prompt: 'Expand the highlighted passage with more detail suitable for a reviewer. Do not invent data.' },
  ],
}

const DOCUMENT_PROMPTS: Partial<Record<DocumentType, PromptGroup>> = {
  'csr-full': {
    title: 'CSR (full)',
    prompts: [
      { label: 'Primary efficacy — tighten',    scope: 'section',   prompt: 'Rewrite the primary efficacy result paragraph in ICH E3 style. Lead with the hazard ratio + 95% CI + p-value, then the median endpoint and comparator.' },
      { label: 'Subgroup analysis sentence',    scope: 'selection', prompt: 'Rewrite as a one-sentence subgroup consistency statement, including the interaction p-value if present.' },
      { label: 'Convert AE table to prose',     scope: 'section',   prompt: 'Convert the adverse-event table into a brief prose summary suitable for a §12 narrative. Preserve all Grade 3+ rates.' },
      { label: 'Add sensitivity analysis note', scope: 'section',   prompt: 'Add a short sensitivity-analysis paragraph referencing the per-protocol population, noting whether the result was consistent with the primary analysis.' },
    ],
  },
  'csr-synopsis': {
    title: 'CSR synopsis',
    prompts: [
      { label: 'Trial summary — 150 words',  scope: 'section',   prompt: 'Produce a 150-word trial summary covering design, population, primary endpoint, result, and safety headline.' },
      { label: 'Objective → endpoint list',  scope: 'section',   prompt: 'Rewrite as a bulleted list mapping each objective to its primary + secondary endpoints.' },
    ],
  },
  'protocol': {
    title: 'Protocol',
    prompts: [
      { label: 'Inclusion criteria — numbered list', scope: 'section',   prompt: 'Convert the inclusion criteria into a numbered list, one criterion per line, no sub-clauses.' },
      { label: 'Rationale paragraph',               scope: 'selection', prompt: 'Expand the highlighted rationale into a full paragraph citing the pre-clinical / earlier-phase evidence.' },
      { label: 'Statistical plan — assumptions',    scope: 'section',   prompt: 'Rewrite as a short statistical-assumptions paragraph: population size, power, alpha, estimated effect size, dropout rate assumption.' },
    ],
  },
  'protocol-amendment': {
    title: 'Protocol amendment',
    prompts: [
      { label: 'Summary of change',   scope: 'section',   prompt: 'Write a 2-sentence summary describing the amendment: what changed, and why it matters to the study.' },
      { label: 'Risk/benefit note',   scope: 'section',   prompt: 'Add a short risk/benefit paragraph assessing whether the amendment affects participant safety or data integrity.' },
    ],
  },
  'ib': {
    title: 'Investigator Brochure',
    prompts: [
      { label: 'Mechanism of action — intro',  scope: 'section',   prompt: 'Rewrite the mechanism-of-action introduction for a prescribing clinician reader, two short paragraphs max.' },
      { label: 'Pharmacology summary bullet',  scope: 'selection', prompt: 'Convert the highlighted passage into 3-5 bullets summarising key pharmacology properties.' },
      { label: 'Non-clinical safety table',    scope: 'section',   prompt: 'Rewrite the non-clinical safety summary with a NOAEL/LOAEL phrasing per species, no editorial.' },
    ],
  },
  'icf': {
    title: 'Informed Consent Form',
    prompts: [
      { label: 'Reading level — simplify',       scope: 'section',   prompt: 'Rewrite at a Flesch-Kincaid grade 6-8 reading level while keeping every risk and benefit statement.' },
      { label: 'Section header — plain question', scope: 'selection', prompt: 'Rewrite as a plain-English question header, e.g., "What happens if I say yes?"' },
      { label: 'Add risk summary bullet',        scope: 'section',   prompt: 'Add a 3-bullet summary at the end: the biggest risk, the biggest benefit, and what happens if I withdraw. Do not add new risks.' },
    ],
  },
  'safety-narrative': {
    title: 'Safety narrative (SAE)',
    prompts: [
      { label: 'Narrative — ICH E3 §12 format', scope: 'section',   prompt: 'Rewrite in ICH E3 §12 narrative style. Chronological: patient demographics, event onset, action taken, outcome, investigator causality assessment.' },
      { label: 'Add causality reasoning',       scope: 'section',   prompt: 'Add a short paragraph with the investigator causality reasoning referencing the temporal relationship + dechallenge/rechallenge status if any.' },
      { label: 'Condense preamble',             scope: 'selection', prompt: 'Condense the highlighted patient-background preamble to one sentence covering sex, age, main comorbidities, and concomitant meds.' },
    ],
  },
  'dsur': {
    title: 'DSUR',
    prompts: [
      { label: 'Executive summary — tighten', scope: 'section',   prompt: 'Rewrite the executive summary as a single paragraph covering the ongoing clinical programme, cumulative exposure, any new identified risks, and the overall benefit-risk conclusion.' },
      { label: 'SUSAR table — prose summary', scope: 'section',   prompt: 'Convert the SUSAR table into a short prose summary of the cumulative total and any patterns by SOC.' },
    ],
  },
  'end-of-study-summary': {
    title: 'End-of-study summary',
    prompts: [
      { label: 'Overall conclusion',  scope: 'section',   prompt: 'Write a 2-paragraph overall conclusion: whether the primary objective was met, and the implications for the development programme.' },
    ],
  },
  'patient-narrative': {
    title: 'Patient narrative',
    prompts: [
      { label: 'Narrative — ICH E3 §14 format', scope: 'section',   prompt: 'Rewrite in ICH E3 §14 patient-narrative style: demographics line, enrolment + treatment history, events of interest with onset/outcome, concomitant medications, final disposition.' },
    ],
  },
}

/**
 * Returns groups the Help panel should render for the given document type.
 * The doc-type-specific group (if any) comes first; the "Any section" group
 * always comes last so general-purpose prompts stay discoverable.
 */
export function suggestedPromptsFor(docType: string | undefined): PromptGroup[] {
  const groups: PromptGroup[] = []
  const specific = docType ? DOCUMENT_PROMPTS[docType as DocumentType] : undefined
  if (specific) groups.push(specific)
  groups.push(ANY_SECTION)
  return groups
}
