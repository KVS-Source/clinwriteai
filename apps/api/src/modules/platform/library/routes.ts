// Master Library routes — Phase 4 cross-module shared service.
//
// Modules B (publications), C (med content), D (regulatory), E (ideation)
// all pull approved content from here. Writes come from compliance admins
// after new approved wording ships.
//
// Versioning model:
//   - Updating an existing section creates a NEW LibrarySection row with
//     version+1 and flips the old row's `isCurrent=false` + `supersededBy`.
//     Audit trail stays correct and consumers can still link to historical
//     wording for provenance.
//   - "Retiring" (POST /:id/retire) sets `retiredAt` without creating a
//     new version — used for sections pulled permanently.
//
// Adoption tracking:
//   - LibraryAdoptionRecord captures every consumer action. On POST
//     /:id/adopt, usage_count on the section is bumped in the same tx.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { DATE_IN_PAST, isPastDay } from '../past-date.js'
import { enabledModules, requireAuth, type AuthenticatedUser } from '../../../auth/rbac.js'
import { invalidTaBody, resolveTa } from '../taxonomy/validate.js'
import type { Prisma } from '@prisma/client'
import { visibleDocumentIds, visibleProjectIdsForUser } from '../../projects/visibility.js'
import { actorCanEditDocumentContent, DOCUMENT_EDIT_FORBIDDEN } from '../document-raci/access.js'
import { compareSections } from '../../clinical-writing/documents/service.js'
import { htmlToPlainText } from './plain-text.js'
import { PROJECT_CLOSED, projectIsClosed } from '../../projects/closed.js'
import { extractTextFromBlob } from '../../clinical-writing/documents/extract-text.js'
import { fileExtension } from '../uploads/source-files.js'
import { generateBlobKey } from '../blob/local-storage.js'
import { libraryItemPdf, PDF_MAX_CHARS } from './pdf-file.js'
import {
  BEST_PRACTICE_NAME, firstVersionKey, parseTags, sourceDocumentId, sourceDocumentInfo, parseVersionLabel, sectionToBestPractice, sectionToItem, versionLabel,
  type LibraryContext, type SectionRow,
} from './shape.js'

const createSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  taTag: z.string().min(1),
  framework: z.string().min(1),
  category: z.enum(['claim', 'safety', 'boilerplate', 'best_practice']),
  tags: z.array(z.string()).default([]),
  tenantId: z.string().optional(),
})

const updateSchema = createSchema.partial().omit({ tenantId: true })

const listQuery = z.object({
  taTag: z.string().optional(),
  framework: z.string().optional(),
  category: z.enum(['claim', 'safety', 'boilerplate', 'best_practice']).optional(),
  tenantId: z.string().optional(),
  includeRetired: z.coerce.boolean().default(false),
  search: z.string().optional(),
})

// FR-A-080 / AC-A-054: the four mandatory tags are therapeutic area, module,
// document type and version. None may be omitted.
const pushSchema = z.object({
  documentId: z.string().min(1),
  taTag:      z.string().trim().min(1),
  module:     z.enum(['A', 'B', 'C', 'D', 'E']),
  docType:    z.string().trim().min(1).max(80),
  version:    z.string().trim().min(1).max(20),
})

// A document uploaded from the PM's computer: PDF or Word, with the same tags a pushed document carries.
const UPLOAD_EXTENSIONS: Record<string, RegExp> = {
  pdf:  /^application\/pdf$/,
  docx: /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/,
}
const GENERIC_MIME = /^(application\/octet-stream|binary\/octet-stream)?$/    // Windows often sends no type for Office files
const uploadFields = z.object({
  title:     z.string().trim().min(1).max(200),
  docType:   z.string().trim().min(1).max(80),
  taTag:     z.string().trim().min(1),
  projectId: z.string().trim().min(1),
})

const retireSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() }).default({})

const adoptSchema = z.object({
  adoptingModule: z.enum(['A', 'B', 'C', 'D', 'E']),
  adoptingEntity: z.string().min(1),
})

// ---- UI-facing reads (Master Library + Best Practices screens) --------------
// Lists travel as comma-separated text. A value that itself contains a comma (or a percent sign) is sent
// percent-encoded by the web app ("," as %2C, "%" as %25), so it survives the split; plain values pass through as before.
const csvValue = (x: string) => { try { return decodeURIComponent(x) } catch { return x } }
const csv = z.string().optional().transform(v => (v ? v.split(',').map(x => csvValue(x.trim())).filter(Boolean) : []))
// A real calendar day: '2026-13-01' or '2026-02-30' matches the pattern but used to reach the
// database and come back as a 500 (CW-060), so it is a 400 here.
const isoDay = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine(s => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'not a real calendar date')

// A "pushed between" bound: a calendar day (the whole day, UTC) or an exact moment (ISO 8601 with
// Z or an offset, e.g. from the date-and-time picker).
const isoDayOrInstant = z.union([isoDay, z.string().datetime({ offset: true })])
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/
const rangeEdge = (v: string, edge: 'start' | 'end') =>
  new Date(DAY_ONLY.test(v) ? `${v}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z` : v)

