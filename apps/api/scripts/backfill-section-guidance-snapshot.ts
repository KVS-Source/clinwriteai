// Backfill: copy template guidance + AI prompt per-section rules + the
// must-preserve manifest onto in-flight SectionContent rows that were
// created before migration 104. One-time; safe to re-run — rows that
// already have snapshots filled are left alone.
//
// For each live section_contents row with null templateInstructions /
// templateGuidance / aiPromptSectionRules / mustPreserveManifest:
//
//   1. Load the document's pinned DocumentTemplate (by doc.templateId) and
//      pull the matching section's instructions + guidance + formatRules.
//      Nulls stay null when the template doesn't carry those fields
//      (parser may not have been re-run yet; see --note below).
//   2. Load the document's pinned AiPromptRecord (by doc.aiPromptRecordId)
//      and snapshot the per-section slice from sectionRules.
//   3. Compute mustPreserveManifest from the current contentHtml.
//   4. Write all three with a single update + append one audit entry.
//
// Skipped + listed: signature-bound documents (hash is bound to the
// e-sig chain), documents in closed projects, documents with no current
// version, documents with no template, documents whose section rows
// already have ALL target fields populated.
//
// Dry run by default; pass --apply to perform the writes.
//
//   npx tsx --env-file=.env scripts/backfill-section-guidance-snapshot.ts
//   npx tsx --env-file=.env scripts/backfill-section-guidance-snapshot.ts --apply
//
// Note: for the template instructions/guidance path to actually produce
// non-null values on legacy docs, the DocumentTemplate rows must have
// been re-parsed by the updated distill-template worker (Package 2).
// If a template was last parsed before migration 104, instructions +
// guidance stay null on backfill. Re-upload the template OR run the
// distill-template job to re-parse, then re-run this script.

import { PrismaClient, Prisma } from '@prisma/client'
import { PostgresAuditRepository } from '../src/audit/postgres-repository.js'
import { extractManifest } from '../src/modules/clinical-writing/documents/must-preserve.js'
import { SIGNATURE_BOUND_STATUSES } from '../src/modules/clinical-writing/documents/template-sections.js'

const prisma = new PrismaClient()
const ACTOR = 'system:backfill-section-guidance-snapshot'

