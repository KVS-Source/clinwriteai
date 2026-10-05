// GPP-2022 compliance report builder — pure async function so both the
// JSON route and the PDF route render from the same source of truth.
//
// Scoring is identical to what the JSON route previously inlined; moving
// it here means the PDF renderer sees the same shape without a round-trip.

import type { PrismaClient } from '@prisma/client'
import type { GppReport, GppPillars } from './pdf-renderer.js'

export async function buildGppReport(prisma: PrismaClient, projectId: string): Promise<GppReport | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) return null

  const pubs = await prisma.publication.findMany({
    where: { projectId, deletedAt: null },
    include: {
      authors: {
        include: {
          icmjeCriteria: true,
          icmjeAcknowledgements: true,
        },
      },
      debarmentChecks: { orderBy: { runAt: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const perPub = pubs.map(p => {
    const authors = p.authors
    const icmjeComplete = authors.length > 0 && authors.every(a => {
      const met = a.icmjeCriteria.filter(c => c.met).length
      const ack = a.icmjeAcknowledgements.some(x => x.acknowledgedAt != null)
      return met === 4 && ack
    })
    const latestDebarment = p.debarmentChecks[0]
    const debarmentClear = latestDebarment ? latestDebarment.matchesFound === 0 : false
    const pillars: GppPillars = {
      authorship_icmje: icmjeComplete,
      writing_assistance_disclosed: authors.some(a => a.role.toLowerCase().includes('writer')),
      trial_registration: !!p.sourceDocumentId,
      data_sharing_statement: !!p.keyMessage,
      coi_disclosure: debarmentClear,
      timely_publication: !!p.targetSubmissionDate,
      reporting_guideline: !!p.guideline,
      baa_in_place: p.baaStatus === 'in_place' || p.baaStatus === 'not_applicable',
    }
    const passedCount = Object.values(pillars).filter(Boolean).length
    return {
      id: p.id,
      title: p.title,
      type: p.type,
      stage: p.stage,
      status: p.status,
      guideline: p.guideline,
      journal: p.journal,
      pillars,
      passedCount,
      passedPct: Math.round((passedCount / 8) * 100),
    }
  })

  const totalPillars = perPub.length * 8
  const totalPassed = perPub.reduce((a, p) => a + p.passedCount, 0)
  const overallPct = totalPillars > 0 ? Math.round((totalPassed / totalPillars) * 100) : 0

  return {
    project: { id: project.id, name: project.name, therapeuticArea: project.therapeuticArea },
    standard: 'GPP-2022',
    scope: { publicationCount: pubs.length, totalPillars, totalPassed, overallPct },
    publications: perPub,
    generatedAt: new Date().toISOString(),
  }
}
