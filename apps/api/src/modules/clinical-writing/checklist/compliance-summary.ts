// Compliance Summary for an output document (FR-A-030, FR-A-001d, AC-A-029, AC-A-013): the
// frameworks the document's checklist applies, the rules (checklist items) applied under each
// with their outcome, the frameworks' references, and every waived or removed Framework
// Mandatory item with who did it, when and why. Read-only: never creates a checklist instance.
// Shared by the Final Document screen and its PDF, so the two cannot disagree.

import type { PrismaClient } from '@prisma/client'
import { ICH_E3_SECTIONS, isIchE3Applicable } from '../ich-e3/catalog.js'

export type ComplianceSummary = Awaited<ReturnType<typeof buildComplianceSummary>>

export async function buildComplianceSummary(prisma: PrismaClient, doc: { id: string; type: string | null }) {
  const documentId = doc.id
  const instance = await prisma.checklistInstance.findUnique({
    where:  { documentId },
    select: { templateVersion: true, items: { orderBy: { sortOrder: 'asc' } } },
  })
  const allItems = instance?.items ?? []
  // Removed items are not "rules applied" — they are disclosed separately.
  const items = allItems.filter(i => i.status !== 'removed')

  // ICH E3 section waivers (full CSRs only) are Framework Mandatory
  // waivers too, so they are disclosed alongside the checklist ones.
  const ichWaivers = isIchE3Applicable(doc.type ?? '')
    ? await prisma.ichSectionWaiver.findMany({
        where:   { documentId },
        orderBy: { waivedAt: 'asc' },
        select:  { sectionCode: true, waivedBy: true, waivedAt: true, reason: true },
      })
    : []

  const userIds = [...new Set([
    ...allItems.flatMap(i => [i.waivedBy, i.completedBy]),
    ...ichWaivers.map(w => w.waivedBy),
  ].filter((v): v is string => !!v))]
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : []
  const nameOf = (id: string | null) => (id ? users.find(u => u.id === id)?.name ?? id : null)

  const frameworkNames = [...new Set(items.map(i => i.framework))]
  const registry = frameworkNames.length
    ? await prisma.regulatoryFramework.findMany({ where: { name: { in: frameworkNames } } })
    : []

  const frameworks = frameworkNames.map(name => {
    const reg = registry.find(r => r.name === name) ?? null
    const rules = items.filter(i => i.framework === name)
    return {
      name,
      version:       reg?.version ?? null,
      jurisdiction:  reg?.jurisdiction ?? null,
      description:   reg?.description ?? null,
      sourceUrl:     reg?.sourceUrl ?? null,
      inRegistry:    !!reg,
      rules: rules.map(i => ({
        text:      i.text,
        mandatory: i.frameworkMandatory,
        status:    i.status,
      })),
    }
  })

  const sectionTitle = (code: string) => {
    const def = ICH_E3_SECTIONS.find(s => s.code === code)
    return def ? `${def.code} ${def.title}` : code
  }
  const waivedMandatory = [
    ...items
      .filter(i => i.status === 'waived' && i.frameworkMandatory)
      .map(i => ({
        text:      i.text,
        framework: i.framework,
        waivedBy:  nameOf(i.waivedBy),
        waivedAt:  i.waivedAt?.toISOString() ?? null,
        reason:    i.waiverReason ?? null,
      })),
    ...ichWaivers.map(w => ({
      text:      sectionTitle(w.sectionCode),
      framework: 'ICH E3',
      waivedBy:  nameOf(w.waivedBy),
      waivedAt:  w.waivedAt?.toISOString() ?? null,
      reason:    w.reason ?? null,
    })),
  ]

  // FR-A-001d: removing a Framework Mandatory item is disclosed too.
  const removedMandatory = allItems
    .filter(i => i.status === 'removed' && i.frameworkMandatory)
    .map(i => ({
      text:      i.text,
      framework: i.framework,
      removedBy: nameOf(i.waivedBy),
      removedAt: i.waivedAt?.toISOString() ?? null,
      reason:    i.waiverReason ?? null,
    }))

  return {
    documentId,
    checklistTemplateVersion: instance?.templateVersion ?? null,
    generatedAt: new Date().toISOString(),
    frameworks,
    waivedMandatory,
    removedMandatory,
  }
}
