// Contacts + calendar + publish records + DOI/Dublin Core — Module E.
//
// Deliberate scope boundaries:
//   - KolContact.reviewLinkToken is generated here but the public /kol-review/
//     endpoint that consumes it is NOT in this batch. That route has its own
//     threat model (public attack surface, JWT scoping, WAF rules); it ships
//     in a follow-up security-focused session.
//   - DOI minting is a stub — the real CrossRef call needs a registered
//     depositor account (shared blocker with Module B).
//   - Dublin Core metadata POST stores whatever the client provides. The
//     real auto-population from the card + atomised content lands with the
//     metadata extraction service.

import type { FastifyPluginAsync } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const CHANNEL_ENUM = z.enum([
  'linkedin', 'twitter', 'blog', 'email',
  'hcp', 'medical_affairs', 'instagram', 'facebook',
])

// --- Contacts ------------------------------------------------------------

const kolSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  mobileEncrypted: z.string().optional(),
})

const maSchema = z.object({
  role: z.enum(['lead', 'member']),
  name: z.string().min(1),
  email: z.string().email(),
  mobileEncrypted: z.string().optional(),
  notificationPreference: z.enum(['email', 'sms', 'email_sms']).default('email_sms'),
})

// --- Calendar ------------------------------------------------------------

const scheduleSchema = z.object({
  channel: CHANNEL_ENUM,
  scheduledDate: z.string().datetime(),
  assignedCreativeId: z.string().optional(),
})

const publishSchema = z.object({
  utmParams: z.string().optional(),
  seoMetadata: z.record(z.unknown()).optional(),
})

const doiSchema = z.object({
  doi: z.string().min(1),
  crossrefResponse: z.record(z.unknown()).optional(),
})

// Shape KolContact rows for the UI's packages/types KOLContact interface.
// Two gaps vs the current Prisma schema:
//   - title: UI expects the KOL's professional title ("Prof. of Oncology,
//     Mayo") for display. Not yet in the Prisma model — defaulted to ''
//     until the data model lands the column.
//   - reviewDecisions: UI expects a per-card decision list captured when
//     the KOL opens their review link. The decision table hasn't shipped
//     (lives in the public /kol-review/ scope — see security-focused
//     follow-up noted at the top of this file). Defaulted to [].
// Also: Date → ISO coercion for the timestamp fields.
function kolContactShape(k: {
  id: string
  ideationProjectId: string
  name: string
  email: string
  reviewLinkToken: string
  reviewLinkExpiry: Date
  signedOffAt: Date | null
  reminder1SentAt: Date | null
  reminder2SentAt: Date | null
  escalatedAt: Date | null
}) {
  return {
    id: k.id,
    ideationProjectId: k.ideationProjectId,
    name: k.name,
    title: '',
    email: k.email,
    reviewLinkToken: k.reviewLinkToken,
    reviewLinkExpiry: k.reviewLinkExpiry.toISOString(),
    signedOffAt: k.signedOffAt ? k.signedOffAt.toISOString() : null,
    reminder1SentAt: k.reminder1SentAt ? k.reminder1SentAt.toISOString() : null,
    reminder2SentAt: k.reminder2SentAt ? k.reminder2SentAt.toISOString() : null,
    escalatedAt: k.escalatedAt ? k.escalatedAt.toISOString() : null,
    reviewDecisions: [] as Array<{ cardId: string; decision: 'approved' | 'rejected' | 'pending'; comment: string | null }>,
  }
}

// MaContact has no UI counterpart in packages/types yet — the Prisma row
// serialises as-is. If/when the UI adds a MAContact type we can wrap this
// in a shape helper for consistency.

// Shape CalendarEntry rows for the UI's packages/types CalendarEntry
// interface. The UI pulls together card/artefact/user context + the
// optional PublishRecord relation into a single row:
//   - channelLabel: lookup via CHANNEL_LABELS (same table used in
//     atomised/routes.ts; duplicated locally to keep both self-contained)
//   - cardTitle + ideationProjectId: from card → artefact (artefact.title
//     + artefact.ideationProjectId)
//   - assignedCreativeName: User.name batched lookup
//   - utmParams / seoMetadata / sentimentScore / sentimentAlertSent: from
//     the publishRecord relation when present; defaults otherwise
//   - isOverdue + overdueHours: computed vs now when the entry hasn't
//     been published and the scheduledDate has passed
// Fields not currently persisted (overdueAlertSentAt, maAdvanceNotification*)
// are left undefined — the UI treats them as optional.

