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
    { email: 'admin@clinwrite.ai',    name: 'Platform Admin',    role: 'super-admin',     modules: ['A', 'B', 'C', 'D', 'E'], tenantId: null },
    { email: 'writer@clinwrite.ai',   name: 'Clinical Writer',   role: 'clinical-writer', modules: ['A'],                     tenantId: acme.id },
    { email: 'reviewer@clinwrite.ai', name: 'Medical Reviewer',  role: 'reviewer',        modules: ['A'],                     tenantId: acme.id },
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
  }
  console.log('✔ Seed complete.')
  console.table(counts)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
