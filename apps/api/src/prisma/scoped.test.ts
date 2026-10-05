// Verifies withTenantScope actually sets the app.tenant_id GUC inside
// the tx and clears it when the tx ends. Requires a live Postgres —
// skipped if DATABASE_URL isn't set so the normal unit-test run against
// a cold DB doesn't fail.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { withTenantScope } from './scoped.js'

const dbUrl = process.env.DATABASE_URL
const SKIP = !dbUrl

describe.skipIf(SKIP)('withTenantScope', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('sets app.tenant_id inside the tx', async () => {
    const seen = await withTenantScope(prisma, 'tenant-abc', async (tx) => {
      const rows = await tx.$queryRaw<Array<{ value: string }>>`SELECT current_setting('app.tenant_id', true) AS value`
      return rows[0]?.value
    })
    expect(seen).toBe('tenant-abc')
  })

  it('leaves no residual setting after the tx (SET LOCAL semantics)', async () => {
    await withTenantScope(prisma, 'tenant-xyz', async () => undefined)
    // Outside the tx, the setting is back to null/''.
    const rows = await prisma.$queryRaw<Array<{ value: string }>>`SELECT current_setting('app.tenant_id', true) AS value`
    const residual = rows[0]?.value
    expect(residual === '' || residual === null || residual === undefined).toBe(true)
  })

  it('tenantId=null runs the tx without setting the GUC', async () => {
    const seen = await withTenantScope(prisma, null, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ value: string }>>`SELECT current_setting('app.tenant_id', true) AS value`
      return rows[0]?.value
    })
    // Policies interpret empty/null as the permissive bypass branch.
    expect(seen === '' || seen === null || seen === undefined).toBe(true)
  })

  it('rolls back the GUC change if the tx throws', async () => {
    await expect(
      withTenantScope(prisma, 'tenant-fail', async () => {
        throw new Error('intentional')
      }),
    ).rejects.toThrow('intentional')
    // The setting shouldn't bleed across — same as the "no residual" test.
    const rows = await prisma.$queryRaw<Array<{ value: string }>>`SELECT current_setting('app.tenant_id', true) AS value`
    const residual = rows[0]?.value
    expect(residual === '' || residual === null || residual === undefined).toBe(true)
  })
})
