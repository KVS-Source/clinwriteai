// Import a Module B publication template from a repo JSON file into the database (template + checklist + policy
// for its docType). New publications of that type then start from the template's sections and starter text.
// Safe to re-run: identical content is left alone; changed content becomes a new version. Each write is audited.
//
// Dry run by default; pass --apply to perform the writes.
//
//   npx tsx --env-file=.env scripts/import-publication-template.ts ../../docs/templates/manuscript-original-research.template.json
//   npx tsx --env-file=.env scripts/import-publication-template.ts ../../docs/templates/manuscript-original-research.template.json --apply

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PostgresAuditRepository } from '../src/audit/postgres-repository.js'
import { importPublicationTemplate, publicationTemplateFileSchema } from '../src/modules/scientific-writing/publications/template-import.js'

const prisma = new PrismaClient()
const ACTOR = 'system:import-publication-template'

async function main() {
  const path = process.argv.slice(2).find(a => !a.startsWith('--'))
  if (!path) throw new Error('usage: import-publication-template.ts <template.json> [--apply]')
  const apply = process.argv.includes('--apply')
  const file = publicationTemplateFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  console.log(`\n=== Publication template import: ${apply ? 'APPLY' : 'DRY RUN'} ===`)
  console.log(`File:     ${path}`)
  console.log(`docType:  ${file.template.docType}  (${file.template.label})`)
  console.log(`Sections: ${file.sections.map(s => `${s.number} ${s.title}`).join(' | ')}`)
  console.log(`Checklist items: ${file.checklist.length}\n`)

  const secret = process.env.AUDIT_HASH_SECRET
  if (apply && (!secret || secret.length < 32)) throw new Error('AUDIT_HASH_SECRET is required with --apply: each change is audited')

  const plan = apply
    ? await prisma.$transaction(tx => importPublicationTemplate(tx as never, file, ACTOR, true))
    : await importPublicationTemplate(prisma as never, file, ACTOR, false)

  for (const [what, step] of [['template', plan.template], ['checklist', plan.checklist], ['policy', plan.policy]] as const) {
    if (step) console.log(`${(apply ? '' : '[plan] ') + what.padEnd(10)} ${step.action.padEnd(12)} v${step.version}${step.id ? `  ${step.id}` : ''}`)
  }

  if (apply) {
    const audit = new PostgresAuditRepository(prisma, secret!)
    await audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    ACTOR,
      action:     'publication_template_imported',
      entityType: 'publication_template',
      entityId:   plan.template.id ?? plan.docType,
      details:    { docType: plan.docType, source: path, template: plan.template, checklist: plan.checklist, policy: plan.policy },
      ipAddress:  null,
    })
    console.log('\nAudited as publication_template_imported.')
  } else {
    console.log('\nNothing written. Re-run with --apply to import.')
  }
}

main().catch(err => { console.error(err); process.exitCode = 1 }).finally(() => prisma.$disconnect())
