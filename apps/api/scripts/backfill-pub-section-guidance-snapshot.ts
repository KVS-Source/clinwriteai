// Backfill: copy publication template guidance + AI prompt per-section
// rules + the must-preserve manifest onto in-flight PublicationSectionContent
// rows created before migration 105's snapshot wiring (Package B-4) landed.
// Module B analogue of apps/api/scripts/backfill-section-guidance-snapshot.ts.
//
// For each live publication_section_contents row with null
// templateInstructions / templateGuidance / aiPromptSectionRules /
// mustPreserveManifest:
//
//   1. Load the publication's resolved template (via PublicationTypePolicy.templateId
//      for the publication's docType, filtering to the policy version
//      pinned on the Publication). Pull per-section formatRules +
//      instructions + guidance out of PublicationTemplate.sections[].
//      Nulls stay null when the template doesn't carry those fields —
//      re-run the Package B-2 distiller or re-import authored JSON
//      before backfilling if you want population.
//   2. Load the pinned PublicationAiPromptRecord (by
//      Publication.publicationAiPromptRecordId) and snapshot the
//      per-section slice from sectionRules.
//   3. Compute mustPreserveManifest from the current contentHtml.
//   4. Write all four with a single update + append one audit entry.
//
// Skipped + listed: publications whose stage is 'published' (frozen for
// audit purposes), publications in closed projects, publications with
// no current version.
//
// Dry run by default; pass --apply to perform the writes.
//
//   npx tsx --env-file=.env scripts/backfill-pub-section-guidance-snapshot.ts
//   npx tsx --env-file=.env scripts/backfill-pub-section-guidance-snapshot.ts --apply

import { PrismaClient, Prisma } from '@prisma/client'
import { PostgresAuditRepository } from '../src/audit/postgres-repository.js'
import { extractManifest } from '../src/modules/clinical-writing/documents/must-preserve.js'

const prisma = new PrismaClient()
const ACTOR = 'system:backfill-pub-section-guidance-snapshot'

interface Counters {
  pubsVisited:        number
  pubsSkipped:        number
  sectionsUpdated:    number
  instructionsFilled: number
  guidanceFilled:     number
  promptRulesFilled:  number
  manifestsFilled:    number
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n=== Publication section guidance snapshot backfill: ${apply ? 'APPLY' : 'DRY RUN'} ===\n`)

  const secret = process.env.AUDIT_HASH_SECRET
  if (apply && (!secret || secret.length < 32)) throw new Error('AUDIT_HASH_SECRET is required with --apply: each change is audited')
  const audit = apply ? new PostgresAuditRepository(prisma, secret!) : null

  const pubs = await prisma.publication.findMany({
    where:  { deletedAt: null },
    select: {
      id: true, title: true, type: true, subtype: true, stage: true, projectId: true,
      publicationAiPromptRecordId: true,
      pubTypePolicyVersionAtCreate: true,
      currentVersionId: true,
      currentVersion:   { select: { versionNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Publications total: ${pubs.length}\n`)

  const c: Counters = {
    pubsVisited: 0, pubsSkipped: 0, sectionsUpdated: 0,
    instructionsFilled: 0, guidanceFilled: 0, promptRulesFilled: 0, manifestsFilled: 0,
  }
  const skipped: string[] = []

  for (const pub of pubs) {
    const docType = (pub.subtype ? `${pub.type}_${pub.subtype}` : pub.type).toLowerCase().replace(/-/g, '_')
    const label = `${pub.id}  ${docType.padEnd(32)}  ${(pub.stage ?? '-').padEnd(12)}  ${pub.title}`

    if (!pub.currentVersionId) { skipped.push(`no current version   ${label}`); c.pubsSkipped++; continue }
    if (pub.stage === 'published') { skipped.push(`published (frozen)   ${label}`); c.pubsSkipped++; continue }

    const project = await prisma.project.findUnique({ where: { id: pub.projectId }, select: { status: true } })
    if (project?.status === 'closed') { skipped.push(`project closed       ${label}`); c.pubsSkipped++; continue }

    const sections = await prisma.publicationSectionContent.findMany({
      where: {
        publicationVersionId: pub.currentVersionId,
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
    c.pubsVisited++

    // Resolve the template via PublicationTypePolicy for this docType.
    // Prefer the policy version pinned on the publication; fall back to
    // the current policy row.
    const tplMap = new Map<string, { instructions?: string; guidance?: string }>()
    try {
      const pol = await prisma.publicationTypePolicy.findFirst({
        where: pub.pubTypePolicyVersionAtCreate
          ? { docType, version: pub.pubTypePolicyVersionAtCreate }
          : { docType, isCurrent: true },
        select: { templateId: true },
      })
      if (pol?.templateId) {
        const tpl = await prisma.publicationTemplate.findUnique({
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
    if (pub.publicationAiPromptRecordId) {
      try {
        const rec = await prisma.publicationAiPromptRecord.findUnique({
          where:  { id: pub.publicationAiPromptRecordId },
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

      const patch: Prisma.PublicationSectionContentUpdateInput = {}
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
        console.log(`[plan] ${pub.id} ${s.sectionId.padEnd(24)} +${touchedFields.join(',')}`)
        c.sectionsUpdated++
        continue
      }
      await prisma.publicationSectionContent.update({ where: { id: s.id }, data: patch })
      await audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    ACTOR,
        action:     'publication_section_guidance_snapshot_backfilled',
        entityType: 'publication',
        entityId:   pub.id,
        details:    {
          source:         'backfill',
          sectionId:      s.sectionId,
          versionNumber:  pub.currentVersion?.versionNumber ?? null,
          touchedFields,
        },
        ipAddress: null,
      })
      console.log(`[done] ${pub.id} ${s.sectionId.padEnd(24)} +${touchedFields.join(',')}`)
      c.sectionsUpdated++
    }
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'}:`)
  console.log(`  publications visited:  ${c.pubsVisited}`)
  console.log(`  publications skipped:  ${c.pubsSkipped}`)
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
