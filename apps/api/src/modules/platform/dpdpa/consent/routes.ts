// ConsentRecord routes — Arc 7.2.
//
//   POST   /admin/dpdpa/consents                     create a consent (immutable)
//   GET    /admin/dpdpa/consents?subject=...         list consents for a subject
//   POST   /admin/dpdpa/consents/:id/revoke          revoke an active consent
//
// There is intentionally NO PATCH / DELETE route — ConsentRecord is
// immutable per DPDPA audit requirements. A new row supersedes an old
// one; revocation sets `revokedAt` + `revocationReason` but keeps the
// row for the audit trail.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../../auth/rbac.js'

const SUBJECT_TYPES = ['user', 'kol_contact', 'ma_contact', 'voice_note'] as const
const PURPOSES = [
  'service_delivery',
  'medical_review',
  'publication_authoring',
  'kol_engagement',
  'voice_transcription',
] as const
const CAPTURED_VIA = ['web_form', 'api', 'cm_relay'] as const
const REVOCATION_REASONS = ['expired', 'withdrawn', 'purpose_fulfilled'] as const

const createSchema = z.object({
  tenantId: z.string().min(1),
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().min(1),
  purpose: z.enum(PURPOSES),
  scope: z.array(z.string()).default([]),
  consentManagerReference: z.string().optional(),
  capturedVia: z.enum(CAPTURED_VIA),
})

const revokeSchema = z.object({
  reason: z.enum(REVOCATION_REASONS),
})

const listQuerySchema = z.object({
  tenantId: z.string().min(1),
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectId: z.string().optional(),
  purpose: z.enum(PURPOSES).optional(),
  activeOnly: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
})

export const consentRoutes: FastifyPluginAsync = async (app) => {
  const anyAdmin = requireAuth({ roles: ['super-admin', 'admin'] })

  app.post('/admin/dpdpa/consents', { preHandler: anyAdmin }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    // Supersede any prior active consent for the same (subject, purpose)
    // tuple. One active consent per tuple keeps the gate check O(1).
    const now = new Date()
    await app.prisma.consentRecord.updateMany({
      where: {
        tenantId: parsed.data.tenantId,
        subjectType: parsed.data.subjectType,
        subjectId: parsed.data.subjectId,
        purpose: parsed.data.purpose,
        revokedAt: null,
      },
      data: { revokedAt: now, revocationReason: 'purpose_fulfilled' },
    })

    const created = await app.prisma.consentRecord.create({
      data: {
        tenantId: parsed.data.tenantId,
        subjectType: parsed.data.subjectType,
        subjectId: parsed.data.subjectId,
        purpose: parsed.data.purpose,
        scope: parsed.data.scope,
        consentManagerReference: parsed.data.consentManagerReference ?? null,
        capturedVia: parsed.data.capturedVia,
      },
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: 'consent.capture',
      entityType: 'consent_record',
      entityId: created.id,
      details: {
        subjectType: parsed.data.subjectType,
        subjectId: parsed.data.subjectId,
        purpose: parsed.data.purpose,
        capturedVia: parsed.data.capturedVia,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.get('/admin/dpdpa/consents', { preHandler: anyAdmin }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const where: Record<string, unknown> = { tenantId: parsed.data.tenantId }
    if (parsed.data.subjectType) where.subjectType = parsed.data.subjectType
    if (parsed.data.subjectId)   where.subjectId   = parsed.data.subjectId
    if (parsed.data.purpose)     where.purpose     = parsed.data.purpose
    if (parsed.data.activeOnly)  where.revokedAt   = null

    const rows = await app.prisma.consentRecord.findMany({
      where,
      orderBy: { capturedAt: 'desc' },
      take: 500,
    })
    return rows
  })

  app.post('/admin/dpdpa/consents/:id/revoke', { preHandler: anyAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = revokeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.consentRecord.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.revokedAt) return reply.code(409).send({ error: 'already_revoked' })

    const updated = await app.prisma.consentRecord.update({
      where: { id },
      data: { revokedAt: new Date(), revocationReason: parsed.data.reason },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'consent.revoke',
      entityType: 'consent_record',
      entityId: id,
      details: {
        reason: parsed.data.reason,
        subjectType: existing.subjectType,
        subjectId: existing.subjectId,
        purpose: existing.purpose,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}
