// DocumentRaci service — insert-time enforcement of the three rules in
// docs/roles-and-permissions.md §3.2 + §4.1 + §4.2:
//
//   1. Capability match. R → can-author, A → can-approve, C → can-review.
//      I has no capability requirement. Tenant-admin self-grant is
//      allowed without a capability (admin.self_grant audit event is
//      emitted — handled in routes.ts).
//
//   2. No two letters on the same (document, user, section_id). The
//      author of a section cannot also be its approver — self-review.
//      The DB uniqueness index catches the exact-duplicate case; this
//      service rejects the "different letter, same section" case the
//      index can't see.
//
//   3. No whole-doc letter (section_id NULL) alongside a per-section
//      letter for the same user — contradiction (owning the whole doc
//      and owning one section are mutually exclusive).
//
// The service returns a tagged result rather than throwing so the route
// handler can map each failure cleanly to an HTTP response.

import type { PrismaClient } from '@prisma/client'
import type { Capability } from '../../../auth/rbac.js'

export type RaciLetter = 'R' | 'A' | 'C' | 'I' | 'Q'

export interface RaciInsertInput {
  documentId: string
  userId: string
  letter: RaciLetter
  sectionId: string | null
  approvalOrder: number | null
  signatureRequired: boolean
  signatureMeaning: string | null
  assignedBy: string                                           // actor
  isActorTenantAdmin: boolean                                  // sourced from request.user by caller
}

export type ValidationFailure =
  | { kind: 'user_not_found'; userId: string }
  | { kind: 'document_not_found'; documentId: string }
  | { kind: 'invalid_letter'; letter: string }
  | { kind: 'missing_capability'; required: Capability; letter: RaciLetter }
  | { kind: 'self_grant_denied'; reason: string }
  | { kind: 'duplicate_letter_on_section'; existingLetter: RaciLetter }
  | { kind: 'whole_doc_vs_section_conflict' }
  | { kind: 'approval_order_requires_a_letter' }
  | { kind: 'signature_meaning_required' }

export type ValidationResult =
  | { ok: true }
  | { ok: false; failure: ValidationFailure }

const LETTER_TO_CAPABILITY: Record<RaciLetter, Capability | null> = {
  R: 'can-author',
  A: 'can-approve',
  C: 'can-review',
  I: null,
  Q: 'can-qc',
}

export const VALID_LETTERS: ReadonlyArray<RaciLetter> = ['R', 'A', 'C', 'I', 'Q']

export async function validateRaciInsert(
  prisma: PrismaClient,
  input: RaciInsertInput,
): Promise<ValidationResult> {
  // --- Shape checks ---------------------------------------------------
  if (!VALID_LETTERS.includes(input.letter)) {
    return { ok: false, failure: { kind: 'invalid_letter', letter: input.letter } }
  }

  if (input.approvalOrder !== null && input.letter !== 'A') {
    return { ok: false, failure: { kind: 'approval_order_requires_a_letter' } }
  }

  if (input.signatureRequired && !input.signatureMeaning) {
    return { ok: false, failure: { kind: 'signature_meaning_required' } }
  }

  // --- Entity existence ----------------------------------------------
  const [user, document] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, capabilities: true, role: true } }),
    prisma.document.findUnique({ where: { id: input.documentId }, select: { id: true } }),
  ])

  if (!user) return { ok: false, failure: { kind: 'user_not_found', userId: input.userId } }
  if (!document) return { ok: false, failure: { kind: 'document_not_found', documentId: input.documentId } }

  // --- Capability enforcement ----------------------------------------
  const requiredCap = LETTER_TO_CAPABILITY[input.letter]
  if (requiredCap) {
    const userCaps = (user.capabilities ?? []) as Capability[]
    const hasCap = userCaps.includes(requiredCap)
    // Self-grant branch: a tenant-admin assigning themselves does not
    // need the capability. The admin.self_grant audit event is emitted
    // by the route handler; the service just permits the insert.
    const isSelfAdminGrant =
      input.userId === input.assignedBy &&
      input.isActorTenantAdmin
    if (!hasCap && !isSelfAdminGrant) {
      return { ok: false, failure: { kind: 'missing_capability', required: requiredCap, letter: input.letter } }
    }
  }

  // --- Multi-letter-per-user rules -----------------------------------
  // Pull every active row for this (doc, user) in one query; filter in-process.
  const existingRows = await prisma.documentRaci.findMany({
    where: {
      documentId: input.documentId,
      userId: input.userId,
      removedAt: null,
    },
    select: { letter: true, sectionId: true },
  })

  for (const existing of existingRows) {
    // Rule 2: no two letters on the same (doc, user, section).
    if (existing.sectionId === input.sectionId && existing.letter !== input.letter) {
      return {
        ok: false,
        failure: { kind: 'duplicate_letter_on_section', existingLetter: existing.letter as RaciLetter },
      }
    }
    // Rule 3: no whole-doc + per-section mix.
    const incomingIsWholeDoc = input.sectionId === null
    const existingIsWholeDoc = existing.sectionId === null
    if (incomingIsWholeDoc !== existingIsWholeDoc) {
      return { ok: false, failure: { kind: 'whole_doc_vs_section_conflict' } }
    }
  }

  return { ok: true }
}
