// Policy-asset resolver.
//
// A DocumentTypePolicy can either explicitly pin a template / checklist
// (via `templateId` + `checklistTemplateId`) or let the system auto-match
// the current asset of the same `docType`. "Auto-match by docType tag"
// means admins maintain each asset in its own tab (Templates, Checklists)
// without re-touching the policy every time a new version lands.
//
// Rules (per asset):
//   - If the policy has an explicit pin, honour it (lookup by id).
//   - Else, look up the current / locked asset whose doc-type tag matches
//     the policy's docType. Platform baseline wins over project overrides
//     for checklists (null projectId).
//   - Return `{ auto, pinned, effective }` so the UI can distinguish
//     admin's explicit choice from the system default and render a chip
//     with the right "auto" vs "overridden" badge.
//
// ICH Frameworks don't auto-match today — there's no applicableDocTypes
// field on RegulatoryFramework. The policy carries `ichFramework` as a
// free-string name (which the editor renders as a dropdown from the
// RegulatoryFramework list). Keep for a later migration if needed.

import type { PrismaClient } from '@prisma/client'

export interface ResolvedTemplate {
  auto:      { id: string; label: string; version: number } | null
  pinned:    { id: string; label: string; version: number } | null
  effective: 'auto' | 'pinned' | 'none'
}

export interface ResolvedChecklist {
  auto:      { id: string; version: number } | null
  pinned:    { id: string; version: number } | null
  effective: 'auto' | 'pinned' | 'none'
}

export interface ResolvedAssets {
  template:  ResolvedTemplate
  checklist: ResolvedChecklist
}

/** Normalise a docType the way checklist seeding already does — hyphen→underscore. */
function normaliseDocType(s: string): string {
  return s.replace(/-/g, '_')
}

async function resolveTemplate(
  prisma:    PrismaClient,
  docType:   string,
  pinnedId:  string | null,
): Promise<ResolvedTemplate> {
  const normalised = normaliseDocType(docType)
  const [pinned, auto] = await Promise.all([
    pinnedId
      ? prisma.documentTemplate.findUnique({ where: { id: pinnedId }, select: { id: true, label: true, version: true } })
      : Promise.resolve(null),
    // Try both the raw docType and the normalised form — document-templates
    // were seeded with hyphenated types historically (csr-full).
    prisma.documentTemplate.findFirst({
      where: {
        OR: [{ type: docType }, { type: normalised }, { type: docType.replace(/_/g, '-') }],
        isCurrent: true,
        retiredAt: null,
      },
      select: { id: true, label: true, version: true },
    }),
  ])
  const effective: ResolvedTemplate['effective'] = pinned ? 'pinned' : (auto ? 'auto' : 'none')
  return { auto, pinned, effective }
}

async function resolveChecklist(
  prisma:    PrismaClient,
  docType:   string,
  pinnedId:  string | null,
): Promise<ResolvedChecklist> {
  const normalised = normaliseDocType(docType)
  const [pinned, auto] = await Promise.all([
    pinnedId
      ? prisma.checklistTemplate.findUnique({ where: { id: pinnedId }, select: { id: true, version: true } })
      : Promise.resolve(null),
    // Platform baseline (projectId=null, locked, current) wins. Matches the
    // ensureChecklistInstance resolution order.
    prisma.checklistTemplate.findFirst({
      where: {
        deliverableType: normalised,
        projectId:       null,
        isCurrent:       true,
        templateStatus:  'locked',
      },
      select: { id: true, version: true },
      orderBy: { version: 'desc' },
    }),
  ])
  const effective: ResolvedChecklist['effective'] = pinned ? 'pinned' : (auto ? 'auto' : 'none')
  return { auto, pinned, effective }
}

export async function resolvePolicyAssets(
  prisma: PrismaClient,
  policy: { docType: string; templateId: string | null; checklistTemplateId: string | null },
): Promise<ResolvedAssets> {
  const [template, checklist] = await Promise.all([
    resolveTemplate(prisma, policy.docType, policy.templateId),
    resolveChecklist(prisma, policy.docType, policy.checklistTemplateId),
  ])
  return { template, checklist }
}
