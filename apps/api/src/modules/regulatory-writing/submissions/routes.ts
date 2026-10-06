// Regulatory submissions + eCTD granularity routes — Module D.
//
// Routes landed this batch (API contract §44-§45):
//   GET  /projects/:projectId/reg-submissions
//   POST /projects/:projectId/reg-submissions
//   GET  /reg-submissions/:submissionId
//   PATCH /reg-submissions/:submissionId
//   POST /reg-submissions/:submissionId/advance-stage
//   GET  /reg-submissions/:submissionId/ectd-nodes
//   PATCH /reg-submissions/:submissionId/ectd-nodes/:nodeId
//
// Business rules enforced here:
//   - Create seeds a minimal eCTD granularity set (Modules 1-5 placeholders)
//     with Module 5 marked isReadOnly=true per DD-D-001.
//   - advance-stage gates on business invariants:
//       3→4 : the latest ConsistencyCheckResult must have passed=true AND
//             the CmcReadinessReport must be acknowledged.
//       5→6 : the latest EctdValidationResult must have passed=true.
//   - PATCH on a Module 5 (or any isReadOnly) node → 422 regardless of role.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import {
  nextSubmissionStage,
  STAGE_LABELS,
  type SubmissionStage,
} from '../submission-stage.js'

const createSchema = z.object({
  submissionType: z.enum(['ind', 'nda_maa', 'psur_pbrer', 'rmp_rems', 'ha_response', 'cer', 'orphan_drug']),
  sourceModuleAProjectId: z.string().min(1),
  taTag: z.string().min(1),
  targetHas: z.array(z.string()).default([]),
  ectdVersion: z.string().default('3.2.2'),
  validatorEngine: z.enum(['extedo', 'lorenz']).default('extedo'),
  ownerId: z.string().optional(),
})

const patchSchema = z.object({
  taTag: z.string().min(1).optional(),
  targetHas: z.array(z.string()).optional(),
  validatorEngine: z.enum(['extedo', 'lorenz']).optional(),
  ownerId: z.string().optional(),
})

const patchNodeSchema = z.object({
  status: z.enum(['not_started', 'in_authoring', 'in_review', 'signed', 'auto_generated', 'read_only']).optional(),
  documentId: z.string().optional().nullable(),
  aiFootprintPct: z.number().int().min(0).max(100).optional(),
  sectionTitle: z.string().optional(),
})

// Default seed when creating a submission. Keeps the UI usable even before
// the real Module A linking lands.
const DEFAULT_ECTD_NODES: ReadonlyArray<{ section: string; title: string; readOnly?: boolean; system?: boolean }> = [
  { section: '1.1', title: 'Comprehensive Table of Contents', system: true },
  { section: '2.1', title: 'CTD Table of Contents', system: true },
  { section: '2.2', title: 'Introduction', system: true },
  { section: '2.3', title: 'Quality Overall Summary' },
  { section: '2.4', title: 'Nonclinical Overview' },
  { section: '2.5', title: 'Clinical Overview' },
  { section: '2.6', title: 'Nonclinical Written and Tabulated Summaries' },
  { section: '2.7', title: 'Clinical Summary' },
  { section: '3.2.S', title: 'Drug Substance' },
  { section: '3.2.P', title: 'Drug Product' },
  { section: '4.2.1', title: 'Pharmacology Studies', readOnly: true },     // Module 5-equivalent read-only
  { section: '5.3.5.1', title: 'Study Reports of Controlled Clinical Studies', readOnly: true }, // Module 5
  { section: '5.3.5.3', title: 'Reports of Analyses of Data from More Than One Study', readOnly: true }, // Module 5
]

// Shape reg-submission rows for the UI's packages/types RegulatorySubmission
// interface. Gaps caught during Phase 2 shape audit (Batch 40):
//   - Prisma `targetHas` → UI `targetHAs` (casing)
//   - Missing title/compound/indication: synthesized from the Module A source
//     project (title = `<srcProjectName> — <submissionType>`, compound +
//     indication fall through to srcProject.indication / srcProject.name)
//   - project? (UI display): resolved from the owning project's name
//   - Optional derived display fields (consistencyFlagged, cmcReadinessPct,
//     etc.) returned as undefined — UI null-checks; dedicated endpoints
//     compute them on demand (/consistency, /cmc-readiness, /canonical-json).
function submissionShape(
  s: { targetHas: string[]; submissionType: string; projectId: string; sourceModuleAProjectId: string } & Record<string, unknown>,
  srcProject: { name: string; indication: string | null } | null,
  owningProject: { name: string } | null,
) {
  const { targetHas, ...rest } = s
  const srcName = srcProject?.name ?? s.sourceModuleAProjectId
  return {
    ...rest,
    targetHAs: targetHas,
    title: `${srcName} — ${s.submissionType.toUpperCase().replace('_', '/')}`,
    compound: srcProject?.indication ?? '',
    indication: srcProject?.indication ?? '',
    project: owningProject?.name ?? s.projectId,
  }
}

async function fetchSrcProjects(prisma: import('@prisma/client').PrismaClient, srcIds: string[]) {
  if (srcIds.length === 0) return new Map<string, { name: string; indication: string | null }>()
  const rows = await prisma.project.findMany({
    where: { id: { in: Array.from(new Set(srcIds)) } },
    select: { id: true, name: true, indication: true },
  })
  return new Map(rows.map(r => [r.id, { name: r.name, indication: r.indication }]))
}

export const regSubmissionsProjectScopedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/reg-submissions', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })
    const rows = await app.prisma.regulatorySubmission.findMany({
      where: { projectId },
      orderBy: { updatedAt: 'desc' },
    })
    const srcMap = await fetchSrcProjects(app.prisma, rows.map(r => r.sourceModuleAProjectId))
    return rows.map(r => submissionShape(r, srcMap.get(r.sourceModuleAProjectId) ?? null, project))
  })

  app.post('/:projectId/reg-submissions', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const srcA = await app.prisma.project.findUnique({ where: { id: parsed.data.sourceModuleAProjectId } })
    if (!srcA) return reply.code(400).send({ error: 'validation', message: 'sourceModuleAProjectId not found' })

    const created = await app.prisma.$transaction(async (tx) => {
      const sub = await tx.regulatorySubmission.create({
        data: {
          projectId,
          sourceModuleAProjectId: parsed.data.sourceModuleAProjectId,
          submissionType: parsed.data.submissionType,
          taTag: parsed.data.taTag,
          targetHas: parsed.data.targetHas,
          ectdVersion: parsed.data.ectdVersion,
          validatorEngine: parsed.data.validatorEngine,
          ownerId: parsed.data.ownerId ?? request.user!.id,
        },
      })
      await tx.ectdGranularityNode.createMany({
        data: DEFAULT_ECTD_NODES.map(n => ({
          submissionId: sub.id,
          moduleSection: n.section,
          sectionTitle: n.title,
          isReadOnly: !!n.readOnly,
          isSystemGenerated: !!n.system,
          status: n.system ? 'auto_generated' : 'not_started',
        })),
      })
      return sub
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'reg_submission_created',
      entityType: 'reg_submission',
      entityId: created.id,
      details: {
        projectId,
        submissionType: created.submissionType,
        targetHas: created.targetHas,
        validatorEngine: created.validatorEngine,
      },
      ipAddress: request.ip ?? null,
    })

    const srcMap = await fetchSrcProjects(app.prisma, [created.sourceModuleAProjectId])
    return reply.code(201).send(submissionShape(created, srcMap.get(created.sourceModuleAProjectId) ?? null, project))
  })
}

export const regSubmissionsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:submissionId', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    const [srcMap, owning] = await Promise.all([
      fetchSrcProjects(app.prisma, [sub.sourceModuleAProjectId]),
      app.prisma.project.findUnique({ where: { id: sub.projectId }, select: { name: true } }),
    ])
    return submissionShape(sub, srcMap.get(sub.sourceModuleAProjectId) ?? null, owning)
  })

  app.patch('/:submissionId', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.regulatorySubmission.update({
      where: { id: submissionId },
      data: parsed.data,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'reg_submission_updated',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })
    return updated
  })

  app.post('/:submissionId/advance-stage', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const from = sub.stage as SubmissionStage
    const to = nextSubmissionStage(from)
    if (!to) {
      return reply.code(422).send({
        error: 'terminal',
        message: `Submission is at terminal stage ${from} (${STAGE_LABELS[from]})`,
      })
    }

    // Gate 3→4: latest consistency run passed AND CMC report acknowledged.
    if (from === 3) {
      const latestConsistency = await app.prisma.consistencyCheckResult.findFirst({
        where: { submissionId },
        orderBy: { runAt: 'desc' },
      })
      if (!latestConsistency || !latestConsistency.passed) {
        return reply.code(422).send({
          error: 'consistency_fail',
          message: 'Latest consistency check must pass (no unresolved major contradictions) before advancing from finalisation.',
        })
      }
      const cmc = await app.prisma.cmcReadinessReport.findUnique({ where: { submissionId } })
      if (!cmc || !cmc.acknowledgedBy) {
        return reply.code(422).send({
          error: 'cmc_not_ack',
          message: 'CMC readiness report must be generated and acknowledged before advancing from finalisation.',
        })
      }
    }

    // Gate 5→6: latest validation run passed (critical==0 && major==0).
    if (from === 5) {
      const latestVal = await app.prisma.ectdValidationResult.findFirst({
        where: { submissionId },
        orderBy: { runAt: 'desc' },
      })
      if (!latestVal || !latestVal.passed) {
        return reply.code(422).send({
          error: 'validation_fail',
          message: 'Latest eCTD validation must pass (no critical or major errors) before gateway transmission.',
        })
      }
    }

    const updated = await app.prisma.regulatorySubmission.update({
      where: { id: submissionId },
      data: {
        stage: to,
        status: STAGE_LABELS[to],
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'reg_submission_stage_advanced',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { from, to, fromLabel: STAGE_LABELS[from], toLabel: STAGE_LABELS[to] },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // --- eCTD granularity nodes ---------------------------------------------

  app.get('/:submissionId/ectd-nodes', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.ectdGranularityNode.findMany({
      where: { submissionId },
      orderBy: { moduleSection: 'asc' },
    })
  })

  app.patch('/:submissionId/ectd-nodes/:nodeId', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId, nodeId } = request.params as { submissionId: string; nodeId: string }
    const parsed = patchNodeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const node = await app.prisma.ectdGranularityNode.findFirst({
      where: { id: nodeId, submissionId },
    })
    if (!node) return reply.code(404).send({ error: 'not_found' })

    // DD-D-001: read-only nodes (Module 5 and system-generated) cannot be
    // mutated by any role. Admins who need to force a change should amend
    // the schema's isReadOnly, not shortcut the gate.
    if (node.isReadOnly) {
      return reply.code(422).send({
        error: 'node_read_only',
        message: `eCTD node ${node.moduleSection} is read-only (DD-D-001). Module 5 nodes are populated from Module A source documents and cannot be edited here.`,
      })
    }

    const updated = await app.prisma.ectdGranularityNode.update({
      where: { id: nodeId },
      data: parsed.data,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ectd_node_updated',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { nodeId, moduleSection: node.moduleSection, changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}
