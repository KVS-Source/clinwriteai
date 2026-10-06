// Module C content item routes.
//
// Endpoints landed this batch (API contract §30):
//   GET  /projects/:projectId/med-content
//   GET  /med-content/:contentId
//   POST /projects/:projectId/med-content
//   PATCH /med-content/:contentId
//   POST /med-content/:contentId/advance-stage
//   POST /med-content/:contentId/archive
//
// Business rules enforced here:
//   - compliance_track is locked from stage 2 onward (DD-C-001). PATCH 422s
//     if the client tries to change it after stage 2.
//   - ta_tag is mandatory and inherited at creation.
//   - Final output (stage 6, approved) items cannot be archived — 422.
//   - Advancing from stage 3→4 for patient-facing types requires fkPassed=true
//     (fk-score records populated by Batch 4).
//   - Advancing to stage 6 (approved) sets approved_at + expiry_date (+24m).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import {
  complianceTrackIsLocked,
  nextContentStage,
  STAGE_LABELS,
  type ContentStage,
} from '../content-stage.js'

const PATIENT_FACING_TYPES: ReadonlySet<string> = new Set([
  'pil', 'pls_eu_ctr', 'patient_education',
])

const createSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  sourceModuleAProjectId: z.string().min(1),
  sourceModuleBPubId: z.string().optional(),
  complianceTrack: z.enum(['promotional', 'non_promotional', 'cme', 'advisory']),
  taTag: z.string().min(1),
  channels: z.array(z.string()).default([]),
  targetAudience: z.array(z.string()).default([]),
  ownerId: z.string().optional(),            // defaults to creator
})

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  complianceTrack: z.enum(['promotional', 'non_promotional', 'cme', 'advisory']).optional(),
  taTag: z.string().min(1).optional(),
  channels: z.array(z.string()).optional(),
  targetAudience: z.array(z.string()).optional(),
  ownerId: z.string().optional(),
})

const archiveSchema = z.object({
  reason: z.string().min(3, 'An archive reason is required (audit trail)'),
})

const listQuerySchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  taTag: z.string().optional(),
})

// Shape med-content rows for the UI's packages/types `MedContentItem`
// interface. Two name mismatches between Prisma + UI need aliasing:
//   - Prisma `tierOverriddenBy`        → UI `reviewTierOverriddenBy`
//   - Prisma `sourceModuleBPubId`      → UI `sourceModuleBPublicationId`
// UI also expects aiFootprintPct as number-not-null; Prisma stores Int?,
// so we default to 0 when null (matches "no AI assist" semantics).
function medContentShape(m: { tierOverriddenBy: string | null; sourceModuleBPubId: string | null; aiFootprintPct: number | null } & Record<string, unknown>) {
  const { tierOverriddenBy, sourceModuleBPubId, aiFootprintPct, ...rest } = m
  return {
    ...rest,
    reviewTierOverriddenBy: tierOverriddenBy,
    sourceModuleBPublicationId: sourceModuleBPubId,
    aiFootprintPct: aiFootprintPct ?? 0,
  }
}

