// Development seed — minimal baseline so a fresh DB is immediately usable.
//
//   - Three users spanning the RBAC spectrum (admin, writer, reviewer).
//   - Two projects mirroring the prototype's study.json + studyTB.json shape.
//
// Run via `npm run db:seed`. Safe to re-run — uses upserts.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('→ Seeding users...')
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
      modules: ['A', 'C'],
      status: 'active',
    },
    update: {},
  })

  const reviewer = await prisma.user.upsert({
    where: { email: 'reviewer@clinwrite.ai' },
    create: {
      email: 'reviewer@clinwrite.ai',
      name: 'Medical Reviewer',
      initials: 'MR',
      role: 'reviewer',
      modules: ['A', 'B', 'C', 'D'],
      status: 'active',
    },
    update: {},
  })

  console.log('→ Seeding projects...')
  const velora = await prisma.project.upsert({
    where: { id: 'PROJ-VELORA' },
    create: {
      id: 'PROJ-VELORA',
      name: 'VELORA — Advanced NSCLC Trial',
      shortTitle: 'VELORA',
      client: 'Oncotype Biosciences',
      therapeuticArea: 'Oncology',
      indication: 'Non-small-cell lung cancer (advanced)',
      phase: 'Phase III',
      status: 'ongoing',
      startDate: new Date('2025-04-01'),
      dataCutoff: new Date('2026-09-15'),
      activeModules: ['A', 'B', 'C', 'D'],
      submissionCountries: ['US', 'EU', 'JP'],
      referenceTrial: 'VELORA-301',
    },
    update: {},
  })

  const atlas = await prisma.project.upsert({
    where: { id: 'PROJ-ATLAS-TB' },
    create: {
      id: 'PROJ-ATLAS-TB',
      name: 'ATLAS-TB — Rifampicin-resistant TB',
      shortTitle: 'ATLAS-TB',
      client: 'GHRC Consortium',
      therapeuticArea: 'Infectious Disease',
      indication: 'Multidrug-resistant tuberculosis',
      phase: 'Phase II',
      status: 'ongoing',
      startDate: new Date('2025-11-01'),
      activeModules: ['A', 'B', 'E'],
      submissionCountries: ['IN', 'ZA', 'US'],
    },
    update: {},
  })

  console.log('→ Seeding team assignments...')
  for (const projectId of [velora.id, atlas.id]) {
    for (const u of [admin, writer, reviewer]) {
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

  console.log('✔ Seed complete.')
  console.log(`   Admin:    ${admin.email}`)
  console.log(`   Writer:   ${writer.email}`)
  console.log(`   Reviewer: ${reviewer.email}`)
  console.log(`   Projects: ${velora.id}, ${atlas.id}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
