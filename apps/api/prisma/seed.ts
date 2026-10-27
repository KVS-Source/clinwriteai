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
import { seedChecklistBaseline } from './seeds/checklist-baseline.js'

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
  // Post 2026-10-27 role consolidation: 'super-admin' retired; map
  // legacy fixture entries to 'admin' so re-seeds don't resurrect it.
  'super-admin':               'admin',
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
  if (user.role === 'admin') return 'admin'
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
  //    Admins are cross-tenant when they're platform admins (tenantId=null).
  //    Everyone else lands in Acme. (Post 2026-10-27 role consolidation —
  //    'super-admin' retired, mapped to 'admin' by ROLE_MAP.)
  // --------------------------------------------------------------
  console.log('→ Seeding users...')
  const upsertedUsers: Record<string, Awaited<ReturnType<typeof prisma.user.upsert>>> = {}
  for (const u of users) {
    const role = mapRole(u.role)
    const isPlatformAdmin = role === 'admin'
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
  //
  // a.thornton@clinwrite.ai is the demo platform-admin persona wired in
  // apps/web/src/platform/store/platformStore.ts (role='admin',
  // tenantId=null — what used to be 'super-admin' before the
  // 2026-10-27 role consolidation). Must exist in the DB so the
  // X-Demo-Persona header resolves her; otherwise persona-switch calls
  // land as AUTH_BYPASS_EMAIL (also an admin) and the platform-admin
  // screens (Tenants, Rate Cards, Analytics…) 403.
  for (const legacy of [
    { id: null,       email: 'admin@clinwrite.ai',       name: 'Mr Rohan Iyer',   role: 'admin',           modules: ['A', 'B', 'C', 'D', 'E'], tenantId: null },
    // Alex Thornton — demo platform-admin persona in the UI's
    // PLATFORM_DEMO_USERS. Explicit id='user-sa' + email so the
    // X-Demo-Persona header can resolve her by either; without this
    // the id lookup falls back to AUTH_BYPASS_EMAIL.
    { id: 'user-sa',  email: 'a.thornton@clinwrite.ai',  name: 'Alex Thornton',   role: 'admin',           modules: ['A', 'B', 'C', 'D', 'E'], tenantId: null },
    { id: null,       email: 'writer@clinwrite.ai',      name: 'Ms Ananya Rao',   role: 'clinical-writer', modules: ['A'],                     tenantId: acme.id },
    { id: null,       email: 'reviewer@clinwrite.ai',    name: 'Dr Vikram Mehta', role: 'reviewer',        modules: ['A'],                     tenantId: acme.id },
  ]) {
    await prisma.user.upsert({
      where: { email: legacy.email },
      create: {
        ...(legacy.id ? { id: legacy.id } : {}),
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
    if (role === 'admin') continue
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
    // Point at the fixture version only on first seed. The staging deploy
    // re-runs this seed; resetting the pointer on every run rewound documents
    // to their fixture version (edits looked lost) and made the next save
    // collide with an existing version number ("Save failed").
    if (!doc.currentVersionId) {
      await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } }).catch(() => undefined)
    }

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

  try {
    console.log('→ Seeding Module B (Scientific Writing)…')
    await seedModuleB()
  } catch (e) {
    console.warn('   Module B seed skipped:', (e as Error).message)
  }

  try {
    console.log('→ Seeding Module D (Regulatory Writing)…')
    await seedModuleD()
  } catch (e) {
    console.warn('   Module D seed skipped:', (e as Error).message)
  }

  try {
    console.log('→ Seeding Module E (Ideation & Publishing)…')
    await seedModuleE()
  } catch (e) {
    console.warn('   Module E seed skipped:', (e as Error).message)
  }

  try {
    console.log('→ Seeding Module B slide deck (SlidedeckGenerator fixture)…')
    await seedSlideDeck()
  } catch (e) {
    console.warn('   Slide deck seed skipped:', (e as Error).message)
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
    publications: await prisma.publication.count(),
    pubAuthors:   await prisma.publicationAuthor.count(),
    citations:    await prisma.citation.count(),
    regSubmissions: await prisma.regulatorySubmission.count(),
    ideationProjects: await prisma.ideationProject.count(),
    ideationArtefacts: await prisma.ideationArtefact.count(),
    ideationCards: await prisma.ideationContentCard.count(),
    kolContacts: await prisma.kolContact.count(),
    calendarEntries: await prisma.calendarEntry.count(),
    slideDeckJobs: await prisma.slideDeckJob.count(),
    slides: await prisma.slide.count(),
    slideFigures: await prisma.slideFigure.count(),
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

// ---------- Module B seeding ----------
//
// Fixtures: publications.json, publicationAuthors.json, citations.json.
// Vocab gaps that need normalising for the DB:
//   - subtype 'original-research' (UI hyphen) → 'original_research' (DB snake)
//   - baaStatus 'not-applicable' (UI hyphen) → 'not_applicable' (DB snake)
//   - status / stage left hyphenated (route handlers accept either)
// Author / citation user and project FKs are resolved via the same
// user-alias map pattern as Module C so fixture-only IDs resolve to
// seeded User rows.

interface FixturePublication {
  id: string
  projectId: string
  type: string
  subtype: string | null
  title: string
  stage: string
  status: string
  version: string
  guideline: string
  journal: string | null
  targetSubmissionDate: string | null
  keyMessage: string | null
  baaStatus: string
  sourceDocumentId: string | null
  sourceDocumentLabel: string | null
  ownerId: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface FixtureIcmjeCriterion {
  criterionIndex: number
  met: boolean
  confirmedBy: string | null
  confirmedAt: string | null
}

interface FixturePublicationAuthor {
  id: string
  publicationId: string
  userId: string | null
  name: string
  initials: string
  role: string
  raci: 'R' | 'A' | 'C' | 'I'
  isExternal: boolean
  coiStatus: string | null
  coiSubmittedAt: string | null
  debarmentStatus: string | null
  debarmentCheckedAt: string | null
  invitedAt: string | null
  inviteEmail: string | null
  addedBy: string
  addedAt: string
  removedAt: string | null
  icmjeCriteria: FixtureIcmjeCriterion[]
  icmjeAcknowledged: boolean
  icmjeAcknowledgedBy: string | null
  icmjeAcknowledgedAt: string | null
}

interface FixtureCitation {
  id: string
  publicationId: string
  pmid: string | null
  title: string
  shortRef: string
  fullRef: string
  locus: string | null
  isSourceDocument: boolean
  insertedBy: string
  insertedAt: string
  removedBy: string | null
  removedAt: string | null
}

const SUBTYPE_UI_TO_DB: Record<string, string> = {
  'original-research':  'original_research',
  'systematic-review':  'systematic_review',
  'case-report':        'case_report',
  'original_research':  'original_research',
  'systematic_review':  'systematic_review',
  'case_report':        'case_report',
}
const BAA_UI_TO_DB: Record<string, string> = {
  'not-applicable': 'not_applicable',
  'in-progress':    'in_progress',
  not_applicable:   'not_applicable',
  required:         'required',
  in_progress:      'in_progress',
  executed:         'executed',
}
// Module B fixtures reference 'user-mw' / 'user-sc' / 'user-ev' / etc.
// Not every id exists in the base seed; map to the closest match.
const MOD_B_USER_ALIAS: Record<string, string> = {
  'user-mw':      'user-rw',       // Marcus Webb → s.chen (writer)
  'user-sc':      'user-rw',       // Sarah Chen → s.chen (writer)
  'user-pn':      'user-admin',    // Priya Nair → admin
  'user-ev':      'user-ma',       // Elena Vasquez → r.morton (reviewer)
  'user-ah':      'user-admin',    // Ashish → admin
  'user-rk':      'user-admin',    // Rohan → admin
  'user-jh':      'user-admin',    // James Hartley → admin
  'user-dc':      'user-dc',       // David Chen → d.chen ✓
}

async function seedModuleB() {
  const pubs    = readFixture<FixturePublication[]>('publications.json')
  const authors = readFixture<FixturePublicationAuthor[]>('publicationAuthors.json')
  const cites   = readFixture<FixtureCitation[]>('citations.json')

  const knownProjectIds = new Set(
    (await prisma.project.findMany({ select: { id: true } })).map(p => p.id),
  )
  const knownUserIds = new Set(
    (await prisma.user.findMany({ select: { id: true } })).map(u => u.id),
  )
  const resolveUserId = (id: string | null): string | null => {
    if (!id) return null
    if (knownUserIds.has(id)) return id
    const alias = MOD_B_USER_ALIAS[id]
    if (alias && knownUserIds.has(alias)) return alias
    return null
  }

  let pubCount = 0
  for (const p of pubs) {
    if (!knownProjectIds.has(p.projectId)) continue
    const ownerId   = resolveUserId(p.ownerId)   ?? resolveUserId(p.createdBy)
    const createdBy = resolveUserId(p.createdBy) ?? ownerId
    if (!ownerId || !createdBy) continue

    await prisma.publication.upsert({
      where: { id: p.id },
      create: {
        id:                   p.id,
        projectId:            p.projectId,
        type:                 p.type,
        subtype:              p.subtype ? (SUBTYPE_UI_TO_DB[p.subtype] ?? p.subtype) : null,
        title:                p.title,
        stage:                p.stage,
        status:               p.status,
        version:              p.version,
        guideline:            p.guideline,
        journal:              p.journal,
        targetSubmissionDate: p.targetSubmissionDate ? new Date(p.targetSubmissionDate) : null,
        keyMessage:           p.keyMessage,
        baaStatus:            BAA_UI_TO_DB[p.baaStatus] ?? 'not_applicable',
        sourceDocumentId:     p.sourceDocumentId,
        sourceDocumentLabel:  p.sourceDocumentLabel,
        ownerId,
        createdBy,
        createdAt:            new Date(p.createdAt),
        updatedAt:            new Date(p.updatedAt),
      },
      update: {
        title:   p.title,
        stage:   p.stage,
        status:  p.status,
        version: p.version,
        updatedAt: new Date(p.updatedAt),
      },
    })
    pubCount += 1
  }
  console.log(`   ${pubCount}/${pubs.length} publications seeded`)

  const seededPubIds = new Set(
    (await prisma.publication.findMany({ select: { id: true } })).map(p => p.id),
  )

  let authorCount = 0
  // Track (publicationId, userId) collisions caused by MOD_B_USER_ALIAS collapsing
  // multiple fixture users onto the same real user — the DB has a UNIQUE on the
  // pair, so the second-and-later authors land with userId=null (schema already
  // allows null for external KOLs).
  const seenPubUser = new Set<string>()
  for (const a of authors) {
    if (!seededPubIds.has(a.publicationId)) continue
    const resolvedUserId = resolveUserId(a.userId)
    const key = resolvedUserId ? `${a.publicationId}|${resolvedUserId}` : null
    const userId = key && seenPubUser.has(key) ? null : resolvedUserId
    if (key && userId) seenPubUser.add(key)
    const addedBy = resolveUserId(a.addedBy)
    if (!addedBy) continue

    const row = await prisma.publicationAuthor.upsert({
      where: { id: a.id },
      create: {
        id:                 a.id,
        publicationId:      a.publicationId,
        userId,                                                          // nullable for external KOLs
        name:               a.name,
        initials:           a.initials,
        role:               a.role,
        raci:               a.raci,
        isExternal:         a.isExternal,
        coiStatus:          a.coiStatus,
        debarmentStatus:    a.debarmentStatus,
        invitedAt:          a.invitedAt ? new Date(a.invitedAt) : null,
        inviteEmail:        a.inviteEmail,
        addedBy,
        addedAt:            new Date(a.addedAt),
        removedAt:          a.removedAt ? new Date(a.removedAt) : null,
      },
      update: { role: a.role, raci: a.raci, coiStatus: a.coiStatus, debarmentStatus: a.debarmentStatus },
    })

    // Ensure exactly four ICMJE criteria per author (model requirement).
    for (const c of a.icmjeCriteria) {
      await prisma.pubIcmjeCriterion.upsert({
        where: { authorId_criterionIndex: { authorId: row.id, criterionIndex: c.criterionIndex } },
        create: {
          authorId:       row.id,
          criterionIndex: c.criterionIndex,
          met:            c.met,
          confirmedBy:    c.confirmedBy,
          confirmedAt:    c.confirmedAt ? new Date(c.confirmedAt) : null,
        },
        update: { met: c.met },
      })
    }

    authorCount += 1
  }
  console.log(`   ${authorCount}/${authors.length} publication authors seeded`)

  let citCount = 0
  for (const c of cites) {
    if (!seededPubIds.has(c.publicationId)) continue
    await prisma.citation.upsert({
      where: { id: c.id },
      create: {
        id:               c.id,
        publicationId:    c.publicationId,
        pmid:             c.pmid,
        title:            c.title,
        shortRef:         c.shortRef,
        fullRef:          c.fullRef,
        locus:            c.locus,
        isSourceDocument: c.isSourceDocument,
        insertedBy:       c.insertedBy,
        insertedAt:       new Date(c.insertedAt),
        removedBy:        c.removedBy,
        removedAt:        c.removedAt ? new Date(c.removedAt) : null,
      },
      update: {
        title:    c.title,
        shortRef: c.shortRef,
        fullRef:  c.fullRef,
      },
    })
    citCount += 1
  }
  console.log(`   ${citCount}/${cites.length} citations seeded`)
}

// ---------- Module D seeding ----------
//
// Fixtures: regulatorySubmissions.json.
// Vocab maps:
//   - submissionType hyphen→snake (nda-maa → nda_maa; psur-pbrer →
//     psur_pbrer; ha-response → ha_response; rmp-rems → rmp_rems)
//   - status hyphen→snake (module2-authoring → module2_authoring; etc)
// User alias map falls back to the base-seed users when fixture IDs
// aren't resolvable (same pattern as Modules B and C).

interface FixtureRegSubmission {
  id: string
  projectId: string
  sourceModuleAProjectId: string | null
  submissionType: string
  status: string
  stage: number
  targetHAs: string[]
  ectdVersion: string
  taTag: string
  validatorEngine: string | null
  title: string
  compound: string | null
  indication: string | null
  ownerId: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

const SUB_TYPE_UI_TO_DB: Record<string, string> = {
  'ind':         'ind',
  'nda-maa':     'nda_maa',
  'nda_maa':     'nda_maa',
  'psur-pbrer':  'psur_pbrer',
  'psur_pbrer':  'psur_pbrer',
  'rmp-rems':    'rmp_rems',
  'rmp_rems':    'rmp_rems',
  'ha-response': 'ha_response',
  'ha_response': 'ha_response',
  'cer':         'cer',
  'orphan-drug': 'orphan_drug',
  'orphan_drug': 'orphan_drug',
}

async function seedModuleD() {
  const subs = readFixture<FixtureRegSubmission[]>('regulatorySubmissions.json')

  const knownProjectIds = new Set(
    (await prisma.project.findMany({ select: { id: true } })).map(p => p.id),
  )
  const knownUserIds = new Set(
    (await prisma.user.findMany({ select: { id: true } })).map(u => u.id),
  )
  const resolveUserId = (id: string | null): string | null => {
    if (!id) return null
    if (knownUserIds.has(id)) return id
    // Reuse Module B's alias map plus Module C's
    const alias = MOD_B_USER_ALIAS[id] ?? MOD_C_USER_ALIAS[id]
    if (alias && knownUserIds.has(alias)) return alias
    return null
  }

  let count = 0
  for (const s of subs) {
    if (!knownProjectIds.has(s.projectId)) continue
    const ownerId   = resolveUserId(s.ownerId)   ?? resolveUserId(s.createdBy)
    const createdBy = resolveUserId(s.createdBy) ?? ownerId
    if (!ownerId || !createdBy) continue

    const dbType   = SUB_TYPE_UI_TO_DB[s.submissionType] ?? s.submissionType
    const dbStatus = s.status.replace(/-/g, '_')

    await prisma.regulatorySubmission.upsert({
      where: { id: s.id },
      create: {
        id:                     s.id,
        projectId:              s.projectId,
        sourceModuleAProjectId: s.sourceModuleAProjectId ?? s.projectId,
        submissionType:         dbType,
        status:                 dbStatus,
        stage:                  s.stage,
        targetHas:              s.targetHAs,
        ectdVersion:            s.ectdVersion,
        taTag:                  s.taTag,
        validatorEngine:        s.validatorEngine ?? 'extedo',
        ownerId,
        createdAt:              new Date(s.createdAt),
        updatedAt:              new Date(s.updatedAt),
      },
      update: {
        status:    dbStatus,
        stage:     s.stage,
        updatedAt: new Date(s.updatedAt),
      },
    })
    count += 1
  }
  console.log(`   ${count}/${subs.length} regulatory submissions seeded`)
}

// ---------- Module E seeding ----------
//
// Fixtures: ideationProjects.json, ideationArtefacts.json,
// ideationContentCards.json, kolContacts.json, ideationCalendar.json.
//
// UI → DB enum conversions:
//   sourceType     'master-library'            → 'master_library'
//   status (stage) 'under-review'              → 'under_review'
//                  'calendar-approved'         → 'calendar_approved'
//   claimCurrency  'potentially-superseded'    → 'potentially_superseded'
//   channel        'medical-affairs'           → 'medical_affairs'
//
// User alias: reuses MOD_B_USER_ALIAS + MOD_C_USER_ALIAS and adds the
// Module E-specific personas (user-il, user-ma, user-cr).

interface FixtureIdeationProject {
  id:         string
  projectId:  string
  sourceType: string
  taTag:      string
  status:     string
  createdBy:  string
  createdAt:  string
  updatedAt:  string
}

interface FixtureIdeationArtefact {
  id:                    string
  ideationProjectId:     string
  sourceModule:          string | null
  sourceDocId:           string | null
  filePath?:             string
  title:                 string
  originalApprovalDate:  string | null
  version:               string
  sourceCurrencyStatus:  string
  approvalStatusCheck:   string
  masterLibraryPushDate: string | null
}

interface FixtureIdeationCard {
  id:                   string
  ideationArtefactId:   string
  ideationProjectId:    string
  sourceSection:        string
  sourcePassage:        string
  claimCurrencyStatus:  string
  channelFormats:       string[]
  kolStatus?:           string
  maStatus?:            string
  overallStatus?:       string
  provenance?:          Record<string, unknown>
}

interface FixtureKolContact {
  id:                string
  ideationProjectId: string
  name:              string
  email:             string
  reviewLinkToken:   string
  reviewLinkExpiry:  string
  signedOffAt:       string | null
  reminder1SentAt:   string | null
  reminder2SentAt:   string | null
  escalatedAt:       string | null
}

interface FixtureCalendarEntry {
  id:                     string
  ideationContentCardId:  string
  channel:                string
  scheduledDate:          string
  assignedCreativeId:     string | null
  status:                 string
  publishedAt:            string | null
  publishedBy:            string | null
}

const MOD_E_USER_ALIAS: Record<string, string> = {
  'user-il': 'user-admin',  // Ideation Lead  → admin
  'user-ma': 'user-ma',     // MA Team Lead   ✓
  'user-cr': 'user-rw',     // Creative       → writer
  'user-mw': 'user-rw',     // Marcus Webb    → writer
}

const E_SOURCE_TYPE_UI_TO_DB: Record<string, string> = {
  'master-library': 'master_library',
  'master_library': 'master_library',
  'upload':         'upload',
  'external':       'external',
}

const E_STATUS_UI_TO_DB: Record<string, string> = {
  'uploaded':           'uploaded',
  'content-cards':      'content_cards',
  'atomised':           'atomised',
  'under-review':       'under_review',
  'calendar-approved':  'calendar_approved',
  'published':          'published',
  'approved':           'calendar_approved',  // UI uses 'approved' loosely
}

const E_CLAIM_CURRENCY_UI_TO_DB: Record<string, string> = {
  'current':                 'current',
  'potentially-superseded':  'potentially_superseded',
  'conflicting':             'conflicting',
}

const E_APPROVAL_UI_TO_DB: Record<string, string> = {
  'passed':              'passed',
  'blocked':             'blocked',
  'confirmed-external':  'confirmed_external',
  'pending':             'pending',
}

const E_SOURCE_CURRENCY_UI_TO_DB: Record<string, string> = {
  'current':              'current',
  'superseded':           'superseded',
  'warned':               'warned',
  'external-confirmed':   'external_confirmed',
}

const E_CHANNEL_UI_TO_DB: Record<string, string> = {
  'linkedin':         'linkedin',
  'twitter':          'twitter',
  'blog':             'blog',
  'email':            'email',
  'hcp':              'hcp',
  'medical-affairs':  'medical_affairs',
  'medical_affairs':  'medical_affairs',
  'instagram':        'instagram',
  'facebook':         'facebook',
}

const E_REVIEW_STATUS_UI_TO_DB: Record<string, string> = {
  'pending':  'pending',
  'approved': 'approved',
  'rejected': 'rejected',
}

async function seedModuleE() {
  const ideationProjects = readFixture<FixtureIdeationProject[]>('ideationProjects.json')
  const artefacts        = readFixture<FixtureIdeationArtefact[]>('ideationArtefacts.json')
  const cards            = readFixture<FixtureIdeationCard[]>('ideationContentCards.json')
  const kols             = readFixture<FixtureKolContact[]>('kolContacts.json')
  const calendar         = readFixture<FixtureCalendarEntry[]>('ideationCalendar.json')

  const knownProjectIds = new Set(
    (await prisma.project.findMany({ select: { id: true } })).map(p => p.id),
  )
  const knownUserIds = new Set(
    (await prisma.user.findMany({ select: { id: true } })).map(u => u.id),
  )
  const resolveUserId = (id: string | null): string | null => {
    if (!id) return null
    if (knownUserIds.has(id)) return id
    const alias = MOD_E_USER_ALIAS[id] ?? MOD_B_USER_ALIAS[id] ?? MOD_C_USER_ALIAS[id]
    if (alias && knownUserIds.has(alias)) return alias
    return null
  }

  // --- Ideation projects --------------------------------------------------
  let ipCount = 0
  for (const ip of ideationProjects) {
    if (!knownProjectIds.has(ip.projectId)) continue
    const createdBy = resolveUserId(ip.createdBy)
    if (!createdBy) continue

    const dbSource = E_SOURCE_TYPE_UI_TO_DB[ip.sourceType] ?? ip.sourceType
    const dbStatus = E_STATUS_UI_TO_DB[ip.status] ?? ip.status.replace(/-/g, '_')

    await prisma.ideationProject.upsert({
      where:  { id: ip.id },
      create: {
        id:         ip.id,
        projectId:  ip.projectId,
        sourceType: dbSource,
        taTag:      ip.taTag,
        status:     dbStatus,
        createdBy,
        createdAt:  new Date(ip.createdAt),
        updatedAt:  new Date(ip.updatedAt),
      },
      update: {
        status:    dbStatus,
        updatedAt: new Date(ip.updatedAt),
      },
    })
    ipCount += 1
  }
  console.log(`   ${ipCount}/${ideationProjects.length} ideation projects seeded`)

  // --- Artefacts ---------------------------------------------------------
  const knownIpIds = new Set(
    (await prisma.ideationProject.findMany({ select: { id: true } })).map(r => r.id),
  )
  let artCount = 0
  for (const a of artefacts) {
    if (!knownIpIds.has(a.ideationProjectId)) continue

    const dbApproval  = E_APPROVAL_UI_TO_DB[a.approvalStatusCheck]   ?? 'pending'
    const dbCurrency  = E_SOURCE_CURRENCY_UI_TO_DB[a.sourceCurrencyStatus] ?? 'current'
    // originalApprovalDate is required (non-null) on the DB; fall back to
    // today when fixture leaves it null (blocked artefacts).
    const approvalDate = a.originalApprovalDate ? new Date(a.originalApprovalDate) : new Date()

    await prisma.ideationArtefact.upsert({
      where:  { id: a.id },
      create: {
        id:                    a.id,
        ideationProjectId:     a.ideationProjectId,
        sourceModule:          a.sourceModule ?? null,
        sourceDocId:           a.sourceDocId  ?? null,
        filePath:              a.filePath     ?? null,
        title:                 a.title,
        originalApprovalDate:  approvalDate,
        version:               a.version,
        sourceCurrencyStatus:  dbCurrency,
        approvalStatusCheck:   dbApproval,
        masterLibraryPushDate: a.masterLibraryPushDate ? new Date(a.masterLibraryPushDate) : null,
      },
      update: {
        title:                 a.title,
        sourceCurrencyStatus:  dbCurrency,
        approvalStatusCheck:   dbApproval,
      },
    })
    artCount += 1
  }
  console.log(`   ${artCount}/${artefacts.length} ideation artefacts seeded`)

  // --- Content cards -----------------------------------------------------
  const knownArtefactIds = new Set(
    (await prisma.ideationArtefact.findMany({ select: { id: true } })).map(r => r.id),
  )
  let cardCount = 0
  for (const c of cards) {
    if (!knownArtefactIds.has(c.ideationArtefactId)) continue

    const dbCurrency = E_CLAIM_CURRENCY_UI_TO_DB[c.claimCurrencyStatus] ?? 'current'
    const dbKol      = E_REVIEW_STATUS_UI_TO_DB[c.kolStatus ?? 'pending'] ?? 'pending'
    const dbMa       = E_REVIEW_STATUS_UI_TO_DB[c.maStatus  ?? 'pending'] ?? 'pending'
    const dbOverall  = E_STATUS_UI_TO_DB[c.overallStatus ?? 'uploaded'] ?? (c.overallStatus ?? 'uploaded').replace(/-/g, '_')
    const dbChannels = c.channelFormats.map(ch => E_CHANNEL_UI_TO_DB[ch] ?? ch)

    await prisma.ideationContentCard.upsert({
      where:  { id: c.id },
      create: {
        id:                   c.id,
        ideationArtefactId:   c.ideationArtefactId,
        sourceSection:        c.sourceSection,
        sourcePassage:        c.sourcePassage,
        claimCurrencyStatus:  dbCurrency,
        channelFormats:       dbChannels,
        kolStatus:            dbKol,
        maStatus:             dbMa,
        overallStatus:        dbOverall === 'approved' ? 'approved' : dbOverall,
        provenance:           (c.provenance ?? {}) as unknown as object,
      },
      update: {
        kolStatus:    dbKol,
        maStatus:     dbMa,
        overallStatus: dbOverall === 'approved' ? 'approved' : dbOverall,
      },
    })
    cardCount += 1
  }
  console.log(`   ${cardCount}/${cards.length} ideation content cards seeded`)

  // --- KOL contacts ------------------------------------------------------
  let kolCount = 0
  for (const k of kols) {
    if (!knownIpIds.has(k.ideationProjectId)) continue
    await prisma.kolContact.upsert({
      where:  { id: k.id },
      create: {
        id:                k.id,
        ideationProjectId: k.ideationProjectId,
        name:              k.name,
        email:             k.email,
        reviewLinkToken:   k.reviewLinkToken,
        reviewLinkExpiry:  new Date(k.reviewLinkExpiry),
        signedOffAt:       k.signedOffAt     ? new Date(k.signedOffAt)     : null,
        reminder1SentAt:   k.reminder1SentAt ? new Date(k.reminder1SentAt) : null,
        reminder2SentAt:   k.reminder2SentAt ? new Date(k.reminder2SentAt) : null,
        escalatedAt:       k.escalatedAt     ? new Date(k.escalatedAt)     : null,
      },
      update: {
        signedOffAt:     k.signedOffAt     ? new Date(k.signedOffAt)     : null,
      },
    })
    kolCount += 1
  }
  console.log(`   ${kolCount}/${kols.length} kol contacts seeded`)

  // --- Calendar entries --------------------------------------------------
  const knownCardIds = new Set(
    (await prisma.ideationContentCard.findMany({ select: { id: true } })).map(r => r.id),
  )
  const CAL_STATUS_UI_TO_DB: Record<string, string> = {
    'scheduled': 'scheduled',
    'published': 'published',
    'overdue':   'overdue',
    'cancelled': 'cancelled',
  }
  let calCount = 0
  for (const e of calendar) {
    if (!knownCardIds.has(e.ideationContentCardId)) continue
    const assignedCreativeId = resolveUserId(e.assignedCreativeId)
    const publishedBy        = resolveUserId(e.publishedBy)

    await prisma.calendarEntry.upsert({
      where:  { id: e.id },
      create: {
        id:                     e.id,
        ideationContentCardId:  e.ideationContentCardId,
        channel:                E_CHANNEL_UI_TO_DB[e.channel] ?? e.channel,
        scheduledDate:          new Date(e.scheduledDate),
        assignedCreativeId:     assignedCreativeId,
        status:                 CAL_STATUS_UI_TO_DB[e.status] ?? e.status,
        publishedAt:            e.publishedAt ? new Date(e.publishedAt) : null,
        publishedBy:            publishedBy,
      },
      update: {
        status:      CAL_STATUS_UI_TO_DB[e.status] ?? e.status,
        publishedAt: e.publishedAt ? new Date(e.publishedAt) : null,
      },
    })
    calCount += 1
  }
  console.log(`   ${calCount}/${calendar.length} calendar entries seeded`)
}

// ---------- Slide deck seeding (Module B SlidedeckGenerator) ----------
//
// Fixture: apps/web/src/data/slidedeckJob.json (one deck, 6 slides, 3
// figures). The fixture's publicationId `pub-velora-301-manuscript` is a
// frontend demo constant and doesn't exist in publications.json — we
// re-point to pub-001 (same VELORA-301 manuscript) so the FK resolves.
// The SlidedeckGenerator UI's DEMO_PUB_ID has been updated to match.

interface FixtureSlideFigure {
  figureId:          string
  altText:           string | null
  figureDescription?: string
}
interface FixtureSlide {
  id:           string
  position:     number
  title:        string
  bodyText:     string
  figures:      FixtureSlideFigure[]
  speakerNotes: string
}
interface FixtureSlideDeck {
  id:               string
  publicationId:    string
  source:           string
  congressTarget?:  string | null
  slideCountLimit:  number
  status:           string
  aiModel:          string
  aiFootprintPct:   number
  generatedAt:      string
  slides:           FixtureSlide[]
}

// The fixture's demo publicationId doesn't match any seeded Publication; map it.
const SLIDE_DECK_PUB_ALIAS: Record<string, string> = {
  'pub-velora-301-manuscript': 'pub-001',
}

async function seedSlideDeck() {
  const deck = readFixture<FixtureSlideDeck>('slidedeckJob.json')
  const resolvedPubId = SLIDE_DECK_PUB_ALIAS[deck.publicationId] ?? deck.publicationId
  const pub = await prisma.publication.findUnique({ where: { id: resolvedPubId } })
  if (!pub) {
    console.log(`   publication ${resolvedPubId} not found — skipping slide deck seed`)
    return
  }

  await prisma.slideDeckJob.upsert({
    where:  { id: deck.id },
    create: {
      id:              deck.id,
      publicationId:   resolvedPubId,
      source:          deck.source,
      congressTarget:  deck.congressTarget ?? null,
      slideCountLimit: deck.slideCountLimit,
      status:          deck.status,
      aiModel:         deck.aiModel,
      aiFootprintPct:  deck.aiFootprintPct,
      generatedAt:     new Date(deck.generatedAt),
    },
    update: {
      status:         deck.status,
      aiFootprintPct: deck.aiFootprintPct,
      congressTarget: deck.congressTarget ?? null,
    },
  })

  let slideCount = 0
  let figureCount = 0
  for (const s of deck.slides) {
    await prisma.slide.upsert({
      where:  { id: s.id },
      create: {
        id:             s.id,
        slideDeckJobId: deck.id,
        position:       s.position,
        title:          s.title,
        bodyText:       s.bodyText,
        speakerNotes:   s.speakerNotes,
      },
      update: {
        position:     s.position,
        title:        s.title,
        bodyText:     s.bodyText,
        speakerNotes: s.speakerNotes,
      },
    })
    slideCount += 1

    // Figures — delete + re-create so re-runs stay consistent with the fixture.
    await prisma.slideFigure.deleteMany({ where: { slideId: s.id } })
    for (const f of s.figures) {
      await prisma.slideFigure.create({
        data: {
          slideId:           s.id,
          figureRef:         f.figureId,
          altText:           f.altText,
          figureDescription: f.figureDescription ?? null,
        },
      })
      figureCount += 1
    }
  }
  console.log(`   ${slideCount}/${deck.slides.length} slides seeded, ${figureCount} figures`)

  // --------------------------------------------------------------
  // Checklist platform baseline — one locked ChecklistTemplate per
  // Module A deliverable type, pre-loaded with the compliance floor
  // (ICH E3 / ICH E6 / 21 CFR Part 11…). Idempotent: re-runs reconcile
  // by item text, no cascading changes to in-flight instances.
  // --------------------------------------------------------------
  console.log('→ Seeding checklist platform baseline...')
  // Prefer an existing admin as the audit actor; falls back to the
  // deterministic 'system' sentinel on a bare database.
  const baselineActor = await prisma.user.findFirst({
    where: { role: { in: ['admin'] } },
    select: { id: true },
  })
  const baselineReport = await seedChecklistBaseline(prisma, {
    actorId: baselineActor?.id ?? 'system',
  })
  console.log(
    `   ${baselineReport.templatesTouched} templates (${baselineReport.templatesCreated} new) · `
    + `${baselineReport.itemsCreated} items created, ${baselineReport.itemsPreserved} preserved`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
