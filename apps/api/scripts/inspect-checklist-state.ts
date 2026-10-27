// Diagnostic: dump the current checklist-related state. Read-only.
// Shows:
//   - every ChecklistTemplate row with its item + instance counts
//   - every ChecklistInstance's deliverable type (joined via Document.type)
//   - count of ChecklistTemplateItem + ChecklistInstanceItem rows

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const templates = await prisma.checklistTemplate.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { items: true, instances: true } } },
  })

  console.log(`\n=== ChecklistTemplate (${templates.length} rows) ===`)
  if (templates.length === 0) {
    console.log('(none)')
  } else {
    for (const t of templates) {
      console.log(`  ${t.id}  type=${t.deliverableType.padEnd(28)} v${t.version}  current=${t.isCurrent}  items=${t._count.items}  instances=${t._count.instances}  createdAt=${t.createdAt.toISOString()}`)
      console.log(`    changeReason: ${t.changeReason}`)
    }
  }

  const totalItems = await prisma.checklistTemplateItem.count()
  console.log(`\n=== ChecklistTemplateItem total: ${totalItems} ===`)

  const instances = await prisma.checklistInstance.findMany({
    include: {
      document: { select: { id: true, type: true, title: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`\n=== ChecklistInstance (${instances.length} rows) ===`)
  for (const i of instances) {
    console.log(`  ${i.id}  doc=${i.documentId}  docType=${i.document.type.padEnd(28)}  templateId=${i.templateId}  v${i.templateVersion}  items=${i._count.items}`)
  }

  const totalInstanceItems = await prisma.checklistInstanceItem.count()
  console.log(`\n=== ChecklistInstanceItem total: ${totalInstanceItems} ===`)

  // Documents with no ChecklistInstance — these are the ones that would need
  // the GET /checklist self-heal fallback on first open.
  const docs = await prisma.document.count({ where: { deletedAt: null } })
  const docsWithInstance = instances.length
  console.log(`\n=== Documents without a ChecklistInstance: ${docs - docsWithInstance} / ${docs} ===`)
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
