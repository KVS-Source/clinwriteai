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

export interface ResolvedIchFramework {
  name:         string
  version:      string
  jurisdiction: string
}

export interface ResolvedIch {
  /** Convention-map defaults for this doc type (DOC_TYPE_TO_ICH). */
  auto:      ResolvedIchFramework[]
  /** PM-pinned entries on policy.ichFrameworkNames (preferred over auto). */
  pinned:    ResolvedIchFramework[]
  /** 'pinned' when the PM pinned any; 'auto' when only the convention applies;
   *  'none' when neither has an entry that resolves to a live row. */
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
  pinnedNames:  string[],
): Promise<ResolvedIch> {
  const normalised = normaliseDocType(docType)
  const autoName   = DOC_TYPE_TO_ICH[normalised] ?? null

  // Look up every candidate row in one query. Case-insensitive match on
  // the name because admins occasionally type 'ich e3' or 'ICH-E3'. We
  // trim + lowercase the pin list to dedupe + normalise the lookup.
  const pinnedWanted = Array.from(new Set(
    pinnedNames.map(n => n.trim()).filter(Boolean),
  ))
  const wanted = new Set<string>(pinnedWanted)
  if (autoName) wanted.add(autoName)
  if (wanted.size === 0) {
    return { auto: [], pinned: [], effective: 'none' }
  }
  const rows = await prisma.regulatoryFramework.findMany({
    where: {
      name:      { in: Array.from(wanted), mode: 'insensitive' },
      retiredAt: null,
    },
    select: { name: true, version: true, jurisdiction: true },
  })
  const byName = new Map(rows.map(r => [r.name.toLowerCase(), r]))

  // Preserve input order when projecting to the array shape so UI
  // renders pinned entries in the order the PM chose them.
  const pinned: ResolvedIchFramework[] = []
  for (const name of pinnedWanted) {
    const hit = byName.get(name.toLowerCase())
    if (hit) pinned.push(hit)
  }
  const auto: ResolvedIchFramework[] = []
  if (autoName) {
    const hit = byName.get(autoName.toLowerCase())
    if (hit) auto.push(hit)
  }
  const effective: ResolvedIch['effective'] =
    pinned.length > 0 ? 'pinned'
    : auto.length > 0 ? 'auto'
    : 'none'
  return { auto, pinned, effective }
}

export async function resolvePolicyAssets(
  prisma: PrismaClient,
  policy: {
    docType:              string
    templateId:           string | null
    checklistTemplateId:  string | null
    ichFramework?:        string | null       // DEPRECATED — see ichFrameworkNames
    ichFrameworkNames?:   string[] | null
  },
): Promise<ResolvedAssets> {
  // Prefer the new array column; fall back to the legacy single value
  // during the transition window so unmigrated callers still work.
  const pinnedNames = policy.ichFrameworkNames && policy.ichFrameworkNames.length > 0
    ? policy.ichFrameworkNames
    : (policy.ichFramework ? [policy.ichFramework] : [])
  const [template, checklist, ich] = await Promise.all([
    resolveTemplate(prisma, policy.docType, policy.templateId),
    resolveChecklist(prisma, policy.docType, policy.checklistTemplateId),
    resolveIch(prisma, policy.docType, pinnedNames),
  ])
  return { template, checklist, ich }
}
