// Backfill: copy medical template guidance + AI prompt per-section
// rules + the must-preserve manifest onto in-flight MedContentSection
// rows created before migration 105's snapshot wiring (Package C-3)
// landed. Module C analogue of the Clinical + Publication backfills.
//
// For each live med_content_sections row with any of the 4 new columns
// null:
//
//   1. Load the content item's resolved template via
//      MedContentTypePolicy.templateId for the item's docType, using
//      the policy version pinned on the MedContentItem (falls back to
//      the current policy row). Pull per-section formatRules +
//      instructions + guidance out of MedContentTemplate.sections[].
//   2. Load the pinned MedContentAiPromptRecord (by
//      MedContentItem.medContentAiPromptRecordId) and snapshot the
//      per-section slice from sectionRules.
//   3. Compute mustPreserveManifest from the current contentHtml.
//   4. Write all four with a single update + append one audit entry.
//
// Skipped + listed: content items whose stage is terminal ('approved'
// — frozen for audit per Module C expiry + MLR rules), items in closed
// projects, items with no current version.
//
// Dry run by default; pass --apply to perform the writes.
//
//   npx tsx --env-file=.env scripts/backfill-med-section-guidance-snapshot.ts
//   npx tsx --env-file=.env scripts/backfill-med-section-guidance-snapshot.ts --apply

import { PrismaClient, Prisma } from '@prisma/client'
import { PostgresAuditRepository } from '../src/audit/postgres-repository.js'
import { extractManifest } from '../src/modules/clinical-writing/documents/must-preserve.js'

const prisma = new PrismaClient()
const ACTOR = 'system:backfill-med-section-guidance-snapshot'

interface Counters {
  itemsVisited:       number
  itemsSkipped:       number
  sectionsUpdated:    number
  instructionsFilled: number
  guidanceFilled:     number
  promptRulesFilled:  number
  manifestsFilled:    number
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n=== Med content section guidance snapshot backfill: ${apply ? 'APPLY' : 'DRY RUN'} ===\n`)

  const secret = process.env.AUDIT_HASH_SECRET
  if (apply && (!secret || secret.length < 32)) throw new Error('AUDIT_HASH_SECRET is required with --apply: each change is audited')
  const audit = apply ? new PostgresAuditRepository(prisma, secret!) : null

  const items = await prisma.medContentItem.findMany({
    where:  { NOT: { status: 'archived' } },
    select: {
      id: true, title: true, type: true, status: true, stage: true, projectId: true,
      medContentAiPromptRecordId:         true,
      medContentTypePolicyVersionAtCreate: true,
      currentVersionId: true,
      currentVersion:   { select: { versionNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`MedContentItems total: ${items.length}\n`)

  const c: Counters = {
    itemsVisited: 0, itemsSkipped: 0, sectionsUpdated: 0,
    instructionsFilled: 0, guidanceFilled: 0, promptRulesFilled: 0, manifestsFilled: 0,
  }
  const skipped: string[] = []

  for (const item of items) {
    const label = `${item.id}  ${item.type.padEnd(20)}  stage=${item.stage}  ${item.title}`

    if (!item.currentVersionId) { skipped.push(`no current version   ${label}`); c.itemsSkipped++; continue }
    if (item.status === 'approved' || item.stage >= 6) { skipped.push(`approved/stage-6     ${label}`); c.itemsSkipped++; continue }

    const project = await prisma.project.findUnique({ where: { id: item.projectId }, select: { status: true } })
    if (project?.status === 'closed') { skipped.push(`project closed       ${label}`); c.itemsSkipped++; continue }

    const sections = await prisma.medContentSection.findMany({
      where: {
        medContentVersionId: item.currentVersionId,
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
    c.itemsVisited++

    // Resolve the template via MedContentTypePolicy for this docType.
    // Prefer the policy version pinned on the item; fall back to the
    // current policy row.
    const tplMap = new Map<string, { instructions?: string; guidance?: string }>()
    try {
      const pol = await prisma.medContentTypePolicy.findFirst({
        where: item.medContentTypePolicyVersionAtCreate
          ? { docType: item.type, version: item.medContentTypePolicyVersionAtCreate }
          : { docType: item.type, isCurrent: true },
        select: { templateId: true },
      })
      if (pol?.templateId) {
        const tpl = await prisma.medContentTemplate.findUnique({
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
    if (item.medContentAiPromptRecordId) {
      try {
        const rec = await prisma.medContentAiPromptRecord.findUnique({
          where:  { id: item.medContentAiPromptRecordId },
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

      const patch: Prisma.MedContentSectionUpdateInput = {}
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
        console.log(`[plan] ${item.id} ${s.sectionId.padEnd(24)} +${touchedFields.join(',')}`)
        c.sectionsUpdated++
        continue
      }
      await prisma.medContentSection.update({ where: { id: s.id }, data: patch })
      await audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    ACTOR,
        action:     'med_content_section_guidance_snapshot_backfilled',
        entityType: 'med_content',
        entityId:   item.id,
        details:    {
          source:         'backfill',
          sectionId:      s.sectionId,
          versionNumber:  item.currentVersion?.versionNumber ?? null,
          touchedFields,
        },
        ipAddress: null,
      })
      console.log(`[done] ${item.id} ${s.sectionId.padEnd(24)} +${touchedFields.join(',')}`)
      c.sectionsUpdated++
    }
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'}:`)
  console.log(`  content items visited: ${c.itemsVisited}`)
  console.log(`  content items skipped: ${c.itemsSkipped}`)
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
