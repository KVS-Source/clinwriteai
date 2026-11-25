// Backfill: copy regulatory template guidance + AI prompt per-section
// rules + the must-preserve manifest onto in-flight RegulatoryDocumentSection
// rows created before migration 105's snapshot wiring (Package R-3)
// landed. Module D analogue of the Clinical + Publication + Medical
// backfill scripts.
//
// For each live regulatory_document_sections row with any of the 4 new
// columns null:
//
//   1. Load the document's resolved template via
//      RegulatoryTypePolicy.templateId for the doc's docType, using
//      the policy version pinned on the RegulatoryDocument (falls back
//      to the current policy row).
//   2. Load the pinned RegulatoryAiPromptRecord (by
//      RegulatoryDocument.regAiPromptRecordId) and snapshot the
//      per-section slice from sectionRules.
//   3. Compute mustPreserveManifest from the current contentHtml.
//   4. Write all four with a single update + append one audit entry.
//
// Skipped + listed: documents whose status is 'approved' / 'archived'
// (frozen for audit), documents in closed projects, documents with no
// current version.
//
// Dry run by default; pass --apply to perform the writes.
//
//   npx tsx --env-file=.env scripts/backfill-reg-section-guidance-snapshot.ts
//   npx tsx --env-file=.env scripts/backfill-reg-section-guidance-snapshot.ts --apply

import { PrismaClient, Prisma } from '@prisma/client'
import { PostgresAuditRepository } from '../src/audit/postgres-repository.js'
import { extractManifest } from '../src/modules/clinical-writing/documents/must-preserve.js'

const prisma = new PrismaClient()
const ACTOR = 'system:backfill-reg-section-guidance-snapshot'

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
  console.log(`\n=== Regulatory document section guidance snapshot backfill: ${apply ? 'APPLY' : 'DRY RUN'} ===\n`)

  const secret = process.env.AUDIT_HASH_SECRET
  if (apply && (!secret || secret.length < 32)) throw new Error('AUDIT_HASH_SECRET is required with --apply: each change is audited')
  const audit = apply ? new PostgresAuditRepository(prisma, secret!) : null

  const docs = await prisma.regulatoryDocument.findMany({
    where:  { archivedAt: null },
    select: {
      id: true, title: true, docType: true, status: true, stage: true, projectId: true,
      regAiPromptRecordId:          true,
      regTypePolicyVersionAtCreate: true,
      currentVersionId: true,
      currentVersion:   { select: { versionNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`RegulatoryDocuments total: ${docs.length}\n`)

  const c: Counters = {
    docsVisited: 0, docsSkipped: 0, sectionsUpdated: 0,
    instructionsFilled: 0, guidanceFilled: 0, promptRulesFilled: 0, manifestsFilled: 0,
  }
  const skipped: string[] = []

  for (const doc of docs) {
    const label = `${doc.id}  ${doc.docType.padEnd(32)}  stage=${doc.stage}  ${doc.title}`

    if (!doc.currentVersionId) { skipped.push(`no current version   ${label}`); c.docsSkipped++; continue }
    if (doc.status === 'approved' || doc.status === 'archived' || doc.status === 'superseded') {
      skipped.push(`${doc.status.padEnd(12)} (frozen) ${label}`); c.docsSkipped++; continue
    }

    const project = await prisma.project.findUnique({ where: { id: doc.projectId }, select: { status: true } })
    if (project?.status === 'closed') { skipped.push(`project closed       ${label}`); c.docsSkipped++; continue }

    const sections = await prisma.regulatoryDocumentSection.findMany({
      where: {
        regulatoryDocumentVersionId: doc.currentVersionId,
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

    // Resolve the template via RegulatoryTypePolicy for this docType.
    // Prefer the policy version pinned on the document; fall back to
    // the current policy row.
    const tplMap = new Map<string, { instructions?: string; guidance?: string }>()
    try {
      const pol = await prisma.regulatoryTypePolicy.findFirst({
        where: doc.regTypePolicyVersionAtCreate
          ? { docType: doc.docType, version: doc.regTypePolicyVersionAtCreate }
          : { docType: doc.docType, isCurrent: true },
        select: { templateId: true },
      })
      if (pol?.templateId) {
        const tpl = await prisma.regulatoryDocumentTemplate.findUnique({
          where:  { id: pol.templateId },
          select: { sections: true },
        })
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
      }
    } catch { /* missing policy or template is fine — snapshots stay null */ }

    // Pinned AI prompt record → per-section sectionRules.
    const promptRulesMap = new Map<string, unknown>()
    if (doc.regAiPromptRecordId) {
      try {
        const rec = await prisma.regulatoryAiPromptRecord.findUnique({
          where:  { id: doc.regAiPromptRecordId },
          select: { sectionRules: true },
        })
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

      const patch: Prisma.RegulatoryDocumentSectionUpdateInput = {}
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
        console.log(`[plan] ${doc.id} ${s.sectionId.padEnd(24)} +${touchedFields.join(',')}`)
        c.sectionsUpdated++
        continue
      }
      await prisma.regulatoryDocumentSection.update({ where: { id: s.id }, data: patch })
      await audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    ACTOR,
        action:     'regulatory_document_section_guidance_snapshot_backfilled',
        entityType: 'regulatory_document',
        entityId:   doc.id,
        details:    {
          source:         'backfill',
          sectionId:      s.sectionId,
          versionNumber:  doc.currentVersion?.versionNumber ?? null,
          touchedFields,
        },
        ipAddress: null,
      })
      console.log(`[done] ${doc.id} ${s.sectionId.padEnd(24)} +${touchedFields.join(',')}`)
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