const SORTS = ['recent', 'oldest', 'name-asc', 'name-desc'] as const
const LIST_MAX = 200
const LIST_COLUMNS = {
  id: true, tenantId: true, title: true, taTag: true, framework: true, category: true, version: true, isCurrent: true,
  usageCount: true, approvedBy: true, approvedAt: true, supersededBy: true, retiredAt: true, tags: true, createdAt: true, updatedAt: true,
} as const

const uiListQuery = z.object({
  q:          z.string().trim().max(200).optional(),
  module:     csv,                                   // A,B,… (platform-wide = "platform")
  itemType:   csv,                                   // document | section | best-practice
  docType:    csv,
  ta:         csv,
  projectId:  z.string().optional(),
  version:    z.string().optional(),                 // "v2.0" / "2"
  from:       isoDayOrInstant.optional(),            // pushed on/after
  to:         isoDayOrInstant.optional(),            // pushed on/before
  sort:       z.enum(SORTS).default('recent'),
  limit:      z.coerce.number().int().min(1).max(LIST_MAX).default(LIST_MAX),
  cursor:     z.string().regex(/^\d{1,7}$/).optional(),   // row offset
  includeRetired: z.enum(['true', 'false']).default('false'),
})

const bestPracticeQuery = z.object({
  module:   z.string().optional(),
  category: z.string().optional(),
})

const bestPracticeCreate = z.object({
  name:               z.string().regex(BEST_PRACTICE_NAME, 'Name must follow [Module]-[Category]-[Version]-[Date], e.g. Module-D-CTD-Authoring-v1.2-2026-01'),
  module:             z.enum(['A', 'B', 'C', 'D', 'E', 'platform']),
  category:           z.string().trim().min(1).max(80),
  guidance:           z.string().trim().min(1),
  effectiveFrom:      isoDay,
  validUntil:         isoDay,
  applicableDocTypes: z.array(z.string().trim().min(1)).default([]),
  frameworkRefs:      z.array(z.string().trim().min(1)).default([]),
  therapeuticArea:    z.string().optional(),         // omitted → platform-wide
}).refine(b => b.validUntil >= b.effectiveFrom, { message: 'validUntil must not be before effectiveFrom', path: ['validUntil'] })

const PLATFORM_WIDE_TA = 'Platform-wide'

