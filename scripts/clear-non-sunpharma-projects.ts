// One-off QA data cleanup: delete every project EXCEPT the one named in
// --keep-name, cascading through documents + versions + sections +
// AI debug tables + project-scoped source uploads + CRM + voice notes
// + signatures + checklists + RACI + project members.
//
// What's untouched:
//   - Master Library platform catalogues (DocumentTemplate, ChecklistTemplate,
//     RegulatoryFramework, AiPromptRecord, BestPracticeRecord, DocumentTypePolicy)
//   - Users + tenants + rate cards + external credentials + licensing rows
//   - Settings / platform config
//   - audit_events (handled separately — see --reseed-audit flag)
//
// Safety:
//   - Defaults to --dry-run (prints counts, writes nothing).
//   - Must pass --yes to execute the DELETEs.
//   - Must pass --keep-name="…" matching exactly one project.
//   - Runs inside a single transaction so a mid-flight failure rolls back.
//
// Audit chain (--reseed-audit, optional):
//   - Only runs after the project data delete, in a separate transaction.
//   - TRUNCATEs audit_events + reseeds with a single "test-data cleanup"
//     genesis event. Deliberately NOT the default — pass the flag to opt in.
//
// Usage on the QA host:
//   # 1. Dump first
//   pg_dump -h 127.0.0.1 -p 15432 -U <user> -d platform \
//     -F c -f /opt/platform/backups/pre-cleanup-$(date -u +%Y%m%dT%H%M%SZ).pgdump
//
//   # 2. Dry-run
//   npm --workspace=apps/api run script:cleanup-non-sunpharma -- \
//     --keep-name="Sun Pharma - Protocol -ibuprofen"
//
//   # 3. Execute
//   npm --workspace=apps/api run script:cleanup-non-sunpharma -- \
//     --keep-name="Sun Pharma - Protocol -ibuprofen" --yes
//
//   # 4. (Optional) Reseed audit chain
//   npm --workspace=apps/api run script:cleanup-non-sunpharma -- \
//     --keep-name="Sun Pharma - Protocol -ibuprofen" --yes --reseed-audit

import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

interface Args {
  keepName:     string
  yes:          boolean
  reseedAudit:  boolean
  actorEmail:   string
}

function parseArgs(): Args {
  const args: Partial<Args> = { yes: false, reseedAudit: false, actorEmail: process.env.CLEANUP_ACTOR_EMAIL ?? 'admin@genbioca.com' }
  for (const raw of process.argv.slice(2)) {
    if (raw === '--yes')               args.yes = true
    else if (raw === '--reseed-audit') args.reseedAudit = true
    else if (raw.startsWith('--keep-name=')) args.keepName = raw.slice('--keep-name='.length).replace(/^"|"$/g, '')
    else if (raw.startsWith('--actor=')) args.actorEmail = raw.slice('--actor='.length)
  }
  if (!args.keepName) {
    console.error('ERROR: --keep-name="…" is required (exact project name match).')
    process.exit(2)
  }
  return args as Args
}

