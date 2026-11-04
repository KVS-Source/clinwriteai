// What the signed-in user may do on a document's e-signature screens — the e-signature action table.
// The API enforces these rules; this hook only lets the screens hide what would be refused, and say why.
//
//   start a chain       Author (R) or Approver (A). Never admin, PM, auditor or guest.
//   cancel a chain      the Author (R), or the person who started it.
//   read the record     any RACI letter on the document, a PM, or an auditor. Never admin or guest.
//   Final Document      same as reading the record, except QC (Q) alone, which is N/A for now.
//   export audit trail  PM or auditor.
//   add a comment       Author (R), Reviewer (C), QC (Q) or Approver (A) — action table row 15.
//                       Never admin, PM, auditor, Informed (I) alone, or a signed-in guest.
//   approve / return    Reviewer (C), QC (Q) or Approver (A) — rows 12 and 14. Not the Author.

import { useQuery } from '@tanstack/react-query'
import { raciApi } from '../../api/raci'
import { documentsApi } from '../../api/documents'
import { useCurrentUser } from '../../hooks'

const ADMIN_ROLES   = new Set(['tenant-admin', 'admin', 'super-admin'])
const AUDITOR_ROLES = new Set(['auditor', 'read-only'])

export interface SignatureAccess {
  /** False until the user and the document's RACI have loaded — don't show a refusal before then. */
  ready: boolean
  isAdmin: boolean
  isPm: boolean
  isAuditor: boolean
  canStartChain: boolean
  canViewRecord: boolean
  canViewFinal: boolean
  canExportAudit: boolean
  canAddComment: boolean
  canGiveVerdict: boolean
  /** The Author (R) may always cancel; anyone else only the chain they started. */
  canCancelChain: (chain: { initiatedBy: string } | undefined) => boolean
}

export function useSignatureAccess(documentId: string | undefined): SignatureAccess {
  const { data: me } = useCurrentUser()
  const raci = useQuery({
    queryKey: ['document-raci', documentId],
    queryFn:  () => raciApi.list(documentId!),
    enabled:  !!documentId,
    retry:    false,
  })
  const doc = useQuery({
    queryKey: ['document', documentId],
    queryFn:  () => documentsApi.get(documentId!),
    enabled:  !!documentId,
  })

  const role      = me?.role ?? ''
  const isAdmin   = ADMIN_ROLES.has(role)
  const isAuditor = AUDITOR_ROLES.has(role)
  const isPm      = role === 'pm'
  const isGuest   = role === 'guest'

  // My active letters on this document (the list also carries removed rows).
  const letters = new Set(
    (raci.data ?? []).filter(r => r.userId === me?.id && !r.removedAt).map(r => r.letter as string),
  )
  const isAssignee = !!me && doc.data?.assigneeId === me.id
  const isAuthor   = !isAdmin && !isPm && (letters.has('R') || isAssignee)
  const isApprover = letters.has('A')

  const hasLetter     = letters.size > 0 || isAssignee
  const canViewRecord = !isAdmin && !isGuest && (isAuditor || isPm || hasLetter)
  // QC (Q) on its own has no access to the Final Document yet (pending the SME's answer).
  const onlyQc        = hasLetter && [...letters].every(l => l === 'Q') && !isAssignee
  const canViewFinal  = canViewRecord && !onlyQc

  return {
    ready: !!me && (!documentId || (!raci.isLoading && !doc.isLoading)),
    isAdmin, isPm, isAuditor,
    canStartChain:  !isAdmin && !isPm && !isAuditor && !isGuest && (isAuthor || isApprover),
    canViewRecord,
    canViewFinal,
    canExportAudit: isPm || isAuditor,
    canAddComment:  !isAdmin && !isPm && !isAuditor && !isGuest
                    && (isAuthor || ['C', 'Q', 'A'].some(l => letters.has(l))),
    canGiveVerdict: !isAdmin && !isPm && !isAuditor && !isGuest
                    && ['C', 'Q', 'A'].some(l => letters.has(l)),
    canCancelChain: chain => !!chain && !!me && (chain.initiatedBy === me.id || isAuthor),
  }
}
