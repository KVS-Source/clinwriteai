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
// ICH Frameworks auto-match by doc type via a short convention map
// (DOC_TYPE_TO_ICH below) — a CSR drafter always wants ICH E3 behind
// it, a Protocol wants M11, an IB wants E6, etc. The policy's
// ichFramework string is the PM override; when set, it wins over the
// convention. The resolver returns the actual RegulatoryFramework row
// (name + version + jurisdiction) so the editor's dropdown + the AI
// prompt both have a stable handle.

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

export interface ResolvedIch {
  auto:      { name: string; version: string; jurisdiction: string } | null
  pinned:    { name: string; version: string; jurisdiction: string } | null
  effective: 'auto' | 'pinned' | 'none'
}

export interface ResolvedAssets {
  template:  ResolvedTemplate
  checklist: ResolvedChecklist
  ich:       ResolvedIch
}

/** Doc-type → default ICH framework name (matches RegulatoryFramework.name).
 *  Reads as "when no policy pin, assume this convention". When the PM
 *  wants something else they set policy.ichFramework; pinned beats auto.
 *  Doc types normalised to underscore form. Add rows as the catalogue
 *  grows — unknown types fall through to 'none' which is fine. */
export const DOC_TYPE_TO_ICH: Record<string, string> = {
  csr_full:           'ICH E3',
  csr_synopsis:       'ICH E3',
  protocol:           'ICH M11',
  protocol_amendment: 'ICH M11',
  ib:                 'ICH E6',
  dsur:               'ICH E2F',
  psur:               'ICH E2C',
  ind:                'ICH M4',
  nda:                'ICH M4',
  sap:                'ICH E9',
  csr_appendix:       'ICH E3',
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

async function resolveIch(
  prisma:       PrismaClient,
  docType:      string,
  pinnedName:   string | null,
): Promise<ResolvedIch> {
  const normalised = normaliseDocType(docType)
  const autoName   = DOC_TYPE_TO_ICH[normalised] ?? null

  // Look up both candidate rows in one query. Case-insensitive match
  // on the name because admins occasionally type 'ich e3' or 'ICH-E3'.
  const names = new Set<string>()
  if (pinnedName) names.add(pinnedName)
  if (autoName)   names.add(autoName)
  if (names.size === 0) {
    return { auto: null, pinned: null, effective: 'none' }
  }
  const rows = await prisma.regulatoryFramework.findMany({
    where: {
      name:      { in: Array.from(names), mode: 'insensitive' },
      retiredAt: null,
    },
    select: { name: true, version: true, jurisdiction: true },
  })
  const byName = new Map(rows.map(r => [r.name.toLowerCase(), r]))
  const pinned = pinnedName ? (byName.get(pinnedName.toLowerCase()) ?? null) : null
  const auto   = autoName   ? (byName.get(autoName.toLowerCase())   ?? null) : null
  const effective: ResolvedIch['effective'] = pinned ? 'pinned' : (auto ? 'auto' : 'none')
  return { auto, pinned, effective }
}

export async function resolvePolicyAssets(
  prisma: PrismaClient,
  policy: { docType: string; templateId: string | null; checklistTemplateId: string | null; ichFramework?: string | null },
): Promise<ResolvedAssets> {
  const [template, checklist, ich] = await Promise.all([
    resolveTemplate(prisma, policy.docType, policy.templateId),
    resolveChecklist(prisma, policy.docType, policy.checklistTemplateId),
    resolveIch(prisma, policy.docType, policy.ichFramework ?? null),
  ])
  return { template, checklist, ich }
}
