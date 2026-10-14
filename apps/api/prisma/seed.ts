// Development seed — loads the full fixture set so a fresh demo DB
// has realistic data on first boot. Reads the JSONs at
// apps/web/src/data/* that drive the UI's mock mode and projects
// them into Prisma rows.
//
// Decisions:
//   - **Preserve mock IDs** (user-admin, proj-velora-301, DOC-001).
//     The fixture-import memory called for cuid regen; preserving IDs
//     is simpler + idempotent + keeps any UI test that hard-codes an
//     id working. Revisit when the demo flow doesn't need the stable
//     ids anymore.
//   - **Idempotent via upsert** — safe to re-run on every deploy.
//   - **Scope under the pivot** — tenants/users/projects/Module A
//     documents. B/C/D/E fixtures stay in apps/web/src/data for the
//     eventual Arc 7 resume but aren't projected to the DB here (the
//     modules return 503 at runtime anyway, so loading data would
//     only be wasted bytes).
//
// Run via `npm --workspace=apps/api run db:seed`. Called from
// deploy.sh after `prisma migrate deploy`.

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const prisma = new PrismaClient()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// seed.ts lives at apps/api/prisma — fixtures at apps/web/src/data.
const DATA_DIR = join(__dirname, '..', '..', 'web', 'src', 'data')

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as T
}

// ---------- Fixture types (subset used by the seed) ----------

interface FixtureUser {
  id: string
  name: string
  email: string
  role: string
  modules: string[]
  status: string
  lastActive?: string
}

interface FixtureTeamMember {
  userId: string
  name: string
  initials: string
  role: string
  raci: string
  colourKey?: string
}

interface FixtureProject {
  id: string
  name: string
  shortTitle: string
  client: string
  therapeuticArea: string
  indication?: string
  phase: string
  status: string
  startDate: string
  dataCutoff?: string
  activeModules: string[]
  submissionCountries: string[]
  referenceTrial?: string
  team?: FixtureTeamMember[]
}

interface FixtureSection {
  id: string
  number: string
  title: string
  status: string
  // Optional pre-populated body. Older fixtures omit it (seed defaults
  // to empty string, matching the writer-starts-from-blank flow).
  // Newer "realistic data" fixtures (studyKsavi, studyCardia) include
  // real clinical-writing content so the Dev team can click through
  // a filled-in editor.
  contentHtml?: string
}

interface FixtureDocument {
  id: string
  projectId: string
  type: string
  title: string
  status: string
  stage: string
  version: string
  therapeuticArea: string
  assigneeId: string
  updatedAt?: string
  sections?: FixtureSection[]
}

// ---------- Vocab maps ----------

// users.json uses role names that no longer live in the current
// rbac.Role enum. Map them to the closest active role so the invite
// schema's z.enum() doesn't reject these users on re-save.
const ROLE_MAP: Record<string, string> = {
  'admin':                     'admin',
  'super-admin':               'super-admin',
  'clinical-writer':           'clinical-writer',
  'scientific-writer':         'scientific-writer',
  'medical-writer':            'medical-writer',
  'regulatory-writer':         'regulatory-writer',
  'ideation-lead':             'ideation-lead',
  'reviewer':                  'reviewer',
  'read-only':                 'read-only',
  // Legacy fixture-only roles — map to closest active equivalent.
  'ma-team-lead':              'reviewer',
  'content-calendar-manager':  'ideation-lead',
  'clinical-lead':             'reviewer',
  'cmc-lead':                  'regulatory-writer',
  'author':                    'clinical-writer',
}
function mapRole(fixtureRole: string): string {
  return ROLE_MAP[fixtureRole] ?? 'read-only'
}

// Hyphenated → underscored (both document.type and document.status
// use this convention; the Prisma strings mirror the Postgres enums).
function underscored(v: string): string {
  return v.replace(/-/g, '_')
}

