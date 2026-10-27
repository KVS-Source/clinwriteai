// One-shot: push the newly-seeded platform baseline items INTO existing
// ChecklistInstance rows that pre-date the seed. Without this, the 24
// instances backfilled in the previous session would stay empty forever
// (PRD rule: template bumps don't retro-mutate instances) — but those
// instances were created against *empty* fallback templates, so there was
// no real customisation to preserve.
//
// Preserves user-added items (isUserAdded=true). Reconciles template items
// by text — if an item with the same text already exists on the instance,
// it's left alone. New items from the seed are cloned onto the instance
// with the latest ownership + staging fields.
//
// Dry run by default; pass --apply to perform the writes.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const apply = process.argv.includes('--apply')
  const mode = apply ? 'APPLY' : 'DRY RUN'
  console.log(`\n=== Checklist item backfill — ${mode} ===\n`)

  const instances = await prisma.checklistInstance.findMany({
    include: {
      template: {
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      },
      items: true,
      document: { select: { id: true, type: true, title: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Loaded ${instances.length} instances\n`)

  let instancesTouched = 0
  let itemsCreated = 0

  for (const inst of instances) {
    const have = new Set(inst.items.map(i => i.text))
    const missing = inst.template.items.filter(ti => !have.has(ti.text))
    if (missing.length === 0) {
      continue
    }

    instancesTouched++
    console.log(`[plan]  instance=${inst.id}  doc=${inst.documentId}  type=${inst.document.type}  missing=${missing.length}`)
    for (const m of missing) {
      console.log(`           + ${m.text}`)
    }

    if (!apply) {
      itemsCreated += missing.length
      continue
    }

    // Keep the user's custom items at the top; append template items after.
    // The sortOrder on the template items already encodes the compliance
    // reading order, so preserve it relative to each other.
    const maxSort = inst.items.reduce((m, it) => Math.max(m, it.sortOrder), 0)

    await prisma.$transaction(async (tx) => {
      let next = maxSort
      for (const ti of missing) {
        next += 10
        await tx.checklistInstanceItem.create({
          data: {
            instanceId: inst.id,
            templateItemId: ti.id,
            text: ti.text,
            framework: ti.framework,
            frameworkMandatory: ti.frameworkMandatory,
            ownerRaci: ti.ownerRaci,
            stage: ti.stage,
            autoCompleteOn: ti.autoCompleteOn,
            sortOrder: next,
          },
        })
        itemsCreated++
      }
    })
  }

  console.log('\n=== Summary ===')
  console.log(`Instances touched: ${instancesTouched} / ${instances.length}`)
  console.log(`Items ${apply ? 'created' : 'to create'}: ${itemsCreated}`)

  if (!apply) {
    console.log('\n(dry run — re-run with --apply to perform the writes)')
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