export const medContentProjectScopedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/med-content', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const rows = await app.prisma.medContentItem.findMany({
      where: {
        projectId,
        archivedAt: null,
        ...(parsed.data.status && { status: parsed.data.status }),
        ...(parsed.data.type && { type: parsed.data.type }),
        ...(parsed.data.taTag && { taTag: parsed.data.taTag }),
      },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map(medContentShape)
  })

  app.post('/:projectId/med-content', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    // Verify the Module A source project exists — this is a cross-module FK
    // check that Prisma can't do (no relation defined between MedContentItem
    // and Project.source).
    const srcA = await app.prisma.project.findUnique({ where: { id: parsed.data.sourceModuleAProjectId } })
    if (!srcA) return reply.code(400).send({ error: 'validation', message: 'sourceModuleAProjectId not found' })

    if (parsed.data.sourceModuleBPubId) {
      const srcB = await app.prisma.publication.findUnique({ where: { id: parsed.data.sourceModuleBPubId } })
      if (!srcB) return reply.code(400).send({ error: 'validation', message: 'sourceModuleBPubId not found' })
    }

    const created = await app.prisma.medContentItem.create({
      data: {
        projectId,
        sourceModuleAProjectId: parsed.data.sourceModuleAProjectId,
        sourceModuleBPubId: parsed.data.sourceModuleBPubId ?? null,
        type: parsed.data.type,
        title: parsed.data.title,
        complianceTrack: parsed.data.complianceTrack,
        taTag: parsed.data.taTag,
        channels: parsed.data.channels,
        targetAudience: parsed.data.targetAudience,
        ownerId: parsed.data.ownerId ?? request.user!.id,
        createdBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_created',
      entityType: 'med_content',
      entityId: created.id,
      details: {
        projectId,
        type: created.type,
        title: created.title,
        complianceTrack: created.complianceTrack,
        taTag: created.taTag,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(medContentShape(created))
  })
}

export const medContentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:contentId', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })
    return medContentShape(item)
  })

  app.patch('/:contentId', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!existing || existing.archivedAt) return reply.code(404).send({ error: 'not_found' })

    // DD-C-001: compliance_track is locked once stage 2+ is reached.
    if (
      parsed.data.complianceTrack !== undefined &&
      parsed.data.complianceTrack !== existing.complianceTrack &&
      complianceTrackIsLocked(existing.stage as ContentStage)
    ) {
      return reply.code(422).send({
        error: 'compliance_track_locked',
        message: `compliance_track cannot be changed after stage 2 (currently stage ${existing.stage}). DD-C-001.`,
      })
    }

    const updated = await app.prisma.medContentItem.update({
      where: { id: contentId },
      data: parsed.data,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_updated',
      entityType: 'med_content',
      entityId: contentId,
      details: { changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/:contentId/advance-stage', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })

    const from = item.stage as ContentStage
    const to = nextContentStage(from)
    if (!to) {
      return reply.code(422).send({
        error: 'terminal',
        message: `Content is at terminal stage ${from} (${STAGE_LABELS[from]})`,
      })
    }

    // Stage 3→4 gate for patient-facing types: must have the latest FK score
    // passing. fkScore records populate in Batch 4; items with no fk score
    // yet get a 422 pointing at the missing data.
    if (from === 3 && PATIENT_FACING_TYPES.has(item.type)) {
      if (item.fkPassed !== true) {
        return reply.code(422).send({
          error: 'fk_fail',
          message: `Patient-facing content (${item.type}) must have a passing FK score before advancing to MLR submission. Run POST /fk-score first.`,
        })
      }
    }

    const data: Record<string, unknown> = { stage: to }
    if (to === 6) {
      const now = new Date()
      const expiry = new Date(now)
      expiry.setMonth(expiry.getMonth() + 24)
      data.approvedAt = now
      data.expiryDate = expiry
      data.status = 'approved'
    }

    const updated = await app.prisma.medContentItem.update({
      where: { id: contentId },
      data,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_stage_advanced',
      entityType: 'med_content',
      entityId: contentId,
      details: { from, to, fromLabel: STAGE_LABELS[from], toLabel: STAGE_LABELS[to] },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/:contentId/archive', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = archiveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    // Final output items (stage 6) cannot be archived — they're the live
    // approved asset that MLR + legal are relying on.
    if (item.stage === 6 && !item.archivedAt) {
      return reply.code(422).send({
        error: 'final_output_locked',
        message: 'Approved (stage 6) items cannot be archived while still active',
      })
    }

    const updated = await app.prisma.medContentItem.update({
      where: { id: contentId },
      data: {
        archivedAt: new Date(),
        archiveReason: parsed.data.reason,
        status: 'archived',
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_archived',
      entityType: 'med_content',
      entityId: contentId,
      details: { reason: parsed.data.reason, finalStage: item.stage },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}