// Membership role is a separate vocab from User.role — writers get
// 'writer', reviewers get 'reviewer', one anchor gets 'owner'. Rough
// mapping; refined by the UI role picker if the operator cares.
function membershipRoleFor(user: FixtureUser): 'owner' | 'admin' | 'writer' | 'reviewer' | 'viewer' {
  if (user.role === 'admin' || user.role === 'super-admin') return 'admin'
  if (user.role === 'reviewer' || user.role === 'clinical-lead' || user.role === 'ma-team-lead') return 'reviewer'
  if (user.role.endsWith('-writer') || user.role === 'author' || user.role === 'cmc-lead' || user.role === 'ideation-lead' || user.role === 'content-calendar-manager') return 'writer'
  return 'viewer'
}

function initialsFor(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => (w[0] ?? '').toUpperCase()).join('')
}

// ---------- Main ----------

async function main() {
  console.log('→ Loading fixtures from', DATA_DIR)
  const users        = readFixture<FixtureUser[]>('users.json')
  const study        = readFixture<FixtureProject>('study.json')
  const studyTB      = readFixture<FixtureProject>('studyTB.json')
  const studyKsavi   = readFixture<FixtureProject>('studyKsavi.json')
  const studyCardia  = readFixture<FixtureProject>('studyCardia.json')
  const docs         = readFixture<FixtureDocument[]>('documents.json')
  const docsKsavi    = readFixture<FixtureDocument[]>('documentsKsavi.json')
  const docsCardia   = readFixture<FixtureDocument[]>('documentsCardia.json')
  // Merge: the loops downstream iterate one combined project list +
  // one combined document list; keeps per-project seeding logic
  // identical to before.
  const allProjects: FixtureProject[]  = [study, studyTB, studyKsavi, studyCardia]
  const allDocs:     FixtureDocument[] = [...docs, ...docsKsavi, ...docsCardia]
  console.log(`   ${users.length} users, ${allProjects.length} projects, ${allDocs.length} documents`)

  // --------------------------------------------------------------
  // 1. Tenant — Acme Oncology (one tenant for the demo environment).
  //    All non-platform-admin users belong to it.
  // --------------------------------------------------------------
  console.log('→ Seeding tenant...')
  const acme = await prisma.tenant.upsert({
    where: { slug: 'acme-oncology' },
    create: {
      id: 'TENANT-ACME',
      slug: 'acme-oncology',
      name: 'Acme Oncology',
      status: 'active',
      modulesEnabled: ['A'],
    },
    update: {},
  })

  // --------------------------------------------------------------
  // 2. Users — 9 personas from users.json.
  //    Admins (role=admin / super-admin) are cross-tenant so get no
  //    tenantId. Everyone else lands in Acme.
  // --------------------------------------------------------------
  console.log('→ Seeding users...')
  const upsertedUsers: Record<string, Awaited<ReturnType<typeof prisma.user.upsert>>> = {}
  for (const u of users) {
    const role = mapRole(u.role)
    const isPlatformAdmin = role === 'admin' || role === 'super-admin'
    const row = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        initials: initialsFor(u.name),
        role,
        modules: u.modules,
        status: u.status,
        tenantId: isPlatformAdmin ? null : acme.id,
        lastActiveAt: u.lastActive ? new Date(u.lastActive) : null,
      },
      update: {
        name: u.name,
        role,
        modules: u.modules,
        status: u.status,
        tenantId: isPlatformAdmin ? null : acme.id,
      },
    })
    upsertedUsers[u.id] = row
  }

  // Legacy admin accounts from the original minimal seed. Keep around
  // so operators who memorised admin@/writer@/reviewer@ still have
  // working logins alongside the richer fixture users.
  for (const legacy of [
    { email: 'admin@clinwrite.ai',    name: 'Mr Rohan Iyer',     role: 'super-admin',     modules: ['A', 'B', 'C', 'D', 'E'], tenantId: null },
    { email: 'writer@clinwrite.ai',   name: 'Ms Ananya Rao',     role: 'clinical-writer', modules: ['A'],                     tenantId: acme.id },
    { email: 'reviewer@clinwrite.ai', name: 'Dr Vikram Mehta',   role: 'reviewer',        modules: ['A'],                     tenantId: acme.id },
  ]) {
    await prisma.user.upsert({
      where: { email: legacy.email },
      create: {
        email: legacy.email,
        name: legacy.name,
        initials: initialsFor(legacy.name),
        role: legacy.role,
        modules: legacy.modules,
        status: 'active',
        tenantId: legacy.tenantId,
      },
      update: {},
    })
  }

  // --------------------------------------------------------------
  // 3. Memberships — one per Acme user. Platform admins stay off
  //    memberships (their cross-tenant role is on User.role).
  // --------------------------------------------------------------
  console.log('→ Seeding memberships...')
  for (const u of users) {
    const row = upsertedUsers[u.id]
    if (!row) continue
    const role = mapRole(u.role)
    if (role === 'admin' || role === 'super-admin') continue
    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: acme.id, userId: row.id } },
      create: {
        tenantId: acme.id,
        userId: row.id,
        role: membershipRoleFor(u),
        status: 'active',
        activatedAt: new Date(),
      },
      update: {},
    })
  }

  // --------------------------------------------------------------
  // 4. Projects — from study.json + studyTB.json. Shape is close to
  //    the Prisma Project model; two fields need mapping:
  //      - phase: 'III' → 'Phase III'
  //      - activeModules: ['clinical-writing'] → ['A'] under the pivot
  // --------------------------------------------------------------
  console.log('→ Seeding projects...')
  function phaseLabel(fixturePhase: string): string {
    const map: Record<string, string> = { 'I': 'Phase I', 'II': 'Phase II', 'III': 'Phase III', 'IV': 'Phase IV' }
    return map[fixturePhase] ?? fixturePhase
  }
  for (const p of allProjects) {
    await prisma.project.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        tenantId: acme.id,
        name: p.name,
        shortTitle: p.shortTitle,
        client: p.client,
        therapeuticArea: p.therapeuticArea,
        indication: p.indication ?? null,
        phase: phaseLabel(p.phase),
        status: p.status,
        startDate: new Date(p.startDate),
        dataCutoff: p.dataCutoff ? new Date(p.dataCutoff) : null,
        activeModules: ['A'],  // pivot — only Module A is active at runtime
        submissionCountries: p.submissionCountries,
        referenceTrial: p.referenceTrial ?? null,
      },
      update: {
        tenantId: acme.id,
        activeModules: ['A'],
      },
    })

    // Team members per project. userId values in study.team sometimes
    // reference personas not present in users.json (user-MW, user-SC,
    // etc. — fixture-only placeholders). ProjectTeamMember.userId has
    // no FK so these insert fine as denorm display rows.
    for (const t of p.team ?? []) {
      await prisma.projectTeamMember.upsert({
        where: { projectId_userId: { projectId: p.id, userId: t.userId } },
        create: {
          projectId: p.id,
          userId: t.userId,
          role: t.role,
          raci: t.raci,
          colourKey: t.colourKey ?? null,
          initials: t.initials,
          name: t.name,
        },
        update: {},
      })
    }
  }

  // --------------------------------------------------------------
  // 5. Documents + current version + sections — from documents.json.
  //    One DocumentVersion per Document; sections hang off the
  //    current version. Status / type values get hyphen→underscore
  //    mapped to match the Postgres enum conventions.
  // --------------------------------------------------------------
  console.log('→ Seeding documents + versions + sections...')
  // Stage vocab map: UI uses 'post-study' / 'reporting' etc.
  const STAGE_MAP: Record<string, string> = {
    'post-study':   'reporting',
    'reporting':    'reporting',
    'study-start-up': 'study_start_up',
    'study-conduct':  'study_conduct',
    'crm-in-progress': 'crm_in_progress',
    'submitted':      'submitted',
  }
  function mapStage(fixtureStage: string): string {
    return STAGE_MAP[fixtureStage] ?? underscored(fixtureStage)
  }
  // Pick a fallback assignee when the fixture refers to a user id
  // that isn't in our User table (e.g. 'user-MW'). The second writer
  // from users.json works as a safe default.
  const fallbackAssignee = upsertedUsers['user-cl'] ?? upsertedUsers['user-admin']
  for (const d of allDocs) {
    const assignee = upsertedUsers[d.assigneeId] ?? fallbackAssignee
    if (!assignee) {
      console.warn(`  skipping ${d.id} — no assignee available`)
      continue
    }
    const doc = await prisma.document.upsert({
      where: { id: d.id },
      create: {
        id: d.id,
        projectId: d.projectId,
        type: underscored(d.type),
        title: d.title,
        status: underscored(d.status),
        stage: mapStage(d.stage),
        therapeuticArea: d.therapeuticArea,
        assigneeId: assignee.id,
        createdBy: assignee.id,
      },
      update: {
        status: underscored(d.status),
        stage: mapStage(d.stage),
      },
    })

    // One current version per document. contentHash is placeholder
    // until a real editor save happens; a stable value makes the
    // row satisfy the NOT NULL constraint on the column.
    const version = await prisma.documentVersion.upsert({
      where: { documentId_versionNumber: { documentId: doc.id, versionNumber: d.version } },
      create: {
        documentId: doc.id,
        versionNumber: d.version,
        label: d.status === 'signed' ? 'Final' : 'Working',
        contentHash: `seed-${d.id}-${d.version}`,
        isCurrent: true,
        createdBy: assignee.id,
      },
      update: {},
    })
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } }).catch(() => undefined)

    // Section rows — one per fixture section. The number field often
    // carries a '§' prefix in the fixture; keep as-is so the UI
    // renders what the author sees.
    for (const s of d.sections ?? []) {
      const body = s.contentHtml ?? ''
      await prisma.sectionContent.upsert({
        where: { documentVersionId_sectionId: { documentVersionId: version.id, sectionId: s.id } },
        create: {
          documentVersionId: version.id,
          sectionId: s.id,
          sectionNumber: s.number,
          sectionTitle: s.title,
          contentHtml: body,
          ichStatus: underscored(s.status),
        },
        update: {
          sectionTitle: s.title,
          ichStatus: underscored(s.status),
          // On re-seed, refresh content so authored fixtures stay in
          // sync. If an operator has manually edited a seeded section
          // via the UI, that edit lives on a NEW DocumentVersion (the
          // PATCH-section flow hashes + versions on change) and this
          // doesn't touch it — only the original seed's version.
          ...(body ? { contentHtml: body } : {}),
        },
      })
    }
  }

  // --------------------------------------------------------------
  // Module C — Medical Writing fixtures (Arc 11.C resume).
  // Seeded only when the matching fixtures load cleanly; failures
  // log + continue so a missing/legacy fixture doesn't take down
  // the whole seed.
  // --------------------------------------------------------------
  try {
    console.log('→ Seeding Module C (Medical Writing)…')
    await seedModuleC()
  } catch (e) {
    console.warn('   Module C seed skipped:', (e as Error).message)
  }

  // --------------------------------------------------------------
  // Done.
  // --------------------------------------------------------------
  const counts = {
    tenants:    await prisma.tenant.count(),
    users:      await prisma.user.count(),
    memberships: await prisma.membership.count(),
    projects:   await prisma.project.count(),
    teamMembers: await prisma.projectTeamMember.count(),
    documents:  await prisma.document.count(),
    versions:   await prisma.documentVersion.count(),
    sections:   await prisma.sectionContent.count(),
    medContent: await prisma.medContentItem.count(),
    medClaims:  await prisma.claimsMatrixItem.count(),
    mlrReviewers: await prisma.mlrReviewer.count(),
    mlrComments: await prisma.mlrComment.count(),
    preMlrRuns:  await prisma.preMlrCheckResult.count(),
  }
  console.log('✔ Seed complete.')
  console.table(counts)
}

