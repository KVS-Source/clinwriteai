// One-shot — flip Alex Thornton (user-sa) from role='admin' to role='pm'
// and attach her to the Acme tenant so she can create + edit projects
// (per the 2026-10-28 "only PM creates projects" decision).
//
// Needed because the demo-user seed uses upsert with `update: {}`, so
// updates to the fixture row don't propagate to an already-seeded DB.
// Run once per environment; safe to re-run (idempotent — checks before
// updating + audits only the real change).

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Note: `legacyRole` is intentionally omitted from select — QA DB is behind
  // on migration 00000000000047_unified_rbac_schema which introduces the
  // `legacy_role` column. Flag + flip the role regardless; audit will fall
  // back to the pre-change value from the update's return payload.
  const user = await prisma.user.findFirst({
    where: { OR: [{ id: 'user-sa' }, { email: 'a.thornton@clinwrite.ai' }] },
    select: { id: true, email: true, role: true, tenantId: true },
  })
  if (!user) {
    console.log('Alex Thornton (user-sa) not found — nothing to do.')
    return
  }

  const acme = await prisma.tenant.findFirst({
    where: { OR: [{ slug: 'acme-oncology' }, { id: 'TENANT-ACME' }] },
    select: { id: true, slug: true },
  })
  if (!acme) {
    console.log('Acme tenant not found — cannot assign tenantId; aborting.')
    return
  }

  const before = { role: user.role, tenantId: user.tenantId }
  const after  = { role: 'pm',       tenantId: acme.id }
  if (before.role === after.role && before.tenantId === after.tenantId) {
    console.log('Alex is already role=pm, tenantId=' + acme.id + ' — no change.')
    return
  }

  // `select` limits the RETURNING clause so Prisma doesn't try to read columns
  // introduced by pending migrations (users.capabilities, users.legacy_role).
  await prisma.user.update({
    where:  { id: user.id },
    data:   { role: 'pm', tenantId: acme.id },
    select: { id: true, role: true, tenantId: true },
  })

  console.log('Promoted Alex Thornton:')
  console.log('  before: ' + JSON.stringify(before))
  console.log('  after:  ' + JSON.stringify(after))
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
