// Connection-pool settings for Prisma, applied to DATABASE_URL in code so every
// developer's process gets them without editing their own (git-ignored) .env.
//
// Prisma's default pool is (CPU cores × 2 + 1) connections per process, and it never
// closes idle ones — so on the shared dev database a laptop with the API and the worker
// running held 30–50 idle connections, and a few laptops filled the server's 100.
//
//   connection_limit  — what the URL says; else DB_CONNECTION_LIMIT; else, outside
//                       production, `devLimit`. Production keeps Prisma's default unless
//                       DB_CONNECTION_LIMIT is set (its URL comes from the deploy secrets).
//   application_name  — what the URL says; else "<app>@<host>", so pg_stat_activity
//                       shows which process on which machine holds each connection.

import { hostname } from 'node:os'

export interface PoolOptions {
  app: string                 // e.g. 'clinwrite-api'
  devLimit: number            // pool size outside production when nothing else says
  env?: NodeJS.ProcessEnv
  host?: string
}

export function withPoolSettings(databaseUrl: string, opts: PoolOptions): string {
  const env = opts.env ?? process.env
  let url: URL
  try { url = new URL(databaseUrl) } catch { return databaseUrl }      // leave anything unparseable to Prisma's own error

  const params = url.searchParams
  if (!params.has('connection_limit')) {
    const configured = Number(env.DB_CONNECTION_LIMIT)
    const limit = Number.isInteger(configured) && configured > 0
      ? configured
      : env.NODE_ENV === 'production' ? null : opts.devLimit
    if (limit !== null) params.set('connection_limit', String(limit))
  }
  if (!params.has('application_name')) {
    const host = (opts.host ?? hostname()).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 30)
    params.set('application_name', `${opts.app}@${host}`.slice(0, 63))   // Postgres keeps 63 characters
  }
  return url.toString()
}
