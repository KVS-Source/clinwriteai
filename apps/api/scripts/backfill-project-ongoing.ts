// Backfill: move projects still at Initiated to Ongoing when work on them has already started, meaning at
// least one document is past Not Started. One-time; safe to re-run, because a project that has moved no
// longer matches. Going forward noteAuthoringStarted (src/modules/projects/auto-status.ts) does this as it
// happens. Each move gets an audit entry, so it shows in the project's Status history.
//
// Never touches a project on hold, closed, re-opened or already ongoing, or one whose documents are all
// still Not Started. Listed at the end, so what was left alone is visible.
//
// Dry run by default; pass --apply to perform the writes.
//
//   npx tsx --env-file=.env scripts/backfill-project-ongoing.ts
//   npx tsx --env-file=.env scripts/backfill-project-ongoing.ts --apply

import { PrismaClient } from '@prisma/client'
import { PostgresAuditRepository } from '../src/audit/postgres-repository.js'
import { automaticMoveDetails, documentLabel } from '../src/modules/projects/auto-status.js'
import { PROJECT_STATE_CHANGED } from '../src/modules/projects/state-machine.js'

const prisma = new PrismaClient()
const ACTOR = 'system:backfill-project-ongoing'

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n=== Project Ongoing backfill: ${apply ? 'APPLY' : 'DRY RUN'} ===\n`)

  const secret = process.env.AUDIT_HASH_SECRET
  if (apply && (!secret || secret.length < 32)) throw new Error('AUDIT_HASH_SECRET is required with --apply: every move gets an audit entry')
  const audit = apply ? new PostgresAuditRepository(prisma, secret!) : null

  const projects = await prisma.project.findMany({
    where: { status: 'initiated' },
    select: { id: true, shortTitle: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Projects at Initiated: ${projects.length}\n`)

  let done = 0
  const leftAlone: string[] = []
  for (const project of projects) {
    const docs = await prisma.document.findMany({
      where: { projectId: project.id, deletedAt: null },
      select: { id: true, title: true, type: true, status: true },
      orderBy: { createdAt: 'asc' },
    })
    const started = docs.filter(d => d.status !== 'not_started')
    const label = `${project.id.padEnd(38)}  ${project.shortTitle}`
    if (started.length === 0) {
      leftAlone.push(`${label}  (${docs.length === 0 ? 'no documents' : `${docs.length} document(s), none started`})`)
      continue
    }
    const summary = `${label}  (${started.length} of ${docs.length} started: ${started.map(d => `${documentLabel(d)} [${d.status}]`).join(', ')})`

    if (!audit) {
      console.log(`[plan] ${summary}`)
      done++
      continue
    }
    const moved = await prisma.project.updateMany({
      where: { id: project.id, status: 'initiated' },
      data: { status: 'ongoing' },
    })
    if (moved.count === 0) { leftAlone.push(`${label}  (moved by someone else meanwhile)`); continue }
    await audit.append({
      timestamp: new Date().toISOString(),
      actorId: ACTOR,
      action: PROJECT_STATE_CHANGED,
      entityType: 'project',
      entityId: project.id,
      details: { ...automaticMoveDetails('work_already_started', documentLabel(started[0]!)), documentId: started[0]!.id, startedDocuments: started.length },
      ipAddress: null,
    })
    console.log(`[done] ${summary}`)
    done++
  }

  console.log(`\n${apply ? 'Moved to Ongoing' : 'Would move to Ongoing'}: ${done}`)
  console.log(`Left at Initiated: ${leftAlone.length}`)
  for (const s of leftAlone) console.log(`  ${s}`)
  if (!apply) console.log('\n(dry run: re-run with --apply to perform the writes)')
}

main().catch((err) => { console.error(err); process.exitCode = 1 }).finally(() => prisma.$disconnect())
