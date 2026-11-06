// Backfill: give documents created without sections their template's empty headings. One-time; safe to
// re-run, because a document that has sections is left alone. Same rule and same code as the
// "Apply template sections" action, and each document gets an audit entry.
//
// Skipped, and listed: a document awaiting signature or signed (its hash is bound to signatures), one in a
// closed project, one with no current version, and a type with no template.
//
// Dry run by default; pass --apply to perform the writes.
//
//   npx tsx --env-file=.env scripts/backfill-template-sections.ts
//   npx tsx --env-file=.env scripts/backfill-template-sections.ts --apply

import { PrismaClient } from '@prisma/client'
import { PostgresAuditRepository } from '../src/audit/postgres-repository.js'
import { addTemplateSections, resolveTemplateSections, SIGNATURE_BOUND_STATUSES } from '../src/modules/clinical-writing/documents/template-sections.js'

const prisma = new PrismaClient()
const ACTOR = 'system:backfill-template-sections'

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n=== Template sections backfill: ${apply ? 'APPLY' : 'DRY RUN'} ===\n`)

  const secret = process.env.AUDIT_HASH_SECRET
  if (apply && (!secret || secret.length < 32)) throw new Error('AUDIT_HASH_SECRET is required with --apply: each change is audited')
  const audit = apply ? new PostgresAuditRepository(prisma, secret!) : null

  const docs = await prisma.document.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, type: true, status: true, projectId: true, currentVersionId: true, currentVersion: { select: { versionNumber: true, contentHash: true, _count: { select: { sections: true } } } } },
    orderBy: { createdAt: 'asc' },
  })
  const empty = docs.filter(d => !d.currentVersion || d.currentVersion._count.sections === 0)
  console.log(`Documents total:     ${docs.length}`)
  console.log(`With no sections:    ${empty.length}\n`)

  let done = 0
  const skipped: string[] = []
  for (const doc of empty) {
    const label = `${doc.id}  ${doc.projectId.padEnd(24)}  ${doc.type.padEnd(20)}  ${doc.status.padEnd(16)}  ${doc.title}`
    const project = await prisma.project.findUnique({ where: { id: doc.projectId }, select: { status: true, submissionCountries: true } })
    if (!doc.currentVersionId || !doc.currentVersion) { skipped.push(`no current version   ${label}`); continue }
    if (SIGNATURE_BOUND_STATUSES.has(doc.status)) { skipped.push(`signature-bound      ${label}`); continue }
    if (project?.status === 'closed') { skipped.push(`project closed       ${label}`); continue }
    const sections = await resolveTemplateSections(prisma, doc.type, project?.submissionCountries ?? [])
    if (sections.length === 0) { skipped.push(`no template          ${label}`); continue }

    if (!audit) {
      console.log(`[plan] +${String(sections.length).padStart(3)} sections  ${label}`)
      done++
      continue
    }
    const added = await addTemplateSections(prisma, doc.currentVersionId, sections)
    if (!added) { skipped.push(`has sections now     ${label}`); continue }
    await audit.append({
      timestamp: new Date().toISOString(),
      actorId: ACTOR,
      action: 'document_template_applied',
      entityType: 'document',
      entityId: doc.id,
      details: { source: 'backfill', versionNumber: doc.currentVersion.versionNumber, sectionCount: added.sectionCount, hashBefore: doc.currentVersion.contentHash, hashAfter: added.contentHash },
      ipAddress: null,
    })
    console.log(`[done] +${String(sections.length).padStart(3)} sections  ${label}`)
    done++
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'}: ${done}`)
  console.log(`Skipped: ${skipped.length}`)
  for (const s of skipped) console.log(`  ${s}`)
  if (!apply) console.log('\n(dry run: re-run with --apply to perform the writes)')
}

main().catch((err) => { console.error(err); process.exitCode = 1 }).finally(() => prisma.$disconnect())
