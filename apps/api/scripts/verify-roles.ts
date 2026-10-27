// Diagnostic: confirm the 2026-10-27 role consolidation landed in QA.
// No super-admin rows should remain; every platform admin should have
// role='admin' + tenantId=null.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const stale = await prisma.user.count({ where: { role: 'super-admin' } })
  const platformAdmins = await prisma.user.findMany({
    where: { role: 'admin', tenantId: null },
    select: { id: true, email: true, name: true, status: true },
    orderBy: { email: 'asc' },
  })
  const tenantAdmins = await prisma.user.count({ where: { role: 'admin', tenantId: { not: null } } })
  const roles = await prisma.user.groupBy({
    by: ['role'],
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
  })

  console.log('\n=== Role consolidation verification ===\n')
  console.log(`Stale 'super-admin' rows:   ${stale}`)
  console.log(`Platform admins (tenant=null): ${platformAdmins.length}`)
  console.log(`Tenant-scoped admins:          ${tenantAdmins}\n`)
  console.log('Platform admin accounts:')
  for (const u of platformAdmins) {
    console.log(`  ${u.id.padEnd(42)} ${u.email.padEnd(32)} ${u.name.padEnd(24)} ${u.status}`)
  }
  console.log('\nRole distribution:')
  for (const r of roles) {
    console.log(`  ${(r.role ?? '(null)').padEnd(24)} ${r._count._all}`)
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
