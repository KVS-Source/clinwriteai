// Derive the "before" HTML for a clinical-section EditHistory row without
// storing it redundantly on the row itself.
//
// Each save used to persist both beforeHtml + afterHtml, which doubled the
// edit-history storage for Module A. In practice beforeHtml is almost always
// a copy of the previous row's afterHtml (last save's output = this save's
// input), so we stop writing it for new rows and derive it on read.
//
// Backward compatibility: legacy rows that still carry beforeHtml keep
// working — the helper uses the stored value when present and only falls
// back to the previous-row lookup when it's null. No data migration needed;
// old rows reclaim space naturally if an operator ever decides to NULL them
// out in bulk.

interface EditHistoryRefForDerive {
  id:        string
  entityType: string
  entityId:  string
  subUnitId: string | null
  createdAt: Date
  beforeHtml: string | null
}

interface PrismaLike {
  editHistory: {
    findFirst(args: {
      where: {
        entityType: string
        entityId:   string
        subUnitId:  string | null
        createdAt:  { lt: Date }
        id:         { not: string }
      }
      orderBy: { createdAt: 'desc' }
      select:  { afterHtml: true }
    }): Promise<{ afterHtml: string } | null>
  }
}

/** Resolve the "before" state for a single row. Returns the stored
 *  beforeHtml when present (legacy rows), otherwise walks back to the
 *  previous EditHistory row for the same (entityType, entityId, subUnitId)
 *  and returns its afterHtml. Falls back to an empty string when the row
 *  is the first-ever edit on this entity. */
export async function deriveBeforeHtml(
  tx: PrismaLike,
  target: EditHistoryRefForDerive,
): Promise<string> {
  if (target.beforeHtml !== null) return target.beforeHtml
  const prev = await tx.editHistory.findFirst({
    where: {
      entityType: target.entityType,
      entityId:   target.entityId,
      subUnitId:  target.subUnitId,
      createdAt:  { lt: target.createdAt },
      id:         { not: target.id },
    },
    orderBy: { createdAt: 'desc' },
    select:  { afterHtml: true },
  })
  return prev?.afterHtml ?? ''
}

/** Batch form — walks an already-sorted history list and fills in derived
 *  beforeHtml for every row whose stored value is null. Avoids N+1 Prisma
 *  round-trips when rendering the history panel.
 *
 *  The input list must be sorted ASCENDING by createdAt. Returns a new
 *  array with each row's effective beforeHtml resolved. */
export function enrichWithDerivedBefore<T extends {
  beforeHtml: string | null
  afterHtml:  string
}>(rowsAsc: T[]): Array<T & { effectiveBeforeHtml: string }> {
  const out: Array<T & { effectiveBeforeHtml: string }> = []
  for (let i = 0; i < rowsAsc.length; i++) {
    const row = rowsAsc[i]!
    const effective = row.beforeHtml ?? (i > 0 ? rowsAsc[i - 1]!.afterHtml : '')
    out.push({ ...row, effectiveBeforeHtml: effective })
  }
  return out
}