// ---------- Module C seeding ----------

interface FixtureMedContent {
  id: string
  projectId: string
  sourceModuleAProjectId: string
  sourceModuleBPublicationId: string | null
  type: string
  title: string
  status: string
  stage: number
  complianceTrack: string
  taTag: string
  version: string
  channels: string[]
  targetAudience: string[]
  reviewTier: 1 | 2 | 3 | null
  reviewTierOverriddenBy: string | null
  fkScore: number | null
  fkPassed: boolean | null
  aiFootprintPct: number | null
  expiryDate: string | null
  approvedAt: string | null
  medicalAffairsPlanId: string | null
  publicationPlanId: string | null
  ownerId: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface FixtureClaim {
  id: string
  contentItemId: string
  claimText: string
  sourceRef: string | null
  sourceType: string | null
  location: string
  approvalStatus: string
  reviewerId: string | null
  similarityPct: number | null
  approvedLibraryText: string | null
  adoptedAt: string | null
}

interface FixturePreMlrIssue {
  id: string
  severity: string
  slide: string | null
  title: string
  detail: string
  suggestedFix: string | null
  acknowledged: boolean
  acknowledgedBy: string | null
  acknowledgedAt: string | null
}

interface FixturePreMlr {
  id: string
  contentItemId: string
  runAt: string
  mustFixCount: number
  shouldFixCount: number
  noteCount: number
  passed: boolean
  runBy: string
  issues: FixturePreMlrIssue[]
}

interface FixtureMlrReviewer {
  id: string
  contentItemId: string
  userId: string
  name: string
  role: string
  assignedAt: string
  submittedAt: string | null
  decision: string | null
  decisionNote: string | null
}

interface FixtureMlrComment {
  id: string
  contentItemId: string
  reviewerId: string
  reviewerName: string
  text: string
  tag: string
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  escalatedFromAgentic?: boolean
  escalatedBy?: string | null
  escalatedAt?: string | null
}

// Module C vocab maps — fixtures were written against the UI's enum names;
// the DB stores snake_case canonical values.
const COMPLIANCE_TRACK_MAP: Record<string, string> = {
  mlr: 'promotional',
  promotional: 'promotional',
  non_promotional: 'non_promotional',
  'non-promotional': 'non_promotional',
  cme: 'cme',
  accme: 'cme',
  advisory: 'advisory',
}
const CLAIM_STATUS_MAP: Record<string, string> = {
  new: 'new',
  approved: 'approved',
  rejected: 'rejected',
  needs_edit: 'needs_edit',
  'needs-edit': 'needs_edit',
  modified: 'needs_edit',
  'must-fix': 'needs_edit',
  must_fix: 'needs_edit',
  library_adopted: 'library_adopted',
}
const CLAIM_SOURCE_TYPE_MAP: Record<string, string> = {
  smpc: 'smpc',
  csr: 'csr',
  publication: 'publication',
  label: 'label',
}
const PRE_MLR_SEVERITY_MAP: Record<string, string> = {
  'must-fix': 'must_fix',
  'should-fix': 'should_fix',
  must_fix: 'must_fix',
  should_fix: 'should_fix',
  note: 'note',
}
const TIER_UI_TO_DB: Record<number, 'A' | 'B' | 'C'> = { 1: 'A', 2: 'B', 3: 'C' }

// Module C fixtures reference Module-C-specific user IDs (user-sc, user-ah,
// user-rk, user-rm, user-sp, user-jh) that don't exist in users.json. Map
// to the closest matching persona in the base seed, or fall back to
// user-admin so the referenced-user FK check still passes.
const MOD_C_USER_ALIAS: Record<string, string> = {
  'user-sc': 'user-rw',       // Sarah Chen         → s.chen@genbioca.com (user-rw)
  'user-rm': 'user-ma',       // Rebecca Morton     → r.morton@genbioca.com (user-ma)
  'user-dc': 'user-dc',       // David Chen         → d.chen@genbioca.com (user-dc) ✓
  'user-jh': 'user-admin',    // James Hartley      → j.hartley@genbioca.com (user-admin)
  'user-sp': 'user-admin',    // Sarah Price (MLR Regulatory) — fallback to admin
  'user-ah': 'user-admin',    // unmatched            → admin
  'user-rk': 'user-admin',    // unmatched            → admin
}

async function seedModuleC() {
  const medContent  = readFixture<FixtureMedContent[]>('medContent.json')
  const medClaims   = readFixture<FixtureClaim[]>('medClaims.json')
  const medPreMlr   = readFixture<FixturePreMlr>('medPreMLR.json')
  const mlrReviewers = readFixture<FixtureMlrReviewer[]>('medMLRReviewers.json')
  const mlrComments = readFixture<FixtureMlrComment[]>('medMLRComments.json')

  // Content items — upsert so re-seed is idempotent. Only seed items whose
  // referenced project exists in Postgres (fixtures reference proj-velora-301
  // which was created in the Module A seed above).
  const knownProjectIds = new Set(
    (await prisma.project.findMany({ select: { id: true } })).map(p => p.id),
  )
  const knownUserIds = new Set(
    (await prisma.user.findMany({ select: { id: true } })).map(u => u.id),
  )
  const resolveUserId = (id: string): string | null => {
    if (knownUserIds.has(id)) return id
    const alias = MOD_C_USER_ALIAS[id]
    if (alias && knownUserIds.has(alias)) return alias
    return null
  }

  let contentSeeded = 0
  for (const mc of medContent) {
    if (!knownProjectIds.has(mc.projectId)) continue
    const createdBy = resolveUserId(mc.createdBy) ?? resolveUserId(mc.ownerId) ?? null
    const ownerId   = resolveUserId(mc.ownerId) ?? createdBy
    if (!createdBy || !ownerId) continue                                  // skip unassignable rows

    await prisma.medContentItem.upsert({
      where: { id: mc.id },
      create: {
        id: mc.id,
        projectId: mc.projectId,
        sourceModuleAProjectId: mc.sourceModuleAProjectId,
        sourceModuleBPubId: mc.sourceModuleBPublicationId,
        type: underscored(mc.type),
        title: mc.title,
        status: underscored(mc.status),
        stage: mc.stage,
        complianceTrack: COMPLIANCE_TRACK_MAP[mc.complianceTrack] ?? 'promotional',
        taTag: mc.taTag,
        version: mc.version,
        channels: mc.channels,
        targetAudience: mc.targetAudience,
        reviewTier: mc.reviewTier ? TIER_UI_TO_DB[mc.reviewTier] : null,
        tierOverriddenBy: mc.reviewTierOverriddenBy,
        fkScore: mc.fkScore ?? null,
        fkPassed: mc.fkPassed,
        aiFootprintPct: mc.aiFootprintPct,
        expiryDate: mc.expiryDate ? new Date(mc.expiryDate) : null,
        approvedAt: mc.approvedAt ? new Date(mc.approvedAt) : null,
        medicalAffairsPlanId: mc.medicalAffairsPlanId,
        publicationPlanId: mc.publicationPlanId,
        ownerId,
        createdBy,
        createdAt: new Date(mc.createdAt),
        updatedAt: new Date(mc.updatedAt),
      },
      update: {
        title: mc.title,
        status: underscored(mc.status),
        stage: mc.stage,
        reviewTier: mc.reviewTier ? TIER_UI_TO_DB[mc.reviewTier] : null,
        updatedAt: new Date(mc.updatedAt),
      },
    })
    contentSeeded += 1
  }
  console.log(`   ${contentSeeded}/${medContent.length} med-content items seeded`)

  // Claims — upsert on fixture id, bound to seeded content items only.
  const seededContentIds = new Set(
    (await prisma.medContentItem.findMany({ select: { id: true } })).map(c => c.id),
  )
  let claimsSeeded = 0
  for (const cl of medClaims) {
    if (!seededContentIds.has(cl.contentItemId)) continue
    await prisma.claimsMatrixItem.upsert({
      where: { id: cl.id },
      create: {
        id: cl.id,
        contentItemId: cl.contentItemId,
        claimText: cl.claimText,
        sourceRef: cl.sourceRef ?? 'unspecified',
        sourceType: CLAIM_SOURCE_TYPE_MAP[cl.sourceType ?? ''] ?? 'label',
        location: cl.location,
        approvalStatus: CLAIM_STATUS_MAP[cl.approvalStatus] ?? 'new',
        reviewerId: resolveUserId(cl.reviewerId ?? '') ?? null,
        similarityPct: cl.similarityPct,
        approvedLibraryText: cl.approvedLibraryText,
        adoptedAt: cl.adoptedAt ? new Date(cl.adoptedAt) : null,
      },
      update: {
        approvalStatus: CLAIM_STATUS_MAP[cl.approvalStatus] ?? 'new',
        similarityPct: cl.similarityPct,
      },
    })
    claimsSeeded += 1
  }
  console.log(`   ${claimsSeeded}/${medClaims.length} claims seeded`)

  // Pre-MLR run — one fixture object with nested issues.
  if (seededContentIds.has(medPreMlr.contentItemId) && resolveUserId(medPreMlr.runBy)) {
    const existing = await prisma.preMlrCheckResult.findUnique({ where: { id: medPreMlr.id } })
    if (!existing) {
      await prisma.preMlrCheckResult.create({
        data: {
          id: medPreMlr.id,
          contentItemId: medPreMlr.contentItemId,
          runAt: new Date(medPreMlr.runAt),
          mustFixCount: medPreMlr.mustFixCount,
          shouldFixCount: medPreMlr.shouldFixCount,
          noteCount: medPreMlr.noteCount,
          passed: medPreMlr.passed,
          runBy: resolveUserId(medPreMlr.runBy)!,
          issues: {
            create: medPreMlr.issues.map(iss => ({
              id: iss.id,
              severity: PRE_MLR_SEVERITY_MAP[iss.severity] ?? 'note',
              slide: iss.slide,
              title: iss.title,
              detail: iss.detail,
              suggestedFix: iss.suggestedFix,
              acknowledged: iss.acknowledged,
              acknowledgedBy: iss.acknowledgedBy,
              acknowledgedAt: iss.acknowledgedAt ? new Date(iss.acknowledgedAt) : null,
            })),
          },
        },
      })
      console.log(`   1 pre-MLR run + ${medPreMlr.issues.length} issues seeded`)
    }
  }

  // MLR reviewers — unique on (contentItem, user).
  let reviewersSeeded = 0
  for (const r of mlrReviewers) {
    if (!seededContentIds.has(r.contentItemId)) continue
    if (!resolveUserId(r.userId)) continue
    await prisma.mlrReviewer.upsert({
      where: { contentItemId_userId: { contentItemId: r.contentItemId, userId: r.userId } },
      create: {
        id: r.id,
        contentItemId: r.contentItemId,
        userId: r.userId,
        role: r.role,
        assignedAt: new Date(r.assignedAt),
        submittedAt: r.submittedAt ? new Date(r.submittedAt) : null,
        decision: r.decision,
        decisionNote: r.decisionNote,
      },
      update: {
        submittedAt: r.submittedAt ? new Date(r.submittedAt) : null,
      },
    })
    reviewersSeeded += 1
  }
  console.log(`   ${reviewersSeeded}/${mlrReviewers.length} MLR reviewers seeded`)

  // MLR comments.
  let commentsSeeded = 0
  for (const c of mlrComments) {
    if (!seededContentIds.has(c.contentItemId)) continue
    if (!resolveUserId(c.reviewerId)) continue
    await prisma.mlrComment.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        contentItemId: c.contentItemId,
        reviewerId: c.reviewerId,
        reviewerName: c.reviewerName,
        text: c.text,
        tag: c.tag,
        createdAt: new Date(c.createdAt),
        resolvedAt: c.resolvedAt ? new Date(c.resolvedAt) : null,
        resolvedBy: c.resolvedBy,
        escalatedFromAgentic: c.escalatedFromAgentic ?? false,
        escalatedBy: c.escalatedBy ?? null,
        escalatedAt: c.escalatedAt ? new Date(c.escalatedAt) : null,
      },
      update: {},
    })
    commentsSeeded += 1
  }
  console.log(`   ${commentsSeeded}/${mlrComments.length} MLR comments seeded`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
