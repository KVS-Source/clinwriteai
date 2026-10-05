// Document lifecycle state machine (document_status enum).
//
// Source: docs/demo/02-datamodel.md §2 + §4; FR-A-038+ for the review flow.
// Transitions mirror the review loop: a doc can go in_authoring → in_review
// (via submit-for-review); reviewers push it to crm_in_progress once CRM meets;
// pending_signature follows CRM resolution; signed is terminal.
//
// Backwards transitions exist (e.g. in_review → in_authoring if the reviewer
// bounces a doc without CRM), but 'signed' is one-way — once Part 11 e-sig
// chain completes, the only mutation is a brand-new version.

export type DocumentStatus =
  | 'not_started'
  | 'in_authoring'
  | 'in_review'
  | 'crm_in_progress'
  | 'pending_signature'
  | 'signed'

export const DOCUMENT_STATUSES = [
  'not_started', 'in_authoring', 'in_review',
  'crm_in_progress', 'pending_signature', 'signed',
] as const

const ALLOWED: Record<DocumentStatus, ReadonlyArray<DocumentStatus>> = {
  not_started: ['in_authoring'],
  in_authoring: ['in_review'],
  in_review: ['crm_in_progress', 'in_authoring'],   // reviewer bounce
  crm_in_progress: ['pending_signature', 'in_authoring'],
  pending_signature: ['signed', 'in_authoring'],    // signer refusal returns to author
  signed: [],                                       // terminal
}

export function canTransitionDocument(from: DocumentStatus, to: DocumentStatus): boolean {
  if (from === to) return false
  return ALLOWED[from]?.includes(to) ?? false
}

export function nextDocumentStates(from: DocumentStatus): ReadonlyArray<DocumentStatus> {
  return ALLOWED[from] ?? []
}

export class InvalidDocumentTransitionError extends Error {
  constructor(from: DocumentStatus, to: DocumentStatus) {
    super(
      `Invalid document transition: ${from} → ${to}. Allowed next: ${
        nextDocumentStates(from).join(', ') || '(terminal)'
      }`,
    )
    this.name = 'InvalidDocumentTransitionError'
  }
}
