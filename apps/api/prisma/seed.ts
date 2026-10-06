// Development seed — minimal baseline so a fresh DB is immediately usable.
//
//   - Three users spanning the RBAC spectrum (admin, writer, reviewer).
//   - Two projects mirroring the prototype's study.json + studyTB.json shape.
//
// Run via `npm run db:seed`. Safe to re-run — uses upserts.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('→ Seeding tenant (Acme Oncology)...')
  const acme = await prisma.tenant.upsert({
    where: { slug: 'acme-oncology' },
    create: {
      id: 'TENANT-ACME',
      slug: 'acme-oncology',
      name: 'Acme Oncology',
      status: 'active',
      // Post 2026-10-06 pivot: tenant has Module A only. Intersected
      // at runtime with FEATURE_MODULES_ENABLED (also 'A').
      modulesEnabled: ['A'],
    },
    update: {},
  })

  console.log('→ Seeding users...')
  // Super-admin crosses tenants — no tenantId, retains all modules for
  // platform-level work. Day-to-day users belong to Acme.
  const admin = await prisma.user.upsert({
    where: { email: 'admin@clinwrite.ai' },
    create: {
      email: 'admin@clinwrite.ai',
      name: 'Platform Admin',
      initials: 'PA',
      role: 'super-admin',
      modules: ['A', 'B', 'C', 'D', 'E'],
      status: 'active',
    },
    update: {},
  })

  const writer = await prisma.user.upsert({
    where: { email: 'writer@clinwrite.ai' },
    create: {
      email: 'writer@clinwrite.ai',
      name: 'Clinical Writer',
      initials: 'CW',
      role: 'clinical-writer',
      modules: ['A'],
      status: 'active',
      tenantId: acme.id,
    },
    update: { tenantId: acme.id },
  })

  // Second writer per Arc 2.7 plan — exercises multi-writer flows.
  const writer2 = await prisma.user.upsert({
    where: { email: 'writer2@clinwrite.ai' },
    create: {
      email: 'writer2@clinwrite.ai',
      name: 'Second Clinical Writer',
      initials: 'SW',
      role: 'clinical-writer',
      modules: ['A'],
      status: 'active',
      tenantId: acme.id,
    },
    update: { tenantId: acme.id },
  })

  const reviewer = await prisma.user.upsert({
    where: { email: 'reviewer@clinwrite.ai' },
    create: {
      email: 'reviewer@clinwrite.ai',
      name: 'Medical Reviewer',
      initials: 'MR',
      role: 'reviewer',
      modules: ['A'],
      status: 'active',
      tenantId: acme.id,
    },
    update: { tenantId: acme.id },
  })

  console.log('→ Seeding memberships...')
  // Per-tenant roles: an owner at the top, writers + reviewer below.
  // Platform-level super-admin stays off memberships; they operate
  // cross-tenant via their User.role.
  for (const [user, role] of [
    [writer,   'owner']    as const,  // writer doubles as Acme owner for seed sanity
    [writer2,  'writer']   as const,
    [reviewer, 'reviewer'] as const,
  ]) {
    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: acme.id, userId: user.id } },
      create: {
        tenantId: acme.id,
        userId: user.id,
        role,
        status: 'active',
        activatedAt: new Date(),
      },
      update: {},
    })
  }

  console.log('→ Seeding projects...')
  const velora = await prisma.project.upsert({
    where: { id: 'PROJ-VELORA' },
    create: {
      id: 'PROJ-VELORA',
      tenantId: acme.id,
      name: 'VELORA — Advanced NSCLC Trial',
      shortTitle: 'VELORA',
      client: 'Oncotype Biosciences',
      therapeuticArea: 'Oncology',
      indication: 'Non-small-cell lung cancer (advanced)',
      phase: 'Phase III',
      status: 'ongoing',
      startDate: new Date('2025-04-01'),
      dataCutoff: new Date('2026-09-15'),
      activeModules: ['A'],
      submissionCountries: ['US', 'EU', 'JP'],
      referenceTrial: 'VELORA-301',
    },
    update: { tenantId: acme.id },
  })

  const atlas = await prisma.project.upsert({
    where: { id: 'PROJ-ATLAS-TB' },
    create: {
      id: 'PROJ-ATLAS-TB',
      tenantId: acme.id,
      name: 'ATLAS-TB — Rifampicin-resistant TB',
      shortTitle: 'ATLAS-TB',
      client: 'GHRC Consortium',
      therapeuticArea: 'Infectious Disease',
      indication: 'Multidrug-resistant tuberculosis',
      phase: 'Phase II',
      status: 'ongoing',
      startDate: new Date('2025-11-01'),
      activeModules: ['A'],
      submissionCountries: ['IN', 'ZA', 'US'],
    },
    update: { tenantId: acme.id },
  })

  console.log('→ Seeding team assignments...')
  for (const projectId of [velora.id, atlas.id]) {
    for (const u of [admin, writer, writer2, reviewer]) {
      await prisma.projectTeamMember.upsert({
        where: { projectId_userId: { projectId, userId: u.id } },
        create: {
          projectId,
          userId: u.id,
          role: u.role === 'super-admin' ? 'Platform Admin' : u.role === 'clinical-writer' ? 'Lead Clinical Writer' : 'Medical Reviewer',
          raci: u.role === 'super-admin' ? 'A' : u.role === 'clinical-writer' ? 'R' : 'C',
          initials: u.initials,
          name: u.name,
        },
        update: {},
      })
    }
  }

  // ----------------------------------------------------------------------
  // Per-module minimal fixtures — one entity each so cutover screens
  // render something instead of empty state. All upserts, so re-runs
  // leave existing data alone + just add anything missing.
  // ----------------------------------------------------------------------

  console.log('→ Seeding Module A — document + current version + sections...')
  const document = await prisma.document.upsert({
    where: { id: 'DOC-VELORA-CSR-001' },
    create: {
      id: 'DOC-VELORA-CSR-001',
      projectId: velora.id,
      type: 'csr_full',
      title: 'VELORA-301 Clinical Study Report',
      status: 'in_authoring',
      stage: 'reporting',
      therapeuticArea: velora.therapeuticArea,
      assigneeId: writer.id,
      targetCompletionDate: new Date('2027-01-15'),
      createdBy: writer.id,
    },
    update: {},
  })
  const docVersion = await prisma.documentVersion.upsert({
    where: { documentId_versionNumber: { documentId: document.id, versionNumber: 'v0.1' } },
    create: {
      documentId: document.id,
      versionNumber: 'v0.1',
      label: 'Draft',
      contentHash: 'seed-placeholder-hash',
      isCurrent: true,
      createdBy: writer.id,
    },
    update: {},
  })
  await prisma.document.update({
    where: { id: document.id },
    data: { currentVersionId: docVersion.id },
  }).catch(() => undefined)
  for (const [sectionId, title, content] of [
    ['11.1', 'Study design', '<p>Randomised, double-blind, placebo-controlled Phase III trial.</p>'],
    ['11.2', 'Patient population', '<p>Adults aged 18-75 with advanced NSCLC.</p>'],
    ['11.3', 'Primary endpoint', '<p>Overall survival at 24 months.</p>'],
  ] as const) {
    await prisma.sectionContent.upsert({
      where: { id: `SEC-${sectionId}-SEED` },
      create: {
        id: `SEC-${sectionId}-SEED`,
        documentVersionId: docVersion.id,
        sectionId,
        sectionNumber: sectionId,
        sectionTitle: title,
        contentHtml: content,
        ichStatus: 'in_progress',
      },
      update: {},
    })
  }

  console.log('→ Seeding Module B — publication + author...')
  const publication = await prisma.publication.upsert({
    where: { id: 'PUB-VELORA-PRIMARY' },
    create: {
      id: 'PUB-VELORA-PRIMARY',
      projectId: velora.id,
      type: 'manuscript',
      subtype: 'primary_results',
      title: 'VELORA-301: Primary analysis of overall survival',
      stage: 'in_authoring',
      status: 'draft',
      version: 'v0.1',
      guideline: 'CONSORT',
      journal: 'NEJM',
      targetSubmissionDate: new Date('2027-03-01'),
      keyMessage: 'Novel therapy significantly improves OS over SoC in advanced NSCLC.',
      baaStatus: 'not_applicable',
      sourceDocumentId: document.id,
      sourceDocumentLabel: `${document.title} v0.1`,
      ownerId: writer.id,
      createdBy: writer.id,
    },
    update: {},
  })
  const author = await prisma.publicationAuthor.upsert({
    where: { publicationId_userId: { publicationId: publication.id, userId: writer.id } },
    create: {
      publicationId: publication.id,
      userId: writer.id,
      name: writer.name,
      initials: writer.initials ?? 'CW',
      role: 'Lead medical writer',
      raci: 'R',
      isExternal: false,
      addedBy: writer.id,
    },
    update: {},
  })
  // ICMJE: four criterion rows per author per spec.
  for (const i of [0, 1, 2, 3]) {
    await prisma.pubIcmjeCriterion.upsert({
      where: { authorId_criterionIndex: { authorId: author.id, criterionIndex: i } },
      create: { authorId: author.id, criterionIndex: i },
      update: {},
    })
  }

  console.log('→ Seeding Module C — med content item...')
  await prisma.medContentItem.upsert({
    where: { id: 'MED-VELORA-HCP-DECK' },
    create: {
      id: 'MED-VELORA-HCP-DECK',
      projectId: velora.id,
      sourceModuleAProjectId: velora.id,
      sourceModuleBPubId: publication.id,
      type: 'hcp_deck',
      title: 'VELORA-301 HCP presentation',
      status: 'briefing',
      stage: 1,
      complianceTrack: 'promotional',
      taTag: velora.therapeuticArea,
      channels: ['field_force', 'congress'],
      targetAudience: ['oncologist'],
      ownerId: writer.id,
      createdBy: writer.id,
    },
    update: {},
  })

  console.log('→ Seeding Module D — regulatory submission...')
  await prisma.regulatorySubmission.upsert({
    where: { id: 'SUB-VELORA-NDA' },
    create: {
      id: 'SUB-VELORA-NDA',
      projectId: velora.id,
      sourceModuleAProjectId: velora.id,
      submissionType: 'nda_maa',
      stage: 1,
      status: 'source_gathering',
      taTag: velora.therapeuticArea,
      targetHas: ['FDA', 'EMA'],
      ownerId: writer.id,
    },
    update: {},
  })

  console.log('→ Seeding Module E — ideation project + artefact...')
  const ideation = await prisma.ideationProject.upsert({
    where: { id: 'IDE-VELORA' },
    create: {
      id: 'IDE-VELORA',
      projectId: velora.id,
      sourceType: 'master_library',
      taTag: velora.therapeuticArea,
      status: 'uploaded',
      createdBy: writer.id,
    },
    update: {},
  })
  await prisma.ideationArtefact.upsert({
    where: { id: 'IDE-ART-VELORA-01' },
    create: {
      id: 'IDE-ART-VELORA-01',
      ideationProjectId: ideation.id,
      sourceModule: 'B',
      sourceDocId: publication.id,
      title: 'VELORA-301 lay summary — primary results',
      originalApprovalDate: new Date('2026-10-01'),
      version: 'v1.0',
    },
    update: {},
  })

  console.log('✔ Seed complete.')
  console.log(`   Tenant:   ${acme.slug} (${acme.id})`)
  console.log(`   Admin:    ${admin.email} (super-admin, cross-tenant)`)
  console.log(`   Writer:   ${writer.email} (Acme owner + writer)`)
  console.log(`   Writer2:  ${writer2.email} (Acme writer)`)
  console.log(`   Reviewer: ${reviewer.email} (Acme reviewer)`)
  console.log(`   Projects: ${velora.id}, ${atlas.id} (both under ${acme.slug})`)
  console.log(`   Fixtures: 1 doc + 1 pub + 1 med-content + 1 submission + 1 ideation artefact (all under VELORA)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
