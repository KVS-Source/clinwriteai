import type { PrismaClient } from '@prisma/client'

// Who can be in a CRM meeting on a document (action table row 18; CW-014, CW-098).
//   - Attend: anyone with a part on this document (any RACI letter, or the assignee) and the project's
//     PMs. Informed (I) people attend, as participants only.
//   - Chair: a PM, or an Author (R), Reviewer (C) or Approver (A) of the document. Not QC (Q) alone,
//     not Informed, and never an admin or an auditor.
// Names come from the document's own RACI and the project's members — not from a list of every user.

export interface CrmPerson {
  id: string
  name: string
  initials: string | null
  letters: string[]       // the RACI letters held on the document
  isPm: boolean
  canChair: boolean
}

const CHAIR_LETTERS = new Set(['R', 'C', 'A'])
const NOT_IN_MEETINGS = ['admin', 'tenant-admin', 'super-admin', 'auditor', 'read-only', 'qc', 'guest']

// `callerPmId`: a PM who can see the project but is not one of its listed members may still chair and attend
// a meeting they schedule, so the caller passes their own id when they are a PM.
export async function crmPeople(prisma: PrismaClient, documentId: string, callerPmId?: string): Promise<CrmPerson[] | null> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { projectId: true, assigneeId: true } })
  if (!doc) return null
  const [raci, members] = await Promise.all([
    prisma.documentRaci.findMany({ where: { documentId, removedAt: null }, select: { userId: true, letter: true } }),
    prisma.projectMember.findMany({ where: { projectId: doc.projectId, removedAt: null }, select: { userId: true, user: { select: { role: true } } } }),
  ])
  const letters = new Map<string, Set<string>>()
  for (const r of raci) letters.set(r.userId, (letters.get(r.userId) ?? new Set()).add(r.letter))
  if (doc.assigneeId) letters.set(doc.assigneeId, (letters.get(doc.assigneeId) ?? new Set()).add('R'))
  const pmIds = new Set(members.filter(m => m.user?.role === 'pm').map(m => m.userId))
  if (callerPmId) pmIds.add(callerPmId)

  const ids = [...new Set([...letters.keys(), ...pmIds])]
  if (ids.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, status: 'active', role: { notIn: NOT_IN_MEETINGS } },
    select: { id: true, name: true, initials: true },
    orderBy: { name: 'asc' },
  })
  return users.map(u => {
    const held = [...(letters.get(u.id) ?? [])].sort()
    const isPm = pmIds.has(u.id)
    return { id: u.id, name: u.name, initials: u.initials, letters: held, isPm, canChair: isPm || held.some(l => CHAIR_LETTERS.has(l)) }
  })
}

export const CRM_PEOPLE_INVALID = (what: 'chair' | 'attendee') => ({
  error: 'crm_people_invalid',
  message: what === 'chair'
    ? 'The chair must be the project manager or an Author (R), Reviewer (C) or Approver (A) of this document.'
    : 'Attendees must be people on this document (any RACI letter) or the project manager.',
}) as const
