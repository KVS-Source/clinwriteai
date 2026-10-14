// Shape mappers for the Master Library UI (packages/types MasterLibraryItem /
// BestPractice) over the existing `library_sections` table.
//
// The table has no module / project / document-type / source columns yet, so
// that metadata travels in the free-form `tags` list as `key:value` pairs:
//
//   module:D          owning module (A–E); absent → platform-wide
//   doctype:NDA       document type (repeatable)
//   project:<id>      source project (drives the project name + archive state)
//   source:<id>       source document / section id (provenance)
//   type:document     marks a whole document (default is a section)
//   category:<label>  best-practice category
//   effective:<date>  best practice effective-from  (YYYY-MM-DD)
//   valid-until:<d>   best practice valid-until     (YYYY-MM-DD)
//
// Any other tag is a plain user tag. Once real columns exist this file is the
// only place that has to change.

export const KNOWN_MODULES = ['A', 'B', 'C', 'D', 'E'] as const
export type LibModule = (typeof KNOWN_MODULES)[number] | 'platform'
export type LibItemType = 'document' | 'section' | 'best-practice'

const META_KEYS = ['module', 'doctype', 'project', 'source', 'type', 'category', 'effective', 'valid-until'] as const

export interface SectionRow {
  id: string
  tenantId: string | null
  title: string
  body: string
  taTag: string
  framework: string
  category: string
  version: number
  isCurrent: boolean
  approvedBy: string
  approvedAt: Date
  retiredAt: Date | null
  tags: string[]
  updatedAt: Date
}

export interface LibraryContext {
  userNames: Map<string, string>
  projects: Map<string, { name: string; status: string }>
}

export interface ParsedTags {
  module: LibModule
  docTypes: string[]
  projectId: string | null
  sourceId: string | null
  isDocument: boolean
  category: string | null
  effective: string | null
  validUntil: string | null
  plain: string[]
}

export function parseTags(tags: string[]): ParsedTags {
  const out: ParsedTags = {
    module: 'platform', docTypes: [], projectId: null, sourceId: null,
    isDocument: false, category: null, effective: null, validUntil: null, plain: [],
  }
  for (const raw of tags) {
    const i = raw.indexOf(':')
    const key = i > 0 ? raw.slice(0, i) : ''
    const value = i > 0 ? raw.slice(i + 1).trim() : ''
    if (!(META_KEYS as readonly string[]).includes(key) || !value) { out.plain.push(raw); continue }
    switch (key) {
      case 'module': {
        const m = value.toUpperCase()
        if ((KNOWN_MODULES as readonly string[]).includes(m)) out.module = m as LibModule
        else out.plain.push(raw)          // keep a malformed value visible instead of dropping it
        break
      }
      case 'doctype':     out.docTypes.push(value); break
      case 'project':     out.projectId = value; break
      case 'source':      out.sourceId = value; break
      case 'type':        if (value === 'document') out.isDocument = true; break
      case 'category':    out.category = value; break
      case 'effective':   out.effective = value; break
      case 'valid-until': out.validUntil = value; break
    }
  }
  return out
}

/** Row version (Int) → the "v1.0" style label the UI shows. */
export const versionLabel = (n: number) => `v${n}.0`

/** "v2.0" / "v2" / "2" → 2, or null when it isn't a version label. */
export function parseVersionLabel(v: string): number | null {
  const m = /^v?(\d+)(?:\.\d+)?$/i.exec(v.trim())
  return m ? Number(m[1]) : null
}

const MODULE_NAME: Record<string, string> = {
  A: 'Clinical Writing', B: 'Scientific Writing', C: 'Medical Writing',
  D: 'Regulatory Writing', E: 'Ideation & Publishing', platform: 'Platform',
}

const day = (d: Date) => d.toISOString().slice(0, 10)

export function itemTypeOf(row: Pick<SectionRow, 'category' | 'tags'>): LibItemType {
  if (row.category === 'best_practice') return 'best-practice'
  return parseTags(row.tags).isDocument ? 'document' : 'section'
}

export function sectionToItem(row: SectionRow, ctx: LibraryContext) {
  const t = parseTags(row.tags)
  const project = t.projectId ? ctx.projects.get(t.projectId) : undefined
  const pushedByName = ctx.userNames.get(row.approvedBy) ?? 'Unknown user'
  const closed = project?.status === 'closed'
  const archived = !!row.retiredAt || closed
  const version = versionLabel(row.version)

  const provenanceChain = [
    ...(project ? [`Project: ${project.name}`] : []),
    `${t.module === 'platform' ? 'Platform' : `Module ${t.module} · ${MODULE_NAME[t.module]}`}`,
    ...(t.sourceId ? [`Source: ${t.sourceId}`] : []),
    `Master Library · ${version} · ${day(row.approvedAt)} by ${pushedByName}`,
  ]

  return {
    id: row.id,
    name: row.title,
    module: t.module,
    itemType: itemTypeOf(row),
    docType: t.docTypes[0] ?? row.framework,
    ta: [row.taTag],
    version,
    pushedAt: row.approvedAt.toISOString(),
    pushedBy: row.approvedBy,
    pushedByName,
    projectId: t.projectId ?? '',
    projectName: project?.name ?? 'Platform library',
    tags: t.plain,
    isArchived: archived,
    ...(archived && {
      archivedReason: row.retiredAt ? 'Withdrawn from the library' : 'Source project is closed',
    }),
    provenanceChain,
    body: row.body,
  }
}

/** A best practice is due for review when it expires within 30 days (or already has). */
export const REVIEW_WINDOW_DAYS = 30

export function sectionToBestPractice(row: SectionRow, now = new Date()) {
  const t = parseTags(row.tags)
  const effectiveFrom = t.effective ?? day(row.approvedAt)
  const validUntil = t.validUntil ?? ''
  let reviewDue = false
  let reviewDueNote: string | undefined
  if (validUntil) {
    const ms = new Date(`${validUntil}T23:59:59Z`).getTime() - now.getTime()
    if (ms < 0) { reviewDue = true; reviewDueNote = `Expired ${validUntil} — review overdue` }
    else if (ms < REVIEW_WINDOW_DAYS * 86_400_000) { reviewDue = true; reviewDueNote = `Valid until ${validUntil} — review due` }
  }
  return {
    id: row.id,
    module: t.module,
    category: t.category ?? 'General',
    name: row.title,
    guidance: row.body,
    applicableDocTypes: t.docTypes,
    frameworkRefs: row.framework.split(',').map(s => s.trim()).filter(Boolean),
    effectiveFrom,
    validUntil,
    version: versionLabel(row.version),
    createdBy: row.approvedBy,
    updatedAt: row.updatedAt.toISOString(),
    reviewDue,
    ...(reviewDueNote && { reviewDueNote }),
  }
}

/** [Module]-[Category]-[Version]-[Date], e.g. Module-D-CTD-Authoring-v1.2-2026-01 */
export const BEST_PRACTICE_NAME = /^(Module-[A-E]|Platform)-[A-Za-z0-9][A-Za-z0-9-]*-v\d+(\.\d+)?-\d{4}(-\d{2})?$/