const CALENDAR_CHANNEL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  blog: 'Blog',
  email: 'Email',
  hcp: 'HCP',
  medical_affairs: 'Medical Affairs',
  instagram: 'Instagram',
  facebook: 'Facebook',
}

type CalendarEntryShapeInput = {
  id: string
  ideationContentCardId: string
  channel: string
  scheduledDate: Date
  assignedCreativeId: string | null
  status: string
  publishedAt: Date | null
  publishedBy: string | null
  publishRecord?: {
    utmParams: string | null
    seoMetadata: unknown
    sentimentScore: import('@prisma/client/runtime/library').Decimal | null
    sentimentAlertSent: boolean
  } | null
}

function calendarEntryShape(
  e: CalendarEntryShapeInput,
  context: {
    cardTitle: string
    ideationProjectId: string
    assignedCreativeName: string
  },
  now: Date = new Date(),
) {
  const isScheduledOverdue = e.status === 'scheduled' && e.scheduledDate < now
  const overdueHours = isScheduledOverdue
    ? Math.floor((now.getTime() - e.scheduledDate.getTime()) / (1000 * 60 * 60))
    : undefined
  const pr = e.publishRecord ?? null
  return {
    id: e.id,
    ideationContentCardId: e.ideationContentCardId,
    ideationProjectId: context.ideationProjectId,
    channel: e.channel,
    channelLabel: CALENDAR_CHANNEL_LABELS[e.channel] ?? e.channel,
    cardTitle: context.cardTitle,
    scheduledDate: e.scheduledDate.toISOString(),
    assignedCreativeId: e.assignedCreativeId ?? '',
    assignedCreativeName: context.assignedCreativeName,
    status: e.status as 'scheduled' | 'published' | 'overdue' | 'cancelled',
    publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
    publishedBy: e.publishedBy,
    utmParams: pr?.utmParams ?? null,
    seoMetadata: (pr?.seoMetadata as Record<string, unknown>) ?? {},
    sentimentScore: pr?.sentimentScore != null ? Number(pr.sentimentScore.toString()) : null,
    sentimentAlertSent: pr?.sentimentAlertSent ?? false,
    isOverdue: isScheduledOverdue,
    overdueHours,
  }
}

async function fetchCalendarContext(
  prisma: import('@prisma/client').PrismaClient,
  entries: ReadonlyArray<{ ideationContentCardId: string; assignedCreativeId: string | null }>,
): Promise<{
  cardCtx: Map<string, { cardTitle: string; ideationProjectId: string }>
  userCtx: Map<string, string>
}> {
  const cardIds = Array.from(new Set(entries.map(e => e.ideationContentCardId)))
  const userIds = Array.from(new Set(entries.map(e => e.assignedCreativeId).filter((x): x is string => !!x)))

  const [cards, users] = await Promise.all([
    cardIds.length > 0
      ? prisma.ideationContentCard.findMany({
        where: { id: { in: cardIds } },
        select: { id: true, sourceSection: true, artefact: { select: { title: true, ideationProjectId: true } } },
      })
      : Promise.resolve([]),
    userIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ])

  const cardCtx = new Map(cards.map(c => [c.id, {
    cardTitle: c.artefact?.title ? `${c.artefact.title} — ${c.sourceSection}` : c.sourceSection,
    ideationProjectId: c.artefact?.ideationProjectId ?? '',
  }]))
  const userCtx = new Map(users.map(u => [u.id, u.name]))
  return { cardCtx, userCtx }
}