async function main() {
  const args = parseArgs()
  const prisma = new PrismaClient()
  const dryRun = !args.yes
  console.log(`\n=== Non-Sun-Pharma project cleanup ===`)
  console.log(`Mode:       ${dryRun ? 'DRY-RUN (no writes)' : 'EXECUTE'}`)
  console.log(`Keep name:  "${args.keepName}"`)
  console.log(`Reseed aud: ${args.reseedAudit ? 'YES (will TRUNCATE audit_events after data cleanup)' : 'no'}`)
  console.log('')

  // --- 1. Resolve kept project ------------------------------------------
  const keep = await prisma.project.findMany({
    where:  { name: args.keepName },
    select: { id: true, name: true, shortTitle: true, client: true, createdAt: true },
  })
  if (keep.length === 0) {
    console.error(`ERROR: no project matches name "${args.keepName}". Candidates close to it:`)
    const near = await prisma.project.findMany({
      where:   { name: { contains: 'Sun', mode: 'insensitive' } },
      select:  { id: true, name: true },
      take:    20,
    })
    for (const p of near) console.error(`  - [${p.id}] ${p.name}`)
    process.exit(3)
  }
  if (keep.length > 1) {
    console.error(`ERROR: ${keep.length} projects match "${args.keepName}" — tighten the name:`)
    for (const p of keep) console.error(`  - [${p.id}] ${p.name} (${p.shortTitle}, ${p.client})`)
    process.exit(4)
  }
  const keptProjectId = keep[0]!.id
  console.log(`Kept project: [${keptProjectId}] ${keep[0]!.name}`)

  // --- 2. List doomed projects + doc + upload counts --------------------
  const doomedProjects = await prisma.project.findMany({
    where:  { id: { not: keptProjectId } },
    select: { id: true, name: true, shortTitle: true, client: true },
    orderBy: { createdAt: 'asc' },
  })
  const doomedIds = doomedProjects.map(p => p.id)
  console.log(`\nDoomed projects (${doomedProjects.length}):`)
  for (const p of doomedProjects) console.log(`  - [${p.id}] ${p.name} · ${p.client ?? '-'}`)

  // Counts — scoped to doomedIds
  const tables = [
    ['projects',                 await prisma.project.count({           where: { id: { in: doomedIds } } })],
    ['project_members',          await prisma.projectMember.count({     where: { projectId: { in: doomedIds } } })],
    ['project_team_members',     await prisma.projectTeamMember.count({ where: { projectId: { in: doomedIds } } })],
    ['documents',                await prisma.document.count({          where: { projectId: { in: doomedIds } } })],
    ['document_uploads',         await prisma.documentUpload.count({    where: { projectId: { in: doomedIds } } })],
  ] as const
  const doomedDocIds = await prisma.document.findMany({
    where:  { projectId: { in: doomedIds } },
    select: { id: true },
  }).then(r => r.map(d => d.id))
  const docScoped: Array<[string, number]> = [
    ['document_versions',        await prisma.documentVersion.count({   where: { documentId: { in: doomedDocIds } } })],
    ['document_sources',         await prisma.documentSource.count({    where: { documentId: { in: doomedDocIds } } })],
    ['document_raci',            await prisma.documentRaci.count({      where: { documentId: { in: doomedDocIds } } })],
    ['ai_draft_steps',           await prisma.aiDraftStep.count({       where: { documentId: { in: doomedDocIds } } })],
    ['ai_section_draft_traces',  await prisma.aiSectionDraftTrace.count({ where: { documentId: { in: doomedDocIds } } })],
    ['ai_drafting_passes',       await prisma.aiDraftingPass.count({    where: { documentId: { in: doomedDocIds } } })],
    ['ai_call_records',          await prisma.aiCallRecord.count({      where: { documentId: { in: doomedDocIds } } })],
    ['ai_conversation_messages', await prisma.aiConversationMessage.count({ where: { documentId: { in: doomedDocIds } } })],
    ['edit_history',             await prisma.editHistory.count({       where: { documentId: { in: doomedDocIds } } })],
    ['section_locks',            await prisma.sectionLock.count({       where: { documentId: { in: doomedDocIds } } })],
    ['comments',                 await prisma.comment.count({           where: { documentId: { in: doomedDocIds } } })],
    ['voice_notes',              await prisma.voiceNote.count({         where: { documentId: { in: doomedDocIds } } })],
    ['crm_meetings',             await prisma.crmMeeting.count({        where: { documentId: { in: doomedDocIds } } })],
    ['checklist_instances',      await prisma.checklistInstance.count({ where: { documentId: { in: doomedDocIds } } })],
    ['signature_chains',         await prisma.signatureChain.count({    where: { documentId: { in: doomedDocIds } } })],
  ]
  console.log(`\nRows to delete:`)
  for (const [n, c] of [...tables, ...docScoped]) console.log(`  ${String(n).padEnd(26)} ${c.toLocaleString()}`)

  if (dryRun) {
    console.log(`\nDRY-RUN complete. Re-run with --yes to execute.\n`)
    await prisma.$disconnect()
    return
  }

  // --- 3. Execute (single transaction) ----------------------------------
  console.log(`\nExecuting delete transaction…`)
  const started = Date.now()
  const counts = await prisma.$transaction(async (tx) => {
    const c: Record<string, number> = {}
    // Doc-scoped (leaves first)
    c.aiDraftStep             = (await tx.aiDraftStep.deleteMany({            where: { documentId: { in: doomedDocIds } } })).count
    c.aiSectionDraftTrace     = (await tx.aiSectionDraftTrace.deleteMany({    where: { documentId: { in: doomedDocIds } } })).count
    c.aiDraftingPass          = (await tx.aiDraftingPass.deleteMany({         where: { documentId: { in: doomedDocIds } } })).count
    c.aiCallRecord            = (await tx.aiCallRecord.deleteMany({           where: { documentId: { in: doomedDocIds } } })).count
    c.aiConversationMessage   = (await tx.aiConversationMessage.deleteMany({  where: { documentId: { in: doomedDocIds } } })).count
    c.editHistory             = (await tx.editHistory.deleteMany({            where: { documentId: { in: doomedDocIds } } })).count
    c.sectionLock             = (await tx.sectionLock.deleteMany({            where: { documentId: { in: doomedDocIds } } })).count
    c.comment                 = (await tx.comment.deleteMany({                where: { documentId: { in: doomedDocIds } } })).count
    c.voiceNote               = (await tx.voiceNote.deleteMany({              where: { documentId: { in: doomedDocIds } } })).count
    c.crmMeeting              = (await tx.crmMeeting.deleteMany({             where: { documentId: { in: doomedDocIds } } })).count
    c.checklistInstance       = (await tx.checklistInstance.deleteMany({      where: { documentId: { in: doomedDocIds } } })).count
    c.signatureChain          = (await tx.signatureChain.deleteMany({         where: { documentId: { in: doomedDocIds } } })).count
    c.documentSource          = (await tx.documentSource.deleteMany({         where: { documentId: { in: doomedDocIds } } })).count
    c.documentRaci            = (await tx.documentRaci.deleteMany({           where: { documentId: { in: doomedDocIds } } })).count
    // Document itself (CASCADE handles versions + section_contents per schema)
    c.documents               = (await tx.document.deleteMany({               where: { id: { in: doomedDocIds } } })).count
    // Project-scoped uploads (per-project source PDFs)
    c.documentUpload          = (await tx.documentUpload.deleteMany({         where: { projectId: { in: doomedIds } } })).count
    // Project membership rows
    c.projectMember           = (await tx.projectMember.deleteMany({          where: { projectId: { in: doomedIds } } })).count
    c.projectTeamMember       = (await tx.projectTeamMember.deleteMany({      where: { projectId: { in: doomedIds } } })).count
    // Project row last
    c.project                 = (await tx.project.deleteMany({                where: { id: { in: doomedIds } } })).count
    return c
  }, { timeout: 120_000 })

  const elapsed = Date.now() - started
  console.log(`\nDelete transaction OK (${elapsed}ms). Rows deleted:`)
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(22)} ${v.toLocaleString()}`)

  // --- 4. Optional audit chain reseed -----------------------------------
  if (args.reseedAudit) {
    console.log(`\nReseeding audit chain (TRUNCATE + seed genesis event)…`)
    // Use raw SQL — Prisma doesn't model audit_events (raw per ADR 0002).
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE audit_events`)
    // Compute the genesis event's row_hash the same way audit/hash.ts does.
    const now = new Date().toISOString()
    const details = JSON.stringify({
      source:         'scripts/clear-non-sunpharma-projects.ts',
      keptProjectId,
      deletedProjectCount: doomedIds.length,
      reseededAt:     now,
    })
    const secret = process.env.AUDIT_HASH_SECRET
    if (!secret) {
      console.error('ERROR: AUDIT_HASH_SECRET is not set — cannot write a valid genesis row. Audit table is now EMPTY.')
      console.error('Fix: set AUDIT_HASH_SECRET and re-run, or manually seed the genesis event.')
      process.exit(5)
    }
    const prevHash = ''.padEnd(64, '0')
    const canonical = JSON.stringify({
      action:     'audit_chain_reseeded',
      entityType: 'system',
      entityId:   'audit_events',
      actorId:    args.actorEmail,
      timestamp:  now,
      details:    JSON.parse(details),
      ipAddress:  null,
    })
    const rowHash = createHash('sha256').update(prevHash + canonical + secret).digest('hex')
    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_events
         (action, entity_type, entity_id, actor_id, timestamp, details, ip_address, prev_hash, row_hash)
       VALUES ($1, $2, $3, $4, $5::timestamp, $6::jsonb, NULL, $7, $8)`,
      'audit_chain_reseeded', 'system', 'audit_events', args.actorEmail, now, details, prevHash, rowHash,
    )
    console.log(`Audit chain reseeded with 1 genesis event (row_hash=${rowHash.slice(0, 12)}…)`)
  } else {
    console.log(`\nAudit chain NOT touched. Pass --reseed-audit to wipe + reseed.`)
    console.log(`(If you DIDN'T want to keep Sun Pharma's old audit entries, re-run with --reseed-audit.)`)
  }

  console.log(`\nDone.\n`)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
