// Tenant-scoped Prisma helper — opt-in RLS activation.
//
// Routes that want Postgres-level tenant isolation (per ADR 0010 RLS
// infrastructure, migration 00000000000027_rls_infrastructure) call
// `withTenantScope(prisma, tenantId, fn)` instead of `prisma.foo.X(...)`.
// All queries inside `fn` run through a tx client that has set
// `app.tenant_id` for the Postgres session; the RLS policies on
// projects / documents / publications / med_content_items /
// regulatory_submissions / ideation_projects filter accordingly.
//
// Why opt-in: Prisma's connection pool makes session-level GUCs unusable
// (they stick to the connection, not the query). Transaction-level
// GUCs (SET LOCAL) are per-transaction, which is exactly what Prisma's
// `$transaction` interactive mode gives us.
//
// Trade-off: every query inside the scope runs in a single transaction.
// Fine for a request's typical read-write pattern (one or two queries);
// avoid for long-running operations like batch imports — those should
// run outside the scope and rely on app-layer filtering.
//
// Usage:
//   app.get('/x', async (request) => {
//     return withTenantScope(app.prisma, request.user!.tenantId, async (tx) => {
//       return tx.project.findMany()   // RLS enforces tenant isolation
//     })
//   })

import type { PrismaClient, Prisma } from '@prisma/client'

export type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

/**
 * Run `fn` inside a Prisma transaction that has set app.tenant_id. The
 * RLS policies on tenant-scoped tables (ADR 0010) activate for this
 * transaction only.
 *
 * tenantId=null means "no scope override" — the transaction runs with
 * the GUC unset, which the policies interpret as the permissive bypass
 * branch (same behaviour as not calling this helper at all).
 */
export async function withTenantScope<T>(
  prisma: PrismaClient,
  tenantId: string | null,
  fn: (tx: TxClient) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      if (tenantId !== null) {
        // SET LOCAL binds for the duration of this tx only. Postgres
        // parameterises LOCAL settings via `set_config(name, value, true)`.
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      }
      return fn(tx as TxClient)
    },
    {
      // Transactions default to 5s in Prisma; most tenant-scoped reads
      // complete in <100ms. Expose timeoutMs for the handful of ops
      // (large report generation) that need more.
      timeout: options?.timeoutMs ?? 10_000,
      isolationLevel: 'ReadCommitted' as Prisma.TransactionIsolationLevel,
    },
  )
}
