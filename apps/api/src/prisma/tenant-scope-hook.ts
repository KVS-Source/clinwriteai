// Tenant-scope preHandler — Arc 9.2.
//
// Adds a `request.scopedPrisma` getter that returns a TxClient scoped
// to the authenticated user's tenantId. Routes that opt in replace
// `app.prisma.foo.X(...)` with `(await request.scopedPrisma()).foo.X(...)`
// to get Postgres RLS enforcement without each handler reaching for
// `withTenantScope` directly.
//
// IMPORTANT: calling `request.scopedPrisma()` opens a transaction that
// stays open for the lifetime of the caller's await chain. Keep the
// handler short + close over a single tx client; don't call it twice
// in the same request (produces two transactions).
//
// Opt-in: a route adds `{ preHandler: tenantScopePreHandler }` to its
// options. The hook is a no-op when the request isn't authenticated
// (public endpoints like /dpdpa/requests), so it's safe to apply
// globally — but the request.scopedPrisma() call will just return
// the unscoped client in that case.

import type { FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { withTenantScope, type TxClient } from './scoped.js'

declare module 'fastify' {
  interface FastifyRequest {
    // Lazy-opens a transaction with app.tenant_id set to the authenticated
    // user's tenantId. Only safe to call once per request.
    scopedPrisma: () => Promise<TxClient>
  }
}

export const tenantScopePreHandler: preHandlerHookHandler = async (request) => {
  const tenantId = request.user?.tenantId ?? null
  const prisma = (request.server.prisma as PrismaClient)
  let promise: Promise<TxClient> | null = null
  request.scopedPrisma = () => {
    if (promise) return promise
    // withTenantScope opens a $transaction; we want the caller's
    // fn-returned promise. The simplest wiring is a deferred: the
    // caller awaits scopedPrisma(), and once they're done the
    // transaction can commit. For that we expose a resolver pattern.
    promise = new Promise<TxClient>((resolve, reject) => {
      withTenantScope(prisma, tenantId, async (tx) => {
        resolve(tx)
        // Hold the transaction open until the request completes. Using
        // a never-resolving promise here would deadlock the pool; instead
        // we tie it to the request's onResponse hook.
        await new Promise<void>((done) => {
          request.raw.on('close', done)
          request.raw.on('end', done)
        })
      }).catch(reject)
    })
    return promise
  }
}

/**
 * Helper for routes that want the scoped tx without the preHandler
 * dance. Example:
 *
 *   app.get('/x', async (request) => {
 *     return runScoped(request, async (tx) => tx.project.findMany())
 *   })
 *
 * Prefer this over scopedPrisma for one-shot queries — it opens +
 * closes the transaction cleanly inside the handler.
 */
export function runScoped<T>(
  request: FastifyRequest,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const tenantId = request.user?.tenantId ?? null
  return withTenantScope(request.server.prisma, tenantId, fn)
}
