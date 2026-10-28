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

// Statuses where the document is locked for authoring — no section content
// changes and no source references added or removed:
//   - in_review          PRD AC-A-032: "locked for authoring while in review"
//   - pending_signature  signers attest the document hash + version (FR-A-066)
//   - signed             the signed version is never overwritten (FR-A-029b)
// not_started, in_authoring and crm_in_progress (Comments Resolution &
// Finalisation) stay editable. Getting out of a locked status is a
// transition back to in_authoring, which snapshots a new version.
export const AUTHORING_LOCKED_STATUSES: ReadonlyArray<DocumentStatus> = ['in_review', 'pending_signature', 'signed']
export const REFERENCE_LOCKED_STATUSES = AUTHORING_LOCKED_STATUSES

export function authoringLocked(status: string): boolean {
  return (AUTHORING_LOCKED_STATUSES as ReadonlyArray<string>).includes(status)
}

export function referencesLocked(status: string): boolean {
  return authoringLocked(status)
}

const AUTHORING_LOCKED_MESSAGE: Record<string, string> = {
  in_review:         'The document is in review and locked for authoring.',
  pending_signature: 'The document is awaiting signature and locked for authoring.',
  signed:            'The document is signed and locked. Its signed version can’t be changed.',
}

/**
 * Why the document's content can't be changed right now, or null when it can.
 * A closed project is read-only whatever the document's status (PRD: "Closed
 * is a hard, unoverridable read-only state").
 */
export function authoringLockReason(docStatus: string, projectStatus?: string | null): { error: 'document_locked'; status: string; message: string } | null {
  if (projectStatus === 'closed') {
    return { error: 'document_locked', status: docStatus, message: 'The project is closed and read-only.' }
  }
  if (!authoringLocked(docStatus)) return null
  return { error: 'document_locked', status: docStatus, message: AUTHORING_LOCKED_MESSAGE[docStatus] ?? 'The document is locked for authoring.' }
}
