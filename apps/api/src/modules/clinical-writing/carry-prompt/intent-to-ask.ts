// Collapse the /ai-suggest intent switch down to a single <ask> string
// the carry prompt can carry. When carry mode is active we replace the
// intent-templated prompt wholesale, so this is the one place where the
// intent → instruction mapping lives.
//
// The strings mirror the shortest form of each legacy intent prompt —
// the carry prompt supplies rules + section + sources separately, so
// repeating "Section: §X.Y" or "Current content: …" here would double
// what the model already sees.

export type CarrySuggestIntent =
  | 'tighten'
  | 'explain'
  | 'draft_from_source'
  | 'custom'
  | 'edit'

export interface IntentToAskInputs {
  intent:        CarrySuggestIntent
  customPrompt?: string
  selectionText?: string
}

export function intentToAsk(inputs: IntentToAskInputs): string {
  switch (inputs.intent) {
    case 'tighten':
      return 'Rewrite this section for clarity. Preserve every data point, number, and reference.'
    case 'explain':
      return 'Explain this section in plain English for a non-expert reviewer. Keep every data point; drop the jargon.'
    case 'draft_from_source':
      return "Draft this section's body from scratch using the provided source excerpts and the brief. Do not invent facts."
    case 'custom':
      return (inputs.customPrompt ?? '').trim()
    case 'edit': {
      const instruction = (inputs.customPrompt ?? '').trim()
      const selection   = (inputs.selectionText ?? '').trim()
      // Return only HTML — tells the model to emit directly usable
      // markup, matching the legacy 'edit' contract. Selection-scoped
      // edits ask for only the revised passage; whole-section edits
      // ask for the complete revised section.
      if (selection.length > 0) {
        return [
          'Edit only the highlighted passage below and return ONLY the revised passage.',
          'Return HTML using only: p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td. No attributes, no explanations, no code fences.',
          '',
          `Instruction: ${instruction}`,
          '',
          `Highlighted passage:\n${selection}`,
        ].join('\n')
      }
      return [
        'Apply the instruction below to the current section content and return the COMPLETE revised section.',
        'Return HTML using only: p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td. No attributes, no explanations, no code fences.',
        '',
        `Instruction: ${instruction}`,
      ].join('\n')
    }
  }
}
