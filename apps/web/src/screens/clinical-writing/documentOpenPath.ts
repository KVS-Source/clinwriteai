// Which tab a document opens on from a list, by where the document is in its lifecycle. Status decides
// first: a document can stay at the CRM stage after the meeting ends, and by then the next step is signing.
//
//   signed             → Final Document
//   pending-signature  → Reviewer View / Approver View (DocumentTabGuard sends everyone else on to E-Signature)
//   crm-in-progress    → CRM (also any document at the CRM stage)
//   everything else    → Editor

import type { Document } from '@platform/types'

export function documentOpenPath(doc: Pick<Document, 'id' | 'status' | 'stage'>, projectId: string): string {
  const base = `/projects/${projectId}/clinical-writing/documents/${doc.id}`
  if (doc.status === 'signed') return `${base}/final`
  // Who may stay on the review tab depends on the user's RACI letters, which the guard on that tab knows.
  if (doc.status === 'pending-signature') return `${base}/review`
  if (doc.status === 'crm-in-progress' || doc.stage === 'crm') return `${base}/crm`
  return base
}