interface Counters {
  docsVisited:        number
  docsSkipped:        number
  sectionsUpdated:    number
  instructionsFilled: number
  guidanceFilled:     number
  promptRulesFilled:  number
  manifestsFilled:    number
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n=== Section guidance snapshot backfill: ${apply ? 'APPLY' : 'DRY RUN'} ===\n`)

  const secret = process.env.AUDIT_HASH_SECRET
  if (apply && (!secret || secret.length < 32)) throw new Error('AUDIT_HASH_SECRET is required with --apply: each change is audited')
  const audit = apply ? new PostgresAuditRepository(prisma, secret!) : null

  const docs = await prisma.document.findMany({
    where:  { deletedAt: null },
    select: {
      id: true, title: true, type: true, status: true, projectId: true,
      templateId: true, aiPromptRecordId: true,
      currentVersionId: true,
      currentVersion:   { select: { versionNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Documents total: ${docs.length}\n`)

  const c: Counters = {
    docsVisited: 0, docsSkipped: 0, sectionsUpdated: 0,
    instructionsFilled: 0, guidanceFilled: 0, promptRulesFilled: 0, manifestsFilled: 0,
  }
  const skipped: string[] = []

  for (const doc of docs) {
    const label = `${doc.id}  ${doc.type.padEnd(20)}  ${doc.status.padEnd(16)}  ${doc.title}`
    if (!doc.currentVersionId) { skipped.push(`no current version   ${label}`); c.docsSkipped++; continue }
    if (SIGNATURE_BOUND_STATUSES.has(doc.status)) { skipped.push(`signature-bound      ${label}`); c.docsSkipped++; continue }

    const project = await prisma.project.findUnique({ where: { id: doc.projectId }, select: { status: true } })
    if (project?.status === 'closed') { skipped.push(`project closed       ${label}`); c.docsSkipped++; continue }

    const sections = await prisma.sectionContent.findMany({
      where: {
        documentVersionId: doc.currentVersionId,
        OR: [
          { templateInstructions: null },
          { templateGuidance:     null },
          { aiPromptSectionRules: { equals: Prisma.DbNull } },
          { mustPreserveManifest: { equals: Prisma.DbNull } },
        ],
      },
      select: { id: true, sectionId: true, contentHtml: true, templateInstructions: true, templateGuidance: true, aiPromptSectionRules: true, mustPreserveManifest: true },
    })
    if (sections.length === 0) continue
    c.docsVisited++

    // Load template section map (instructions / guidance) once per doc.
    const tplMap = new Map<string, { instructions?: string; guidance?: string }>()
    if (doc.templateId) {
      try {
        const tpl = await prisma.documentTemplate.findUnique({ where: { id: doc.templateId }, select: { sections: true } })
        if (tpl?.sections && Array.isArray(tpl.sections)) {
          for (const raw of tpl.sections as Array<Record<string, unknown>>) {
            const id = typeof raw.id === 'string' ? raw.id : null
            if (!id) continue
            tplMap.set(id, {
              instructions: typeof raw.instructions === 'string' && raw.instructions.trim().length > 0 ? raw.instructions.trim() : undefined,
              guidance:     typeof raw.guidance     === 'string' && raw.guidance.trim().length     > 0 ? raw.guidance.trim()     : undefined,
            })
          }
        }
      } catch { /* missing template is fine — snapshots stay null */ }
    }

    // Load pinned AI prompt section rules once per doc.
    const promptRulesMap = new Map<string, unknown>()
    if (doc.aiPromptRecordId) {
      try {
        const rec = await prisma.aiPromptRecord.findUnique({ where: { id: doc.aiPromptRecordId }, select: { sectionRules: true } })
        const sr = rec?.sectionRules as Record<string, unknown> | null | undefined
        if (sr && typeof sr === 'object' && !Array.isArray(sr)) {
          for (const [k, v] of Object.entries(sr)) if (v !== undefined) promptRulesMap.set(k, v)
        }
      } catch { /* missing / wrong shape — snapshots stay null */ }
    }

    for (const s of sections) {
      const tpl = tplMap.get(s.sectionId) ?? {}
      const promptRules = promptRulesMap.get(s.sectionId) ?? null
      const manifest = extractManifest(s.contentHtml ?? '')

      const patch: Prisma.SectionContentUpdateInput = {}
      if (s.templateInstructions == null && tpl.instructions) { patch.templateInstructions = tpl.instructions; c.instructionsFilled++ }
      if (s.templateGuidance     == null && tpl.guidance)     { patch.templateGuidance     = tpl.guidance;     c.guidanceFilled++ }
      if (s.aiPromptSectionRules == null && promptRules != null) {
        patch.aiPromptSectionRules = JSON.parse(JSON.stringify(promptRules)) as Prisma.InputJsonValue
        c.promptRulesFilled++
      }
      if (s.mustPreserveManifest == null) {
        patch.mustPreserveManifest = manifest as unknown as Prisma.InputJsonValue
        c.manifestsFilled++
      }
      const touchedFields = Object.keys(patch)
      if (touchedFields.length === 0) continue

      if (!audit) {
        console.log(`[plan] ${doc.id} ${s.sectionId.padEnd(20)} +${touchedFields.join(',')}`)
        c.sectionsUpdated++
        continue
      }
      await prisma.sectionContent.update({ where: { id: s.id }, data: patch })
      await audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    ACTOR,
        action:     'section_guidance_snapshot_backfilled',
        entityType: 'document',
        entityId:   doc.id,
        details:    {
          source:         'backfill',
          sectionId:      s.sectionId,
          versionNumber:  doc.currentVersion?.versionNumber ?? null,
          touchedFields,
        },
        ipAddress: null,
      })
      console.log(`[done] ${doc.id} ${s.sectionId.padEnd(20)} +${touchedFields.join(',')}`)
      c.sectionsUpdated++
    }
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'}:`)
  console.log(`  documents visited:     ${c.docsVisited}`)
  console.log(`  documents skipped:     ${c.docsSkipped}`)
  console.log(`  section rows updated:  ${c.sectionsUpdated}`)
  console.log(`    instructions filled: ${c.instructionsFilled}`)
  console.log(`    guidance filled:     ${c.guidanceFilled}`)
  console.log(`    prompt rules filled: ${c.promptRulesFilled}`)
  console.log(`    manifests filled:    ${c.manifestsFilled}`)
  if (skipped.length > 0) {
    console.log(`\nSkipped:`)
    for (const s of skipped) console.log(`  ${s}`)
  }
  if (!apply) console.log('\n(dry run: re-run with --apply to perform the writes)')
}

main().catch((err) => { console.error(err); process.exitCode = 1 }).finally(() => prisma.$disconnect())
