// One-shot cleanup for duplicate ChecklistTemplate rows.
//
// Background
// ----------
// Deliverable-type keys appeared in two spellings — hyphenated at the API
// boundary ('csr-full', 'protocol-amendment', 'safety-narrative') and
// underscored in the DB ('csr_full', 'protocol_amendment', 'safety_narrative').
// The lazy bootstrap used whichever form arrived first, so a project that
// hit GET /checklist for a hyphenated-typed doc produced one template, and
// a different project hitting it for the underscored form produced another.
// Result: multiple ChecklistTemplate rows for the same conceptual key.
//
// The code change (apps/api/src/modules/clinical-writing/checklist/service.ts)
// now normalises every lookup + write to the underscored form, so no new
// duplicates will be created. This script collapses the ones that already
// exist.
//
// How it collapses
// ----------------
// 1. Group every ChecklistTemplate by normaliseDeliverableType(row).
// 2. For each group with >1 row:
//    a. Pick a "keeper" — prefer the row whose deliverableType already
//       equals the normalised form (= underscored). If none, pick the
//       oldest createdAt. Ties broken by id (stable).
//    b. Repoint every ChecklistInstance pointing at an orphan onto the
//       keeper (set templateId + templateVersion to the keeper's).
//    c. Move any ChecklistTemplateItem rows from orphans to the keeper
//       (defensive — in practice all duplicates have 0 items today).
//    d. Delete the orphan ChecklistTemplate rows.
// 3. For single-row groups, if the row's deliverableType differs from its
//    normalised form, rename it in place (updates the key to underscored).
//
// Dry run by default — pass --apply to actually mutate.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function normaliseDeliverableType(s: string): string {
  return s.replace(/-/g, '_')
}

interface TemplateRow {
  id: string
  deliverableType: string
  version: number
  createdAt: Date
  _count: { items: number; instances: number }
}

async function loadTemplates(): Promise<TemplateRow[]> {
  const rows = await prisma.checklistTemplate.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { items: true, instances: true } } },
  })
  return rows.map(r => ({
    id: r.id,
    deliverableType: r.deliverableType,
    version: r.version,
    createdAt: r.createdAt,
    _count: r._count,
  }))
}

function pickKeeper(group: TemplateRow[]): TemplateRow {
  const normalised = normaliseDeliverableType(group[0]!.deliverableType)
  // Prefer the row whose deliverableType already equals the canonical form.
  const canonical = group.find(r => r.deliverableType === normalised)
  if (canonical) return canonical
  // Else oldest wins (stable; createdAt is already sorted asc).
  return group[0]!
}

async function main() {
  const apply = process.argv.includes('--apply')
  const mode = apply ? 'APPLY' : 'DRY RUN'
  console.log(`\n=== Checklist template cleanup — ${mode} ===\n`)

  const rows = await loadTemplates()
  console.log(`Loaded ${rows.length} ChecklistTemplate rows\n`)

  // Group by normalised key. Preserve load order (createdAt asc) within group.
  const groups = new Map<string, TemplateRow[]>()
  for (const r of rows) {
    const key = normaliseDeliverableType(r.deliverableType)
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }

  let plannedMerges = 0
  let plannedRenames = 0
  let plannedInstanceMoves = 0
  let plannedItemMoves = 0
  let plannedOrphanDeletes = 0

  for (const [canonicalKey, group] of groups.entries()) {
    if (group.length === 1) {
      const row = group[0]!
      if (row.deliverableType !== canonicalKey) {
        // Lone row with the wrong spelling — rename to canonical.
        plannedRenames++
        console.log(`[rename]  ${row.deliverableType} → ${canonicalKey}  (id ${row.id})`)
        if (apply) {
          await prisma.checklistTemplate.update({
            where: { id: row.id },
            data: { deliverableType: canonicalKey },
          })
        }
      }
      continue
    }

    plannedMerges++
    const keeper = pickKeeper(group)
    const orphans = group.filter(r => r.id !== keeper.id)

    console.log(`[merge]   '${canonicalKey}' — ${group.length} rows:`)
    console.log(`          keep   ${keeper.deliverableType.padEnd(24)} v${keeper.version} (id ${keeper.id}, items=${keeper._count.items}, instances=${keeper._count.instances})`)
    for (const o of orphans) {
      console.log(`          merge  ${o.deliverableType.padEnd(24)} v${o.version} (id ${o.id}, items=${o._count.items}, instances=${o._count.instances})`)
    }

    const orphanIds = orphans.map(o => o.id)

    // 1. Repoint instances onto the keeper.
    const instanceCount = orphans.reduce((n, o) => n + o._count.instances, 0)
    if (instanceCount > 0) {
      plannedInstanceMoves += instanceCount
      console.log(`          → repoint ${instanceCount} instance${instanceCount === 1 ? '' : 's'} onto keeper`)
      if (apply) {
        await prisma.checklistInstance.updateMany({
          where: { templateId: { in: orphanIds } },
          data: {
            templateId: keeper.id,
            templateVersion: keeper.version,
          },
        })
      }
    }

    // 2. Move template items onto the keeper. Defensive — all empty today.
    const itemCount = orphans.reduce((n, o) => n + o._count.items, 0)
    if (itemCount > 0) {
      plannedItemMoves += itemCount
      console.log(`          → move ${itemCount} item${itemCount === 1 ? '' : 's'} onto keeper`)
      if (apply) {
        await prisma.checklistTemplateItem.updateMany({
          where: { templateId: { in: orphanIds } },
          data: { templateId: keeper.id },
        })
      }
    }

    // 3. If the keeper's spelling isn't already canonical, rename it.
    if (keeper.deliverableType !== canonicalKey) {
      console.log(`          → rename keeper to canonical '${canonicalKey}'`)
      if (apply) {
        await prisma.checklistTemplate.update({
          where: { id: keeper.id },
          data: { deliverableType: canonicalKey },
        })
      }
    }

    // 4. Delete the orphan templates. Their items cascade-delete, but we
    //    moved everything first, so cascades are a no-op on well-behaved
    //    duplicates.
    plannedOrphanDeletes += orphans.length
    console.log(`          → delete ${orphans.length} orphan template${orphans.length === 1 ? '' : 's'}`)
    if (apply) {
      await prisma.checklistTemplate.deleteMany({ where: { id: { in: orphanIds } } })
    }
    console.log()
  }

  console.log('\n=== Summary ===')
  console.log(`Groups needing merge:  ${plannedMerges}`)
  console.log(`Lone renames:          ${plannedRenames}`)
  console.log(`Instances to repoint:  ${plannedInstanceMoves}`)
  console.log(`Items to move:         ${plannedItemMoves}`)
  console.log(`Orphans to delete:     ${plannedOrphanDeletes}`)

  if (!apply) {
    console.log('\n(dry run — re-run with --apply to perform the above changes)')
  } else {
    console.log('\nApplied.')
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
