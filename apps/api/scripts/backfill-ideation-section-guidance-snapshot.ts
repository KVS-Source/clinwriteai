// Backfill: copy ideation template guidance + AI prompt per-section
// rules + the must-preserve manifest onto in-flight IdeationArtefactSection
// rows created before migration 105's snapshot wiring (Package E-3)
// landed. Module E analogue of the Clinical + Publication + Medical +
// Regulatory backfill scripts.
//
// For each live ideation_artefact_sections row with any of the 4 new
// columns null:
//
//   1. Load the artefact's resolved template via
//      IdeationTypePolicy.templateId for the artefact's docType, using
//      the policy version pinned on the IdeationArtefact (falls back
//      to the current policy row).
//   2. Load the pinned IdeationAiPromptRecord (by
//      IdeationArtefact.ideationAiPromptRecordId) and snapshot the
//      per-section slice from sectionRules.
//   3. Compute mustPreserveManifest from the current contentHtml.
//   4. Write all four with a single update + append one audit entry.
//
// Skipped + listed: artefacts in closed projects, artefacts with no
// current version, artefacts with no docType. IdeationArtefact has no
// terminal/approved/archived status field today — the lifecycle gate
// is per-card (IdeationContentCard.overallStatus) rather than per-
// artefact — so we pass every live artefact through.
//
// Dry run by default; pass --apply to perform the writes.
//
//   npx tsx --env-file=.env scripts/backfill-ideation-section-guidance-snapshot.ts
//   npx tsx --env-file=.env scripts/backfill-ideation-section-guidance-snapshot.ts --apply

import { PrismaClient, Prisma } from '@prisma/client'
import { PostgresAuditRepository } from '../src/audit/postgres-repository.js'
import { extractManifest } from '../src/modules/clinical-writing/documents/must-preserve.js'

const prisma = new PrismaClient()
const ACTOR = 'system:backfill-ideation-section-guidance-snapshot'

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
  console.log(`\n=== Ideation artefact section guidance snapshot backfill: ${apply ? 'APPLY' : 'DRY RUN'} ===\n`)

  const secret = process.env.AUDIT_HASH_SECRET
  if (apply && (!secret || secret.length < 32)) throw new Error('AUDIT_HASH_SECRET is required with --apply: each change is audited')
  const audit = apply ? new PostgresAuditRepository(prisma, secret!) : null

  const docs = await prisma.ideationArtefact.findMany({
    select: {
      id: true, title: true, docType: true, ideationProjectId: true,
      ideationAiPromptRecordId:         true,
      ideationTypePolicyVersionAtCreate: true,
      currentVersionId: true,
      currentVersion:   { select: { versionNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`IdeationArtefacts total: ${docs.length}\n`)

  const c: Counters = {
    docsVisited: 0, docsSkipped: 0, sectionsUpdated: 0,
    instructionsFilled: 0, guidanceFilled: 0, promptRulesFilled: 0, manifestsFilled: 0,
  }
  const skipped: string[] = []

  for (const doc of docs) {
    const label = `${doc.id}  ${(doc.docType ?? 'unknown').padEnd(28)}  ${doc.title}`

    if (!doc.currentVersionId) { skipped.push(`no current version   ${label}`); c.docsSkipped++; continue }
    if (!doc.docType)          { skipped.push(`no docType           ${label}`); c.docsSkipped++; continue }

    // Resolve parent project via IdeationProject → Project to skip
    // artefacts in closed workspace projects.
    const ideaProject = await prisma.ideationProject.findUnique({
      where:  { id: doc.ideationProjectId },
      select: { projectId: true },
    })
    if (ideaProject?.projectId) {
      const project = await prisma.project.findUnique({ where: { id: ideaProject.projectId }, select: { status: true } })
      if (project?.status === 'closed') { skipped.push(`project closed       ${label}`); c.docsSkipped++; continue }
    }

    const sections = await prisma.ideationArtefactSection.findMany({
      where: {
        ideationArtefactVersionId: doc.currentVersionId,
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

    // Resolve the template via IdeationTypePolicy for this docType.
    // Prefer the policy version pinned on the artefact; fall back to
    // the current policy row.
    const tplMap = new Map<string, { instructions?: string; guidance?: string }>()
    try {
      const pol = await prisma.ideationTypePolicy.findFirst({
        where: doc.ideationTypePolicyVersionAtCreate
          ? { docType: doc.docType, version: doc.ideationTypePolicyVersionAtCreate }
          : { docType: doc.docType, isCurrent: true },
        select: { templateId: true },
      })
      if (pol?.templateId) {
        const tpl = await prisma.ideationArtefactTemplate.findUnique({
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
    if (doc.ideationAiPromptRecordId) {
      try {
        const rec = await prisma.ideationAiPromptRecord.findUnique({
          where:  { id: doc.ideationAiPromptRecordId },
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

      const patch: Prisma.IdeationArtefactSectionUpdateInput = {}
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
      await prisma.ideationArtefactSection.update({ where: { id: s.id }, data: patch })
      await audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    ACTOR,
        action:     'ideation_artefact_section_guidance_snapshot_backfilled',
        entityType: 'ideation_artefact',
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
  console.log(`  artefacts visited:    ${c.docsVisited}`)
  console.log(`  artefacts skipped:    ${c.docsSkipped}`)
  console.log(`  section rows updated: ${c.sectionsUpdated}`)
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