const dublinCoreSchema = z.object({
  dcTitle: z.string().min(1),
  dcCreator: z.string().min(1),
  dcSubject: z.string().min(1),
  dcDescription: z.string().min(1),
  dcDate: z.string().datetime(),
  dcType: z.string().min(1),
  dcFormat: z.string().min(1),
  dcIdentifier: z.string().optional(),
  dcRights: z.string().min(1),
  dcLanguage: z.string().default('en'),
  dcSource: z.string().optional(),
  dcRelation: z.string().optional(),
  dcCoverage: z.string().optional(),
  dcPublisher: z.string().optional(),
  dcContributor: z.string().optional(),
})

export const publishingRoutes: FastifyPluginAsync = async (app) => {
  // --- KOL + MA contacts -------------------------------------------------

  app.post('/:ideationProjectId/kol-contacts', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const parsed = kolSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const ideation = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!ideation) return reply.code(404).send({ error: 'not_found' })

    // Review link: one-time token (opaque hex) with 7-day expiry. The public
    // /kol-review/ consumer validates both the token AND the expiry.
    const token = randomBytes(32).toString('hex')
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const created = await app.prisma.kolContact.create({
      data: {
        ideationProjectId,
        name: parsed.data.name,
        email: parsed.data.email,
        mobileEncrypted: parsed.data.mobileEncrypted ?? null,
        reviewLinkToken: token,
        reviewLinkExpiry: expiry,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'kol_contact_added',
      entityType: 'ideation_project',
      entityId: ideationProjectId,
      details: {
        contactId: created.id,
        email: created.email,
        reviewLinkExpiry: expiry.toISOString(),
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(kolContactShape(created))
  })

  app.get('/:ideationProjectId/kol-contacts', { preHandler: requireAuth({ modules: ['E'] }) }, async (request) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const rows = await app.prisma.kolContact.findMany({
      where: { ideationProjectId },
      orderBy: { name: 'asc' },
    })
    return rows.map(kolContactShape)
  })

  app.post('/:ideationProjectId/ma-contacts', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const parsed = maSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const ideation = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!ideation) return reply.code(404).send({ error: 'not_found' })

    const created = await app.prisma.maContact.create({
      data: {
        ideationProjectId,
        role: parsed.data.role,
        name: parsed.data.name,
        email: parsed.data.email,
        mobileEncrypted: parsed.data.mobileEncrypted ?? null,
        notificationPreference: parsed.data.notificationPreference,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ma_contact_added',
      entityType: 'ideation_project',
      entityId: ideationProjectId,
      details: { contactId: created.id, role: created.role, email: created.email },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.get('/:ideationProjectId/ma-contacts', { preHandler: requireAuth({ modules: ['E'] }) }, async (request) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    return app.prisma.maContact.findMany({
      where: { ideationProjectId },
      orderBy: { role: 'asc' },
    })
  })

  // --- Calendar + Publish ------------------------------------------------

  app.get('/cards/:cardId/calendar', { preHandler: requireAuth({ modules: ['E'] }) }, async (request) => {
    const { cardId } = request.params as { cardId: string }
    const rows = await app.prisma.calendarEntry.findMany({
      where: { ideationContentCardId: cardId },
      orderBy: { scheduledDate: 'asc' },
      include: { publishRecord: true },
    })
    const { cardCtx, userCtx } = await fetchCalendarContext(app.prisma, rows)
    return rows.map(r => calendarEntryShape(r, {
      cardTitle: cardCtx.get(r.ideationContentCardId)?.cardTitle ?? '',
      ideationProjectId: cardCtx.get(r.ideationContentCardId)?.ideationProjectId ?? '',
      assignedCreativeName: r.assignedCreativeId ? userCtx.get(r.assignedCreativeId) ?? '' : '',
    }))
  })

  app.post('/cards/:cardId/calendar', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const parsed = scheduleSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    // Business guard: only approved cards can be scheduled. Avoids rogue
    // posts of under-review or rejected content.
    if (card.overallStatus !== 'approved') {
      return reply.code(422).send({
        error: 'card_not_approved',
        message: `Only approved cards can be scheduled (current status: ${card.overallStatus})`,
      })
    }

    const created = await app.prisma.calendarEntry.create({
      data: {
        ideationContentCardId: cardId,
        channel: parsed.data.channel,
        scheduledDate: new Date(parsed.data.scheduledDate),
        assignedCreativeId: parsed.data.assignedCreativeId ?? null,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'calendar_entry_scheduled',
      entityType: 'ideation_card',
      entityId: cardId,
      details: {
        entryId: created.id,
        channel: created.channel,
        scheduledDate: created.scheduledDate.toISOString(),
      },
      ipAddress: request.ip ?? null,
    })

    const { cardCtx, userCtx } = await fetchCalendarContext(app.prisma, [created])
    return reply.code(201).send(calendarEntryShape({ ...created, publishRecord: null }, {
      cardTitle: cardCtx.get(cardId)?.cardTitle ?? '',
      ideationProjectId: cardCtx.get(cardId)?.ideationProjectId ?? '',
      assignedCreativeName: created.assignedCreativeId ? userCtx.get(created.assignedCreativeId) ?? '' : '',
    }))
  })

  app.post('/calendar/:entryId/publish', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string }
    const parsed = publishSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const entry = await app.prisma.calendarEntry.findUnique({
      where: { id: entryId },
      include: { publishRecord: true },
    })
    if (!entry) return reply.code(404).send({ error: 'not_found' })
    if (entry.publishRecord) return reply.code(409).send({ error: 'already_published' })
    if (entry.status === 'cancelled') {
      return reply.code(422).send({ error: 'cancelled', message: 'Cannot publish a cancelled calendar entry' })
    }

    const result = await app.prisma.$transaction(async (tx) => {
      const publishedAt = new Date()
      const record = await tx.publishRecord.create({
        data: {
          calendarEntryId: entryId,
          channel: entry.channel,
          publishedAt,
          publishedBy: request.user!.id,
          utmParams: parsed.data.utmParams ?? null,
          seoMetadata: (parsed.data.seoMetadata ?? {}) as unknown as object,
        },
      })
      await tx.calendarEntry.update({
        where: { id: entryId },
        data: { status: 'published', publishedAt, publishedBy: request.user!.id },
      })
      return record
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'calendar_entry_published',
      entityType: 'ideation_card',
      entityId: entry.ideationContentCardId,
      details: {
        entryId,
        channel: entry.channel,
        recordId: result.id,
      },
      ipAddress: request.ip ?? null,
    })

    // Return the updated calendar entry (shape) rather than the raw
    // publish record — the UI consumes CalendarEntry, which already
    // carries the publish-record fields denormed on it.
    const updatedEntry = await app.prisma.calendarEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { publishRecord: true },
    })
    const { cardCtx, userCtx } = await fetchCalendarContext(app.prisma, [updatedEntry])
    return calendarEntryShape(updatedEntry, {
      cardTitle: cardCtx.get(updatedEntry.ideationContentCardId)?.cardTitle ?? '',
      ideationProjectId: cardCtx.get(updatedEntry.ideationContentCardId)?.ideationProjectId ?? '',
      assignedCreativeName: updatedEntry.assignedCreativeId ? userCtx.get(updatedEntry.assignedCreativeId) ?? '' : '',
    })
  })

  app.post('/calendar/:entryId/cancel', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string }
    const entry = await app.prisma.calendarEntry.findUnique({ where: { id: entryId } })
    if (!entry) return reply.code(404).send({ error: 'not_found' })
    if (entry.status === 'published') {
      return reply.code(422).send({ error: 'already_published', message: 'Published entries cannot be cancelled; create a retraction record instead.' })
    }
    await app.prisma.calendarEntry.update({
      where: { id: entryId },
      data: { status: 'cancelled' },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'calendar_entry_cancelled',
      entityType: 'ideation_card',
      entityId: entry.ideationContentCardId,
      details: { entryId },
      ipAddress: request.ip ?? null,
    })

    const withRecord = await app.prisma.calendarEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { publishRecord: true },
    })
    const { cardCtx, userCtx } = await fetchCalendarContext(app.prisma, [withRecord])
    return calendarEntryShape(withRecord, {
      cardTitle: cardCtx.get(withRecord.ideationContentCardId)?.cardTitle ?? '',
      ideationProjectId: cardCtx.get(withRecord.ideationContentCardId)?.ideationProjectId ?? '',
      assignedCreativeName: withRecord.assignedCreativeId ? userCtx.get(withRecord.assignedCreativeId) ?? '' : '',
    })
  })

  // --- DOI + Dublin Core -------------------------------------------------

  app.post('/cards/:cardId/doi', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const parsed = doiSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    const existing = await app.prisma.doiRecord.findUnique({ where: { ideationContentCardId: cardId } })
    if (existing) return reply.code(409).send({ error: 'doi_already_registered', doi: existing.doi })

    const created = await app.prisma.doiRecord.create({
      data: {
        ideationContentCardId: cardId,
        doi: parsed.data.doi,
        crossrefResponse: (parsed.data.crossrefResponse ?? {}) as unknown as object,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'doi_registered',
      entityType: 'ideation_card',
      entityId: cardId,
      details: { doi: parsed.data.doi, stub: !parsed.data.crossrefResponse },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.get('/cards/:cardId/doi', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const row = await app.prisma.doiRecord.findUnique({ where: { ideationContentCardId: cardId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  app.put('/cards/:cardId/dublin-core', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const parsed = dublinCoreSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    // Upsert — PUT is replace-or-create semantics; the metadata is 1-to-1
    // with the card so there's only ever one row.
    const row = await app.prisma.dublinCoreMetadata.upsert({
      where: { ideationContentCardId: cardId },
      create: {
        ideationContentCardId: cardId,
        dcTitle: parsed.data.dcTitle,
        dcCreator: parsed.data.dcCreator,
        dcSubject: parsed.data.dcSubject,
        dcDescription: parsed.data.dcDescription,
        dcDate: new Date(parsed.data.dcDate),
        dcType: parsed.data.dcType,
        dcFormat: parsed.data.dcFormat,
        dcIdentifier: parsed.data.dcIdentifier ?? null,
        dcRights: parsed.data.dcRights,
        dcLanguage: parsed.data.dcLanguage,
        dcSource: parsed.data.dcSource ?? null,
        dcRelation: parsed.data.dcRelation ?? null,
        dcCoverage: parsed.data.dcCoverage ?? null,
        dcPublisher: parsed.data.dcPublisher ?? null,
        dcContributor: parsed.data.dcContributor ?? null,
      },
      update: {
        dcTitle: parsed.data.dcTitle,
        dcCreator: parsed.data.dcCreator,
        dcSubject: parsed.data.dcSubject,
        dcDescription: parsed.data.dcDescription,
        dcDate: new Date(parsed.data.dcDate),
        dcType: parsed.data.dcType,
        dcFormat: parsed.data.dcFormat,
        dcIdentifier: parsed.data.dcIdentifier ?? null,
        dcRights: parsed.data.dcRights,
        dcLanguage: parsed.data.dcLanguage,
        dcSource: parsed.data.dcSource ?? null,
        dcRelation: parsed.data.dcRelation ?? null,
        dcCoverage: parsed.data.dcCoverage ?? null,
        dcPublisher: parsed.data.dcPublisher ?? null,
        dcContributor: parsed.data.dcContributor ?? null,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'dublin_core_set',
      entityType: 'ideation_card',
      entityId: cardId,
      details: { metadataId: row.id, dcIdentifier: parsed.data.dcIdentifier ?? null },
      ipAddress: request.ip ?? null,
    })

    return row
  })

  app.get('/cards/:cardId/dublin-core', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const row = await app.prisma.dublinCoreMetadata.findUnique({ where: { ideationContentCardId: cardId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  // --- Dublin Core auto-populate ------------------------------------------
  // Builds a DC metadata record from the card + its artefact + the first
  // atomised channel content. Does NOT upsert; returns the proposed values
  // so the UI can let the user edit before PUT /dublin-core. Alternative
  // ?commit=true saves directly.

  app.post('/cards/:cardId/dublin-core/auto-populate', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const { commit } = request.query as { commit?: string }

    const card = await app.prisma.ideationContentCard.findUnique({
      where: { id: cardId },
      include: {
        artefact: { include: { ideationProject: true } },
        atomised: { orderBy: { createdAt: 'asc' }, take: 1 },
        doiRecord: true,
      },
    })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    // Derivation rules — all deterministic from existing data:
    //   dcTitle       — artefact.title + ' — ' + first atomised channel
    //   dcCreator     — ideationProject.createdBy (user id; the UI can
    //                    resolve to a display name)
    //   dcSubject     — ideationProject.taTag
    //   dcDescription — card.sourcePassage trimmed to 500 chars
    //   dcDate        — today (publication intent date)
    //   dcType        — 'Text' (fixed; adjust when card.channelFormats has
    //                    image/video intents)
    //   dcFormat      — first atomised channel if present, else 'text/html'
    //   dcIdentifier  — DOI if registered; otherwise the card.id as urn
    //   dcRights      — 'Copyright holder — all rights reserved; see licence terms'
    //   dcLanguage    — 'en'
    //   dcSource      — artefact.title ' v' + artefact.version
    const firstChannel = card.atomised[0]?.channel ?? null
    const draft = {
      ideationContentCardId: cardId,
      dcTitle: `${card.artefact.title}${firstChannel ? ` — ${firstChannel}` : ''}`,
      dcCreator: card.artefact.ideationProject.createdBy,
      dcSubject: card.artefact.ideationProject.taTag,
      dcDescription: card.sourcePassage.slice(0, 500),
      dcDate: new Date(),
      dcType: 'Text',
      dcFormat: firstChannel ? `text/${firstChannel}` : 'text/html',
      dcIdentifier: card.doiRecord?.doi ?? `urn:aurora:card:${card.id}`,
      dcRights: 'Copyright holder — all rights reserved; see licence terms',
      dcLanguage: 'en',
      dcSource: `${card.artefact.title} v${card.artefact.version}`,
      dcPublisher: card.artefact.ideationProject.taTag,
    }

    if (commit !== 'true') {
      return { draft, committed: false }
    }

    const row = await app.prisma.dublinCoreMetadata.upsert({
      where: { ideationContentCardId: cardId },
      create: draft,
      update: { ...draft, dcDate: draft.dcDate },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'dublin_core_auto_populated',
      entityType: 'ideation_card',
      entityId: cardId,
      details: { metadataId: row.id, dcIdentifier: draft.dcIdentifier },
      ipAddress: request.ip ?? null,
    })

    return { draft: row, committed: true }
  })

  // --- UTM parameter generator --------------------------------------------
  // Builds per-channel UTM params from card + channel + campaign tag.
  // Deterministic + urlencoded; callers typically pass to publishRecord.utmParams.

  app.post('/cards/:cardId/utm/generate', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const bodySchema = z.object({
      channel: CHANNEL_ENUM,
      campaign: z.string().min(1).max(64).optional(),
      content: z.string().min(1).max(64).optional(),
    })
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const card = await app.prisma.ideationContentCard.findUnique({
      where: { id: cardId },
      include: { artefact: { include: { ideationProject: true } } },
    })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    // UTM source = channel; medium = card.id short slice; campaign = TA tag
    // or user override; content = optional variant tag. See
    // https://support.google.com/analytics/answer/1033863 for the fields.
    const campaign = parsed.data.campaign ?? card.artefact.ideationProject.taTag
    const utmShortId = card.id.slice(0, 8)
    const params = new URLSearchParams({
      utm_source: parsed.data.channel,
      utm_medium: 'content_card',
      utm_campaign: campaign.toLowerCase().replace(/\s+/g, '_'),
      utm_term: utmShortId,
      ...(parsed.data.content ? { utm_content: parsed.data.content } : {}),
    })

    return {
      cardId,
      channel: parsed.data.channel,
      utmParams: params.toString(),
      components: {
        utm_source: parsed.data.channel,
        utm_medium: 'content_card',
        utm_campaign: campaign.toLowerCase().replace(/\s+/g, '_'),
        utm_term: utmShortId,
        utm_content: parsed.data.content ?? null,
      },
    }
  })
}
