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
//   fromdoc:<id>      the source document, on document AND section pushes (lookup key)
//   docversion:<v>    version of the source document when it was pushed (e.g. v0.3)
//
// Any other tag is a plain user tag. Once real columns exist this file is the
// only place that has to change.

export const KNOWN_MODULES = ['A', 'B', 'C', 'D', 'E'] as const
export type LibModule = (typeof KNOWN_MODULES)[number] | 'platform'
export type LibItemType = 'document' | 'section' | 'best-practice'

const META_KEYS = ['module', 'doctype', 'project', 'source', 'type', 'category', 'effective', 'valid-until', 'docversion', 'fromdoc'] as const

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
  createdAt?: Date
  updatedAt: Date
}

export interface LibraryContext {
  userNames: Map<string, string>
  projects: Map<string, { name: string; status: string }>
  /** Titles of the source documents a page of rows was pushed from, by document id. */
  documents?: Map<string, string>
  /** First version of each item (by tenant + title): who made it and when. */
  firstVersions?: Map<string, { createdAt: Date; by: string }>
  /** The Clinical Writing document an item was pushed from: its people, by document id. */
  sourceDocuments?: Map<string, SourceDocumentInfo>
}

/** RACI letters in the order the panel lists them. */
const LETTER_ORDER = ['R', 'A', 'C', 'Q', 'I']

/**
 * Who worked on the source document, as the library panel shows it. Names are resolved
 * already; the library is read by people outside the project, so this carries names and
 * roles only, never content.
 */
export interface SourceDocumentInfo {
  createdByName: string
  createdAt: string
  /** The last person whose own (non-AI) writing is in the current text, and when. */
  lastEditedByName: string | null
  lastEditedAt: string | null
  /** Everyone whose own (non-AI) writing is in the current text, most recent first. */
  editors: string[]
  /** Current role holders on the document (removed rows left out), Authors first. */
  team: { letter: string; name: string }[]
  /** Signatures of the completed signature chain, in chain order. */
  signatures: { name: string; meaning: string; signedAt: string; version: string | null }[]
}

/** Raw rows for one document → SourceDocumentInfo. Pure, so it is tested without a database. */
export function sourceDocumentInfo(args: {
  createdBy: string
  createdAt: Date
  sections: { lastEditedBy: string | null; lastEditedAt: Date | null; humanSpanCount: number }[]
  raci: { userId: string; letter: string; removedAt: Date | null }[]
  signatures: { signerId: string; signerName: string; meaning: string; step: number; timestampUtc: Date | null; versionAtSigning: string | null }[]
  userNames: Map<string, string>
}): SourceDocumentInfo {
  const name = (id: string) => args.userNames.get(id) ?? 'Unknown user'

  // Most recent edit per person, newest first. A section holding only AI text is left out: the
  // AI drafter writes it under the name of whoever created the document, who didn't edit it.
  const lastEditBy = new Map<string, Date>()
  for (const s of args.sections) {
    if (!s.lastEditedBy || !s.lastEditedAt || s.humanSpanCount === 0) continue
    const seen = lastEditBy.get(s.lastEditedBy)
    if (!seen || s.lastEditedAt > seen) lastEditBy.set(s.lastEditedBy, s.lastEditedAt)
  }
  const edits = [...lastEditBy.entries()].sort((a, b) => b[1].getTime() - a[1].getTime())

  // One entry per person and letter (a whole-document row and a section row are the same role here).
  const seenRole = new Set<string>()
  const team = args.raci
    .filter(r => !r.removedAt)
    .filter(r => { const k = `${r.userId}|${r.letter}`; if (seenRole.has(k)) return false; seenRole.add(k); return true })
    .map(r => ({ letter: r.letter, name: name(r.userId) }))
    .sort((a, b) => (LETTER_ORDER.indexOf(a.letter) - LETTER_ORDER.indexOf(b.letter)) || a.name.localeCompare(b.name))

  return {
    createdByName: name(args.createdBy),
    createdAt: args.createdAt.toISOString(),
    lastEditedByName: edits[0] ? name(edits[0][0]) : null,
    lastEditedAt: edits[0] ? edits[0][1].toISOString() : null,
    editors: edits.map(([id]) => name(id)),
    team,
    signatures: [...args.signatures]
      .filter(s => s.timestampUtc)
      .sort((a, b) => a.step - b.step)
      .map(s => ({ name: args.userNames.get(s.signerId) ?? s.signerName, meaning: s.meaning, signedAt: s.timestampUtc!.toISOString(), version: s.versionAtSigning })),
  }
}

/** The source document id inside a `source:` tag value (`<docId>` or `<docId>#<sectionId>`). */
export const sourceDocumentId = (sourceId: string) => sourceId.split('#')[0]!
export const firstVersionKey = (row: Pick<SectionRow, 'tenantId' | 'title'>) => `${row.tenantId ?? ''}|${row.title}`

export interface ParsedTags {
  module: LibModule
  docTypes: string[]
  projectId: string | null
  sourceId: string | null
  isDocument: boolean
  category: string | null
  effective: string | null
  validUntil: string | null
  docVersion: string | null
  plain: string[]
}

export function parseTags(tags: string[]): ParsedTags {
  const out: ParsedTags = {
    module: 'platform', docTypes: [], projectId: null, sourceId: null,
    isDocument: false, category: null, effective: null, validUntil: null, docVersion: null, plain: [],
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
      case 'docversion':  out.docVersion = value; break
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
  const first = ctx.firstVersions?.get(firstVersionKey(row))

  const provenanceChain = [
    `Project: ${project?.name ?? 'Platform library'}`,
    `Module: ${t.module === 'platform' ? 'Platform' : `${t.module} · ${MODULE_NAME[t.module]}`}`,
    ...(t.sourceId ? [`Source: ${ctx.documents?.get(sourceDocumentId(t.sourceId)) ?? t.sourceId}${t.docVersion ? ` (${t.docVersion})` : ''}`] : []),
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
    isWithdrawn: !!row.retiredAt,
    ...(archived && {
      archivedReason: row.retiredAt ? 'Withdrawn from the library' : 'Source project is closed',
    }),
    provenanceChain,
    // These describe the library entry: who pushed this version (editedByName), and who pushed
    // the first one and when (createdByName / createdAt). The source document's own people
    // are in sourceDocument.
    editedByName: pushedByName,
    createdAt: (first?.createdAt ?? row.createdAt ?? row.approvedAt).toISOString(),
    createdByName: first ? (ctx.userNames.get(first.by) ?? 'Unknown user') : pushedByName,
    updatedAt: row.updatedAt.toISOString(),
    body: row.body,
    ...(() => {
      const info = t.sourceId ? ctx.sourceDocuments?.get(sourceDocumentId(t.sourceId)) : undefined
      return info ? { sourceDocument: info } : {}
    })(),
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
