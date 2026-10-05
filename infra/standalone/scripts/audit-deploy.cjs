#!/usr/bin/env node
/* audit-deploy — writes a `deploy.executed` row to audit_events after a
 * successful blue/green cutover. Invoked from deploy-bluegreen.sh. Keeps
 * the compliance chain honest: every colour flip has a Part 11 record.
 *
 * Env (set by caller):
 *   DATABASE_URL       — Postgres connection string
 *   AUDIT_HASH_SECRET  — audit chain secret (must match the API's)
 *   DEPLOY_COLOUR      — blue|green — the new active colour
 *   DEPLOY_COMMIT      — short SHA of the deployed commit
 *   DEPLOY_ACTOR       — optional override (defaults to 'deploy-script')
 *
 * Exit 0 on success. Non-zero on failure; caller logs and continues.
 */

const { PrismaClient } = require('@prisma/client')
const { createHash } = require('node:crypto')
const os = require('node:os')

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  const entries = Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
  return '{' + entries.map(([k, val]) => JSON.stringify(k) + ':' + canonical(val)).join(',') + '}'
}

async function main() {
  const colour = process.env.DEPLOY_COLOUR
  const commit = process.env.DEPLOY_COMMIT
  const actor = process.env.DEPLOY_ACTOR || 'deploy-script'
  const secret = process.env.AUDIT_HASH_SECRET

  if (!colour || !commit) {
    console.error('audit-deploy: DEPLOY_COLOUR and DEPLOY_COMMIT required')
    process.exit(2)
  }
  if (!secret || secret.length < 32) {
    console.error('audit-deploy: AUDIT_HASH_SECRET missing or shorter than 32 chars')
    process.exit(2)
  }

  const prisma = new PrismaClient()
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1)', 7438912041n % 2147483647n)
      const last = await tx.$queryRawUnsafe(
        'SELECT row_hash FROM audit_events ORDER BY id DESC LIMIT 1',
      )
      const prevHash = last[0] ? last[0].row_hash : ''

      const event = {
        timestamp: new Date().toISOString(),
        actorId: actor,
        action: 'deploy.executed',
        entityType: 'platform',
        entityId: colour,
        details: { commit, colour, host: os.hostname() },
        ipAddress: null,
      }

      const h = createHash('sha256')
      h.update(prevHash, 'utf8'); h.update('|', 'utf8')
      h.update(canonical(event), 'utf8'); h.update('|', 'utf8')
      h.update(secret, 'utf8')
      const rowHash = h.digest('hex')

      await tx.$queryRawUnsafe(
        `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details, ip_address, prev_hash, row_hash, "timestamp")
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING id`,
        event.actorId, event.action, event.entityType, event.entityId,
        JSON.stringify(event.details), event.ipAddress, prevHash, rowHash,
        new Date(event.timestamp),
      )
    })

    console.log(`audit-deploy: recorded ${colour}@${commit}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('audit-deploy failed:', err)
  process.exit(1)
})
