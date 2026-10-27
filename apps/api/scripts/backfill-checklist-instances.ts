// Backfill: create a ChecklistInstance for every Document that doesn't have
// one. Reuses the production ensureChecklistInstance helper so the result is
// bit-identical to what the API self-heal path would produce when a user
// opens the document for the first time — same deliverable-type normalisation
// (hyphens → underscores), same fallback-template behaviour.
//
// Actor is the document's createdBy — the fallback-template changeReason
// row attributes the auto-create to the original author rather than to a
// fictitious "system" user.
//
// Dry run by default; pass --apply to perform the writes.

import { PrismaClient } from '@prisma/client'
import { ensureChecklistInstance } from '../src/modules/clinical-writing/checklist/service.js'

const prisma = new PrismaClient()

async function main() {
  const apply = process.argv.includes('--apply')
  const mode = apply ? 'APPLY' : 'DRY RUN'
  console.log(`\n=== Checklist instance backfill — ${mode} ===\n`)

  // Documents without a ChecklistInstance. Using a left-join style query
  // via findMany + a filter on the relation would be simpler but Prisma
  // doesn't support WHERE EXISTS directly; two queries + a Set diff is
  // explicit and cheap at this cardinality.
  const docs = await prisma.document.findMany({
    where: { deletedAt: null },
    select: { id: true, type: true, title: true, createdBy: true, projectId: true },
    orderBy: { createdAt: 'asc' },
  })
  const existing = await prisma.checklistInstance.findMany({ select: { documentId: true } })
  const haveInstance = new Set(existing.map(r => r.documentId))

  const needs = docs.filter(d => !haveInstance.has(d.id))
  console.log(`Documents total:            ${docs.length}`)
  console.log(`Already have an instance:   ${docs.length - needs.length}`)
  console.log(`To backfill:                ${needs.length}\n`)

  if (needs.length === 0) {
    console.log('Nothing to do.')
    return
  }

  let created = 0
  let skipped = 0
  const errors: Array<{ documentId: string; error: string }> = []

  for (const doc of needs) {
    const label = `  doc=${doc.id}  type=${doc.type.padEnd(28)}  project=${doc.projectId}`
    if (!apply) {
      console.log(`[plan]  ${label}`)
      continue
    }
    try {
      const instance = await ensureChecklistInstance(prisma, {
        documentId: doc.id,
        deliverableType: doc.type,
        actorId: doc.createdBy,
      })
      // ensureChecklistInstance returns the existing row when one already
      // exists (idempotent). The pre-filter should mean we always create,
      // but a concurrent write could race us — detect that case.
      if (instance.createdAt.getTime() >= Date.now() - 60_000) {
        created++
        console.log(`[ok]    ${label}  → ${instance.id}`)
      } else {
        skipped++
        console.log(`[skip]  ${label}  (already existed)`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({ documentId: doc.id, error: msg })
      console.log(`[FAIL]  ${label}  — ${msg}`)
    }
  }

  console.log('\n=== Summary ===')
  if (apply) {
    console.log(`Created:  ${created}`)
    console.log(`Skipped:  ${skipped}`)
    console.log(`Errors:   ${errors.length}`)
    if (errors.length > 0) {
      process.exitCode = 1
    }
  } else {
    console.log(`Would create: ${needs.length}`)
    console.log('\n(dry run — re-run with --apply to perform the writes)')
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