// Thrown inside the push transaction when the same document version turns out to be in the library already.
class AlreadyPushedError extends Error {}

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  // Rows with tenantId=null are platform-wide; a tenant row is only visible to
  // its own tenant. Platform admins (role='admin' + tenantId=null, post
  // 2026-10-27 role consolidation) see every tenant.
  const visibleTo = (user: { role: string; tenantId: string | null }): Prisma.LibrarySectionWhereInput =>
    user.tenantId == null
      ? {}
      : { OR: [{ tenantId: null }, { tenantId: user.tenantId }] }

  const isPlatformAdmin = (user: { tenantId: string | null }) => user.tenantId == null

  // Change rights on a visible row: a platform admin may change any row, a tenant
  // admin only their own tenant's. Platform-wide rows (tenantId null, e.g. best
  // practices) are platform-admin only.
  const canChange = (user: { tenantId: string | null }, row: { tenantId: string | null }) =>
    isPlatformAdmin(user) || (row.tenantId != null && row.tenantId === user.tenantId)

  const NOT_YOURS = { error: 'forbidden', message: 'Platform-wide library items can only be changed by a platform admin.' } as const

  // One batched lookup for the names/projects a page of rows refers to.
  async function fetchContext(rows: SectionRow[], user: AuthenticatedUser): Promise<LibraryContext> {
    const projectIds = [...new Set(rows.flatMap(r => r.tags.filter(t => t.startsWith('project:')).map(t => t.slice(8))))]
    const documentIds = [...new Set(rows.flatMap(r => r.tags.filter(t => t.startsWith('source:')).map(t => sourceDocumentId(t.slice(7)))))]
    const titles = [...new Set(rows.filter(r => r.category !== 'best_practice').map(r => r.title))]
    const rowTenants = [...new Set(rows.map(r => r.tenantId))]
    const tenantScope: Prisma.LibrarySectionWhereInput = {
      OR: [
        ...(rowTenants.includes(null) ? [{ tenantId: null }] : []),
        ...(rowTenants.some(t => t != null) ? [{ tenantId: { in: rowTenants.filter((t): t is string => t != null) } }] : []),
      ],
    }
    const [projects, documents, versions] = await Promise.all([
      projectIds.length ? app.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true, status: true } }) : [],
      documentIds.length ? app.prisma.document.findMany({ where: { id: { in: documentIds } }, select: { id: true, title: true, createdBy: true, createdAt: true, currentVersionId: true } }) : [],
      titles.length ? app.prisma.librarySection.findMany({ where: { title: { in: titles }, AND: [tenantScope] }, select: { title: true, tenantId: true, version: true, createdAt: true, approvedBy: true } }) : [],
    ])
    const firstVersions = new Map<string, { createdAt: Date; by: string; version: number }>()
    for (const v of versions) {
      const key = firstVersionKey(v)
      const seen = firstVersions.get(key)
      if (!seen || v.version < seen.version) firstVersions.set(key, { createdAt: v.createdAt, by: v.approvedBy, version: v.version })
    }

    // The source documents' people: role holders, who edited the current text, and the
    // signatures of the completed chain. Ids from other modules match no Document row and
    // simply get no entry.
    const docIds = documents.map(d => d.id)
    // Role holders and editors are shown only to people on the document's project (and admin / auditor);
    // signatures are part of the signed record and are shown to everyone who can see the library entry.
    const teamVisible = await visibleDocumentIds(app.prisma, user, docIds)
    const teamDocIds = docIds.filter(id => teamVisible.has(id))
    const versionIds = documents.filter(d => teamVisible.has(d.id)).map(d => d.currentVersionId).filter((v): v is string => !!v)
    const [raciRows, sectionRows, chains] = await Promise.all([
      teamDocIds.length ? app.prisma.documentRaci.findMany({ where: { documentId: { in: teamDocIds } }, select: { documentId: true, userId: true, letter: true, removedAt: true } }) : [],
      versionIds.length ? app.prisma.sectionContent.findMany({ where: { documentVersionId: { in: versionIds } }, select: { documentVersionId: true, lastEditedBy: true, lastEditedAt: true, humanSpanCount: true } }) : [],
      docIds.length ? app.prisma.signatureChain.findMany({
        where: { documentId: { in: docIds }, status: 'complete' },
        orderBy: { completedAt: 'desc' },
        select: { documentId: true, records: { where: { status: 'signed' }, select: { signerId: true, signerName: true, meaning: true, step: true, timestampUtc: true, versionAtSigning: true } } },
      }) : [],
    ])
    const latestChain = new Map<string, (typeof chains)[number]>()
    for (const c of chains) if (!latestChain.has(c.documentId)) latestChain.set(c.documentId, c)   // newest first

    const userIds = [...new Set([
      ...rows.map(r => r.approvedBy), ...[...firstVersions.values()].map(f => f.by),
      ...documents.map(d => d.createdBy), ...raciRows.map(r => r.userId),
      ...sectionRows.flatMap(s => (s.lastEditedBy ? [s.lastEditedBy] : [])),
      ...chains.flatMap(c => c.records.map(r => r.signerId)),
    ])]
    const users = userIds.length ? await app.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []
    const userNames = new Map(users.map(u => [u.id, u.name]))

    const sourceDocuments = new Map(documents.map(d => [d.id, sourceDocumentInfo({
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      sections: sectionRows.filter(s => s.documentVersionId === d.currentVersionId),
      raci: raciRows.filter(r => r.documentId === d.id),
      signatures: latestChain.get(d.id)?.records ?? [],
      userNames,
      showTeam: teamVisible.has(d.id),
    })]))

    return {
      userNames,
      projects: new Map(projects.map(p => [p.id, { name: p.name, status: p.status }])),
      documents: new Map(documents.map(d => [d.id, d.title])),
      firstVersions,
      sourceDocuments,
    }
  }

  // The WHERE for the Master Library list — shared by the list itself and the cheap count the tab bar uses, so
  // the two can never disagree about what "the library" contains.
  function buildListWhere(q: z.infer<typeof uiListQuery>, user: { role: string; tenantId: string | null }): { where: Prisma.LibrarySectionWhereInput } | { error: string } {
    const and: Prisma.LibrarySectionWhereInput[] = [visibleTo(user)]
    // The text of a whole document is searched too, but only from 3 characters: a one- or two-letter term matches
    // almost everything, can't use the trigram index, and would scan every document's full text for nothing.
    if (q.q) and.push({ OR: [
      { title: { contains: q.q, mode: 'insensitive' } },
      ...(q.q.length >= 3 ? [{ body: { contains: q.q, mode: 'insensitive' as const } }] : []),
      { tags:  { has: q.q } },
    ] })
    if (q.module.length) and.push({ OR: q.module.map(m => m === 'platform'
      ? { NOT: { tags: { hasSome: ['A', 'B', 'C', 'D', 'E'].map(x => `module:${x}`) } } }
      : { tags: { has: `module:${m.toUpperCase()}` } }) })
    if (q.docType.length) and.push({ tags: { hasSome: q.docType.map(d => `doctype:${d}`) } })
    if (q.ta.length) and.push({ taTag: { in: q.ta } })
    if (q.projectId) and.push({ tags: { has: `project:${q.projectId}` } })
    if (q.itemType.length) and.push({ OR: q.itemType.flatMap((t): Prisma.LibrarySectionWhereInput[] =>
      t === 'best-practice' ? [{ category: 'best_practice' }]
      : t === 'document'    ? [{ category: { not: 'best_practice' }, tags: { has: 'type:document' } }]
      : t === 'section'     ? [{ category: { not: 'best_practice' }, NOT: { tags: { has: 'type:document' } } }]
      : []) })
    if (q.version) {
      const n = parseVersionLabel(q.version)
      if (n === null) return { error: 'version must look like "v2.0"' }
      and.push({ version: n })
    }
    if (q.from || q.to) and.push({ approvedAt: {
      ...(q.from && { gte: rangeEdge(q.from, 'start') }),
      ...(q.to   && { lte: rangeEdge(q.to, 'end') }),
    } })
    // A withdrawn item is no longer "current", so showing withdrawn items means
    // current rows plus retired ones (CW-062).
    return { where: {
      ...(q.includeRetired === 'false'
        ? { isCurrent: true, retiredAt: null }
        : { OR: [{ isCurrent: true }, { retiredAt: { not: null } }] }),
      AND: and,
    } }
  }

  // GET /library/count — how many items the same filters match, and nothing else. The tab bar needs only this number;
  // it used to ask for a one-row list, which also looked up names, projects and signatures for that row.
  app.get('/count', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = uiListQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const built = buildListWhere(parsed.data, request.user!)
    if ('error' in built) return reply.code(400).send({ error: 'validation', message: built.error })
    return { total: await app.prisma.librarySection.count({ where: built.where }) }
  })

  // GET /library — the Master Library screen. Filters, search, sort and
  // paging all run in the database; the page size and total travel in headers
  // so the body stays a plain array.
  app.get('/', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = uiListQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const q = parsed.data

    const built = buildListWhere(q, request.user!)
    if ('error' in built) return reply.code(400).send({ error: 'validation', message: built.error })
    const { where } = built

    const orderBy: Prisma.LibrarySectionOrderByWithRelationInput[] =
      q.sort === 'oldest'    ? [{ approvedAt: 'asc' },  { id: 'asc' }]
      : q.sort === 'name-asc'  ? [{ title: 'asc' },       { id: 'asc' }]
      : q.sort === 'name-desc' ? [{ title: 'desc' },      { id: 'asc' }]
      : [{ approvedAt: 'desc' }, { id: 'asc' }]

    const skip = Number(q.cursor ?? 0)
    const [total, rows] = await Promise.all([
      app.prisma.librarySection.count({ where }),
      // Everything but `body`: the list never shows the text, so the database doesn't read it or send it to the API.
      app.prisma.librarySection.findMany({ where, orderBy, skip, take: q.limit, select: LIST_COLUMNS }),
    ])
    const ctx = await fetchContext(rows as unknown as SectionRow[], request.user!)

    reply.header('X-Total-Count', String(total))
    reply.header('X-Next-Cursor', skip + rows.length < total ? String(skip + rows.length) : '')
    // A document's text can be hundreds of KB; sending it with every row made a page of 50 weigh megabytes. The list
    // leaves it out (the screen needs only the summary columns); GET /library/:id returns the full item with its text.
    return rows.map(r => ({ ...sectionToItem({ ...r, body: '' } as unknown as SectionRow, ctx), body: undefined }))
  })

  // GET /library/best-practices (registered before /:id so it isn't read as an id)
  // The projects that have documents in the library the caller can see — what the Master
  // Library's Projects filter offers (the list shows whole documents only). It follows the library's own visibility (tenant),
  // not the caller's project membership, so every role sees the same list as the table.
  app.get('/projects', { preHandler: requireAuth() }, async (request) => {
    const rows = await app.prisma.librarySection.findMany({
      where: { AND: [visibleTo(request.user!), { category: { not: 'best_practice' }, tags: { has: 'type:document' } }] },
      select: { tags: true },
    })
    const ids = [...new Set(rows.flatMap(r => r.tags.filter(t => t.startsWith('project:')).map(t => t.slice(8))))]
    if (ids.length === 0) return []
    const projects = await app.prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    return projects.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))
  })

  // The writing modules this caller's tenant has switched on: the tenant's own toggles intersected with
  // the deployment kill-switch (FEATURE_MODULES_ENABLED). A platform user with no tenant gets every module
  // the deployment has on. The Best Practices filter offers only these.
  app.get('/enabled-modules', { preHandler: requireAuth() }, async (request) => {
    const user = request.user!
    const deployment = enabledModules()
    const tenant = user.tenantId
      ? await app.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { modulesEnabled: true } })
      : null
    const modules = (['A', 'B', 'C', 'D', 'E'] as const)
      .filter(k => deployment.has(k) && (!tenant || tenant.modulesEnabled.includes(k)))
    return { modules }
  })

  app.get('/best-practices', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = bestPracticeQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { module, category } = parsed.data
    const rows = await app.prisma.librarySection.findMany({
      where: {
        category: 'best_practice', isCurrent: true, retiredAt: null,
        AND: [
          visibleTo(request.user!),
          ...(module ? [module === 'platform'
            ? { NOT: { tags: { hasSome: ['A', 'B', 'C', 'D', 'E'].map(x => `module:${x}`) } } }
            : { tags: { has: `module:${module.toUpperCase()}` } }] : []),
          ...(category ? [{ tags: { has: `category:${category}` } }] : []),
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    })
    return rows.map(r => sectionToBestPractice(r))
  })

  // POST /library/best-practices — Platform admin only (PRD sPM09). Post
  // 2026-10-27 role consolidation: platform admin = role='admin' with
  // tenantId=null. Tenant-scoped admins are blocked here because best
  // practices are platform-wide artefacts, not tenant-specific content.
  app.post('/best-practices', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    if ((request.user!.tenantId ?? null) != null) {
      return reply.code(403).send({ error: 'forbidden', message: 'Platform admin only.' })
    }
    const parsed = bestPracticeCreate.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })
    const b = parsed.data
    if (isPastDay(b.effectiveFrom) || isPastDay(b.validUntil)) return reply.code(422).send(DATE_IN_PAST)

    const dup = await app.prisma.librarySection.findFirst({
      where: { title: b.name, category: 'best_practice', isCurrent: true },
      select: { id: true },
    })
    if (dup) return reply.code(409).send({ error: 'duplicate_name', message: `A best practice named "${b.name}" already exists` })

    // Platform-wide items carry no therapeutic area; anything else must be an active TA.
    let taTag = PLATFORM_WIDE_TA
    if (b.therapeuticArea) {
      const resolved = await resolveTa(app.prisma, b.therapeuticArea)
      if (!resolved) return reply.code(400).send(invalidTaBody(b.therapeuticArea))
      taTag = resolved
    }

    const major = Number(/-v(\d+)/.exec(b.name)?.[1] ?? 1)
    const tags = [
      ...(b.module === 'platform' ? [] : [`module:${b.module}`]),
      `category:${b.category}`,
      `effective:${b.effectiveFrom}`,
      `valid-until:${b.validUntil}`,
      ...b.applicableDocTypes.map(d => `doctype:${d}`),
    ]
    const created = await app.prisma.librarySection.create({
      data: {
        tenantId: null,                       // best practices are platform-wide
        title: b.name,
        body: b.guidance,
        taTag,
        framework: b.frameworkRefs.join(', ') || 'Custom',
        category: 'best_practice',
        version: Math.max(1, major),
        tags,
        approvedBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'best_practice_created',
      entityType: 'library_section',
      entityId: created.id,
      details: { name: b.name, module: b.module, category: b.category },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(sectionToBestPractice(created))
  })

  // POST /library/push — FR-A-080 / AC-A-054. The Author (R) of a SIGNED (final)
  // document pushes the WHOLE document into the library with the four mandatory tags
  // (therapeutic area, module, document type, version). Pushing a single section is not
  // supported (400); section entries from earlier pushes stay readable.
  // Approval is the document's own e-signature chain: nothing that is not signed can
  // enter the library, and the push does not bypass it. Admins, PMs and every other
  // letter only read (action table row 6 — the same gate as editing content).
  // Pushing a later version of the same source supersedes the earlier library entry.
  app.post('/push', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    // The schema drops unknown keys, so a section scope has to be caught before it: a request that
    // names a section must fail loudly, not quietly turn into a whole-document push.
    const raw = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>
    if (raw.sectionId != null || (raw.scope != null && raw.scope !== 'document')) {
      return reply.code(400).send({ error: 'section_push_not_supported', message: 'Only a whole document can be pushed to the Master Library. Pushing a single section is not supported.' })
    }
    const parsed = pushSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })
    const b = parsed.data
    const user = request.user!

    const doc = await app.prisma.document.findFirst({
      where: { id: b.documentId, deletedAt: null },
      include: { currentVersion: { include: { sections: true } } },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const visibleProjects = await visibleProjectIdsForUser(app.prisma, user)
    if (visibleProjects !== 'all' && !visibleProjects.has(doc.projectId)) return reply.code(404).send({ error: 'not_found' })

    if (!(await actorCanEditDocumentContent(app.prisma, user, doc.id))) {
      return reply.code(403).send({ ...DOCUMENT_EDIT_FORBIDDEN, error: 'push_forbidden', message: 'Only the Author (R) of this document can push it to the Master Library.' })
    }
    // "Final" means signed: completing the e-signature chain is what makes a document
    // final (it sets status=signed and unlocks Final Document). It does not move the
    // stepper to Final Output, so the stage is not part of the test.
    if (doc.status !== 'signed') {
      return reply.code(409).send({ error: 'not_final', message: 'Only a signed (final) document can be pushed to the Master Library.' })
    }

    const taTag = await resolveTa(app.prisma, b.taTag)
    if (!taTag) return reply.code(400).send(invalidTaBody(b.taTag))
    if (taTag !== doc.therapeuticArea) {
      return reply.code(400).send({ error: 'ta_mismatch', message: `The therapeutic area must match the document's (${doc.therapeuticArea}).` })
    }

    const sections = [...(doc.currentVersion?.sections ?? [])].sort(compareSections)
    const docVersion = doc.currentVersion?.versionNumber ?? b.version
    const body = sections.filter(s => htmlToPlainText(s.contentHtml)).map(s => `${s.sectionNumber} ${s.sectionTitle}\n${htmlToPlainText(s.contentHtml)}`).join('\n\n')
    if (!body) return reply.code(422).send({ error: 'empty', message: 'This document has no content to push.' })

    const sourceTag = `source:${doc.id}`
    const project = await app.prisma.project.findUnique({ where: { id: doc.projectId }, select: { tenantId: true } })
    const tenantId = project?.tenantId ?? user.tenantId
    const tags = [
      `module:${b.module}`, `doctype:${b.docType}`, `project:${doc.projectId}`, sourceTag, `fromdoc:${doc.id}`, `docversion:${docVersion}`,
      'type:document',
    ]

    const alreadyPushed = () => reply.code(409).send({ error: 'already_pushed', message: `${docVersion} of this document is already in the Master Library.` })

    // Quick answer for the common case. This check alone is not enough: two pushes of the same document at the
    // same moment (a double click, two open tabs) can both pass it, so it is repeated under a lock below.
    const earlierQuick = await app.prisma.librarySection.findFirst({
      where: { tenantId, isCurrent: true, retiredAt: null, tags: { has: sourceTag } },
    })
    if (earlierQuick?.tags.includes(`docversion:${docVersion}`)) return alreadyPushed()

    let pushed: { created: SectionRow; earlier: SectionRow | null }
    try {
      pushed = await app.prisma.$transaction(async (tx) => {
        // One push per source document at a time: the lock is held until this transaction ends, so a second
        // push waits here and then sees the first one's entry. Needs no schema change.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`library-push:${tenantId ?? 'platform'}:${sourceTag}`}))`
        const earlier = await tx.librarySection.findFirst({
          where: { tenantId, isCurrent: true, retiredAt: null, tags: { has: sourceTag } },
        })
        if (earlier?.tags.includes(`docversion:${docVersion}`)) throw new AlreadyPushedError()
        const next = await tx.librarySection.create({
          data: {
            tenantId, taTag, tags, body,
            title: doc.title,
            framework: b.docType,
            category: 'claim',
            version: (earlier?.version ?? 0) + 1,
            approvedBy: user.id,
          },
        })
        if (earlier) {
          await tx.librarySection.update({ where: { id: earlier.id }, data: { isCurrent: false, supersededBy: next.id } })
        }
        return { created: next, earlier }
      })
    } catch (err) {
      if (err instanceof AlreadyPushedError) return alreadyPushed()
      throw err
    }
    const { created, earlier } = pushed
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: user.id,
      action: 'library_pushed',
      entityType: 'library_section',
      entityId: created.id,
      details: {
        documentId: doc.id, scope: 'document', documentVersion: docVersion,
        taTag, module: b.module, docType: b.docType, libraryVersion: created.version,
        ...(earlier && { supersedes: earlier.id }),
      },
      ipAddress: request.ip ?? null,
    })

    const ctx = await fetchContext([created], request.user!)
    return reply.code(201).send(sectionToItem(created, ctx))
  })

  // POST /library/upload — a Project Manager adds a document from their computer (PDF or Word) to the Master
  // Library, against one of their projects. Multipart: the fields (title, docType, taTag, projectId) first, then
  // the file. The text is read out of the file so the library can search it; the original PDF is kept and is what
  // "Download PDF" gives back. A later upload with the same title in the same project becomes the next version.
  // Only a PM may upload (the screen shows the button to no one else); nothing here is signed or approved by a chain.
  app.post('/upload', { preHandler: requireAuth({ roles: ['pm'], modules: ['A'] }) }, async (request, reply) => {
    const user = request.user!
    const file = await request.file().catch(() => undefined)
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'Choose a PDF or Word file to upload.' })
    const field = (name: string) => {
      const f = (file.fields as Record<string, { value?: unknown } | undefined>)[name]
      return typeof f?.value === 'string' ? f.value : undefined
    }
    const ext = fileExtension(file.filename)
    const typeOk = UPLOAD_EXTENSIONS[ext]?.test(file.mimetype) || (UPLOAD_EXTENSIONS[ext] && GENERIC_MIME.test(file.mimetype))
    if (!typeOk) return reply.code(400).send({ error: 'unsupported_file', message: 'Only PDF (.pdf) and Word (.docx) files can be uploaded.' })

    const parsed = uploadFields.safeParse({
      title: field('title') ?? file.filename.replace(/\.[^.]+$/, ''), docType: field('docType'), taTag: field('taTag'), projectId: field('projectId'),
    })
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request', issues: parsed.error.issues })
    const b = parsed.data

    const project = await app.prisma.project.findUnique({ where: { id: b.projectId }, select: { id: true, tenantId: true, name: true } })
    const visibleProjects = await visibleProjectIdsForUser(app.prisma, user)
    if (!project || (visibleProjects !== 'all' && !visibleProjects.has(project.id))) return reply.code(404).send({ error: 'project_not_found' })
    if (await projectIsClosed(app.prisma, project.id)) return reply.code(423).send(PROJECT_CLOSED)

    const taTag = await resolveTa(app.prisma, b.taTag)
    if (!taTag) return reply.code(400).send(invalidTaBody(b.taTag))

    const buf = await file.toBuffer()
    if (file.file.truncated) return reply.code(413).send({ error: 'too_large', message: 'The file is larger than 50 MB.' })
    const extracted = await extractTextFromBlob(buf, UPLOAD_EXTENSIONS[ext] === UPLOAD_EXTENSIONS.pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', { maxChars: PDF_MAX_CHARS })
    const body = extracted.text.trim()
    if (!extracted.ok || !body) {
      return reply.code(422).send({ error: 'no_text', message: 'No readable text was found in this file (a scanned PDF, for example). Upload a version with selectable text.' })
    }

    const tenantId = project.tenantId ?? user.tenantId
    const blobKey = generateBlobKey(`library/${tenantId ?? 'platform'}`, ext)
    await app.blob.put({ bucket: 'documents', key: blobKey, body: buf, contentType: file.mimetype || 'application/octet-stream', metadata: { originalFilename: file.filename, uploadedBy: user.id, projectId: project.id } })

    const tags = ['module:A', `doctype:${b.docType}`, `project:${project.id}`, 'type:document', 'origin:upload', `file:${blobKey}`, `filename:${file.filename}`]
    const { created, earlier } = await app.prisma.$transaction(async (tx) => {
      // One upload of a title per project at a time (a double click, two tabs): the second waits and sees the first.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`library-upload:${tenantId ?? 'platform'}:${project.id}:${b.title}`}))`
      const prior = await tx.librarySection.findFirst({
        where: { tenantId, isCurrent: true, retiredAt: null, title: b.title, AND: [{ tags: { has: 'origin:upload' } }, { tags: { has: `project:${project.id}` } }] },
      })
      const next = await tx.librarySection.create({
        data: { tenantId, taTag, tags, body, title: b.title, framework: b.docType, category: 'claim', version: (prior?.version ?? 0) + 1, approvedBy: user.id },
      })
      if (prior) await tx.librarySection.update({ where: { id: prior.id }, data: { isCurrent: false, supersededBy: next.id } })
      return { created: next, earlier: prior }
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: user.id,
      action: 'library_uploaded',
      entityType: 'library_section',
      entityId: created.id,
      details: { projectId: project.id, title: b.title, docType: b.docType, taTag, fileName: file.filename, fileSizeBytes: buf.length, libraryVersion: created.version, ...(earlier && { supersedes: earlier.id }) },
      ipAddress: request.ip ?? null,
    })
    const ctx = await fetchContext([created], user)
    return reply.code(201).send(sectionToItem(created, ctx))
  })

  // GET /library/by-document/:documentId — what of this document is already in the
  // library (the whole document and, from earlier pushes, single sections; current entries only). The Final
  // Document screen uses it to show "In Master Library" and to hide the push button.
  app.get('/by-document/:documentId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findFirst({ where: { id: documentId, deletedAt: null }, select: { projectId: true } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const visibleProjects = await visibleProjectIdsForUser(app.prisma, request.user!)
    if (visibleProjects !== 'all' && !visibleProjects.has(doc.projectId)) return reply.code(404).send({ error: 'not_found' })
    const rows = await app.prisma.librarySection.findMany({
      where: { isCurrent: true, retiredAt: null, tags: { has: `fromdoc:${documentId}` }, AND: [visibleTo(request.user!)] },
      orderBy: { approvedAt: 'desc' },
    })
    return rows.map(r => {
      const t = parseTags(r.tags)
      return { id: r.id, name: r.title, sectionId: t.sourceId?.split('#')[1] ?? null, documentVersion: t.docVersion, libraryVersion: versionLabel(r.version) }
    })
  })

  // GET /library/:id/pdf — the item's title and text as a PDF file (Master Library
  // "Download PDF"). Same visibility as reading the item.
  app.get('/:id/pdf', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await app.prisma.librarySection.findFirst({ where: { id, AND: [visibleTo(request.user!)] } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const pdf = await libraryItemPdf(app, row)
    if (!pdf.ok) return reply.code(pdf.code).send({ error: pdf.error, message: pdf.message })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${pdf.fileName}"; filename*=UTF-8''${encodeURIComponent(pdf.originalName)}`)
      .header('Content-Length', String(pdf.body.length))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store')
      .send(pdf.body)
  })

  // GET /library/:id — one item for the detail panel.
  app.get('/:id', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await app.prisma.librarySection.findFirst({ where: { id, AND: [visibleTo(request.user!)] } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return sectionToItem(row, await fetchContext([row], request.user!))
  })

  app.get('/sections', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    return app.prisma.librarySection.findMany({
      where: {
        isCurrent: true,
        AND: [visibleTo(request.user!)],
        ...(parsed.data.taTag && { taTag: parsed.data.taTag }),
        ...(parsed.data.framework && { framework: parsed.data.framework }),
        ...(parsed.data.category && { category: parsed.data.category }),
        ...(parsed.data.tenantId !== undefined && { tenantId: parsed.data.tenantId }),
        ...(!parsed.data.includeRetired && { retiredAt: null }),
        ...(parsed.data.search && {
          OR: [
            { title: { contains: parsed.data.search, mode: 'insensitive' } },
            { body: { contains: parsed.data.search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { usageCount: 'desc' },
    })
  })

  app.get('/sections/:id', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await app.prisma.librarySection.findFirst({ where: { id, AND: [visibleTo(request.user!)] } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  // Create a brand-new section (version 1). Admin-only.
  app.post('/sections', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    // Library entries carry a mandatory master-list TA (FR-A-080).
    const taTag = await resolveTa(app.prisma, parsed.data.taTag)
    if (!taTag) return reply.code(400).send(invalidTaBody(parsed.data.taTag))

    const created = await app.prisma.librarySection.create({
      data: {
        // A tenant admin can only add to their own tenant; a body tenantId is honoured
        // for platform admins only (CW-059).
        tenantId: isPlatformAdmin(request.user!) ? (parsed.data.tenantId ?? null) : request.user!.tenantId,
        title: parsed.data.title,
        body: parsed.data.body,
        taTag,
        framework: parsed.data.framework,
        category: parsed.data.category,
        tags: parsed.data.tags,
        approvedBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_section_created',
      entityType: 'library_section',
      entityId: created.id,
      details: { title: created.title, taTag: created.taTag, framework: created.framework, category: created.category },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // Create a new VERSION of an existing section. Admins and Project Managers — the Master Library has no admin in the
  // loop day to day, the PM is its content owner. A PM can change only their own tenant's items (canChange below);
  // platform-wide items stay with platform admins.
  app.post('/sections/:id/versions', { preHandler: requireAuth({ roles: ['admin', 'pm'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.librarySection.findFirst({ where: { id, AND: [visibleTo(request.user!)] } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (!canChange(request.user!, existing)) return reply.code(403).send(NOT_YOURS)
    if (!existing.isCurrent) {
      return reply.code(409).send({ error: 'not_current', message: 'Can only version the current section' })
    }

    // A new version may keep the section's TA; a different TA must be active.
    const taTag = parsed.data.taTag === undefined
      ? existing.taTag
      : await resolveTa(app.prisma, parsed.data.taTag, existing.taTag)
    if (!taTag) return reply.code(400).send(invalidTaBody(parsed.data.taTag!))

    const created = await app.prisma.$transaction(async (tx) => {
      await tx.librarySection.update({
        where: { id: existing.id },
        data: { isCurrent: false, supersededBy: null },               // supersededBy set after the new row has an id
      })
      const next = await tx.librarySection.create({
        data: {
          tenantId: existing.tenantId,
          title: parsed.data.title ?? existing.title,
          body: parsed.data.body ?? existing.body,
          taTag,
          framework: parsed.data.framework ?? existing.framework,
          category: (parsed.data.category ?? existing.category) as 'claim' | 'safety' | 'boilerplate' | 'best_practice',
          tags: parsed.data.tags ?? existing.tags,
          version: existing.version + 1,
          isCurrent: true,
          approvedBy: request.user!.id,
        },
      })
      await tx.librarySection.update({
        where: { id: existing.id },
        data: { supersededBy: next.id },
      })
      return next
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_section_versioned',
      entityType: 'library_section',
      entityId: created.id,
      details: { fromId: existing.id, fromVersion: existing.version, toVersion: created.version },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // Withdraw an item: same people and same own-tenant rule as a new version.
  app.post('/sections/:id/retire', { preHandler: requireAuth({ roles: ['admin', 'pm'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = retireSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const existing = await app.prisma.librarySection.findFirst({ where: { id, AND: [visibleTo(request.user!)] } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (!canChange(request.user!, existing)) return reply.code(403).send(NOT_YOURS)
    if (existing.retiredAt) return reply.code(409).send({ error: 'already_retired' })
    if (!existing.isCurrent) return reply.code(409).send({ error: 'not_current', message: 'Only the current version can be withdrawn' })

    const updated = await app.prisma.librarySection.update({
      where: { id },
      data: { retiredAt: new Date(), isCurrent: false },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_section_retired',
      entityType: 'library_section',
      entityId: id,
      details: { title: existing.title, version: existing.version, ...(parsed.data.reason && { reason: parsed.data.reason }) },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Record an adoption by a consuming module. Non-admin; any authenticated
  // user can adopt (modules call this on behalf of their users).
  app.post('/sections/:id/adopt', { preHandler: requireAuth({ clinicalWriting: true }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = adoptSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const section = await app.prisma.librarySection.findFirst({ where: { id, AND: [visibleTo(request.user!)] } })
    if (!section) return reply.code(404).send({ error: 'not_found' })
    // An adoption into a Clinical Writing document says "this text went into that document", so only someone who may
    // edit that document can record it (the same rule as the edit itself). Otherwise anyone could inflate usage counts.
    if (parsed.data.adoptingModule === 'A' && !(await actorCanEditDocumentContent(app.prisma, request.user!, parsed.data.adoptingEntity))) {
      return reply.code(403).send({ ...DOCUMENT_EDIT_FORBIDDEN, error: 'adopt_forbidden', message: 'Only the Author (R) of that document can record text adopted into it.' })
    }
    if (section.retiredAt) {
      return reply.code(422).send({ error: 'retired', message: 'Cannot adopt a retired section' })
    }
    if (!section.isCurrent) {
      return reply.code(422).send({
        error: 'superseded',
        message: `Section is superseded. Latest version is at /library/sections/${section.supersededBy}`,
      })
    }

    const record = await app.prisma.$transaction(async (tx) => {
      const r = await tx.libraryAdoptionRecord.create({
        data: {
          libraryId: section.id,
          adoptingModule: parsed.data.adoptingModule,
          adoptingEntity: parsed.data.adoptingEntity,
          adoptedBy: request.user!.id,
        },
      })
      await tx.librarySection.update({
        where: { id: section.id },
        data: { usageCount: { increment: 1 } },
      })
      return r
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_section_adopted',
      entityType: 'library_section',
      entityId: section.id,
      details: {
        adoptingModule: parsed.data.adoptingModule,
        adoptingEntity: parsed.data.adoptingEntity,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(record)
  })

  app.get('/sections/:id/adoptions', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const visible = await app.prisma.librarySection.findFirst({ where: { id, AND: [visibleTo(request.user!)] }, select: { id: true } })
    if (!visible) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.libraryAdoptionRecord.findMany({
      where: { libraryId: id },
      orderBy: { adoptedAt: 'desc' },
    })
  })
}
