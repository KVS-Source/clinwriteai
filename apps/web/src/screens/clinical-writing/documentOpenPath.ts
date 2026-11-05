// Which tab a document opens on from a list, by where the document is in its lifecycle. Status decides
// first: a document can stay at the CRM stage after the meeting ends, and by then the next step is signing.
//
//   signed             → Final Document
//   pending-signature  → E-Signature
//   crm-in-progress    → CRM (also any document at the CRM stage)
//   everything else    → Editor

import type { Document } from '@platform/types'

export function documentOpenPath(doc: Pick<Document, 'id' | 'status' | 'stage'>, projectId: string): string {
  const base = `/projects/${projectId}/clinical-writing/documents/${doc.id}`
  if (doc.status === 'signed') return `${base}/final`
  if (doc.status === 'pending-signature') return `${base}/sign`
  if (doc.status === 'crm-in-progress' || doc.stage === 'crm') return `${base}/crm`
  return base
}
