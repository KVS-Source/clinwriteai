// TA-tag validation helpers shared by the routes that write a therapeutic
// area (projects, Module A documents).
//
// Projects + documents store the TA *label* ('Oncology'), not the code.
// Matching is case-insensitive and the canonical label from the master list
// is what gets persisted, so 'oncology' and 'Oncology' never diverge.

import type { PrismaClient } from '@prisma/client'

/** Canonical label of the active TA matching `label`, or null if none. */
export async function findActiveTaLabel(prisma: PrismaClient, label: string): Promise<string | null> {
  const row = await prisma.therapeuticArea.findFirst({
    where: { label: { equals: label.trim(), mode: 'insensitive' }, status: 'active' },
    select: { label: true },
  })
  return row?.label ?? null
}

/**
 * Resolves a TA a client asked to write. Inheriting `inherited` (usually
 * the owning project's TA) is always allowed — even if it predates the
 * master list; anything else must be an active TA. Returns the label to
 * persist, or null if the request should be rejected with invalidTaBody().
 */
export async function resolveTa(
  prisma: PrismaClient,
  requested: string,
  inherited?: string | null,
): Promise<string | null> {
  if (inherited && sameTa(requested, inherited)) return inherited
  return findActiveTaLabel(prisma, requested)
}

export const sameTa =(a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

export const invalidTaBody = (label: string) => ({
  error: 'invalid_therapeutic_area',
  message: `"${label}" is not an active therapeutic area. Pick one from Admin → TA Tags.`,
})
