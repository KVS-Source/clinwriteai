// Who may make each document status move through the generic POST /documents/:id/transition
// (CW-006). The dedicated routes (submit for review, mark review done, CRM, e-signature) check the
// caller's own RACI row; this table gives the generic route the same rule, from the action table:
//   row 11  submit for review                   Author (R)         (never through this route)
//   row 12  review done / QC complete           Reviewer (C), QC (Q)
//   row 14  return / reject, back to authoring  Reviewer (C), QC (Q), Approver (A)
//   row 18/27  CRM done, then signature         Author (R), Approver (A)
//   row 28  signed                              Approver (A), once the chain is complete
// Admins, PMs, auditors and Informed (I) never move a document between statuses.

import type { DocumentStatus } from '../document-status.js'

const RETURNABLE: ReadonlySet<DocumentStatus> = new Set(['in_review', 'crm_in_progress', 'pending_signature'])

export function lettersForTransition(from: DocumentStatus, to: DocumentStatus): readonly string[] {
  if (to === 'in_authoring' && RETURNABLE.has(from)) return ['A', 'C', 'Q']
  if (from === 'not_started' && to === 'in_authoring') return ['R']
  if (from === 'in_review' && to === 'crm_in_progress') return ['C', 'Q']
  if (from === 'crm_in_progress' && to === 'pending_signature') return ['R', 'A']
  if (from === 'pending_signature' && to === 'signed') return ['A']
  return []
}

const LETTER_NAME: Record<string, string> = { R: 'Author (R)', C: 'Reviewer (C)', Q: 'QC (Q)', A: 'Approver (A)' }

export function transitionForbidden(letters: readonly string[]) {
  const names = letters.map(l => LETTER_NAME[l] ?? l)
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? 'the right role')
  return { error: 'transition_forbidden', message: `Only the ${who} on this document can make this status change.` } as const
}
