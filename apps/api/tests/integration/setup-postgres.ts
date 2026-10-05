// Shared test harness — spins up a Postgres container, runs the real
// migrations against it, and hands back a Prisma client bound to that URL.
//
// Why Testcontainers over a shared dev DB:
//   - Hermetic: each test file gets its own schema in a fresh container.
//   - Immutability triggers on audit_events are exercised exactly as prod.
//   - CI parity: GitHub Actions runs the identical container image.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API_ROOT = resolve(__dirname, '..', '..')

export interface TestDb {
  prisma: PrismaClient
  databaseUrl: string
  stop: () => Promise<void>
}

export async function startPostgres(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('platform_test')
    .withUsername('platform')
    .withPassword('platform')
    .start()

  const databaseUrl = container.getConnectionUri() + '?schema=public'

  execSync('npx prisma migrate deploy', {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await prisma.$connect()

  return {
    prisma,
    databaseUrl,
    async stop() {
      await prisma.$disconnect()
      await container.stop()
    },
  }
}
