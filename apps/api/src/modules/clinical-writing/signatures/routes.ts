// Part 11 e-signature chain — Module A terminal step.
//
// Source: 02-datamodel.md §9 (signature_chains + signature_records),
//         docs/compliance/Part11/compliance-assessment.md §11.70/§11.200.
//
// Compliance decisions baked in (defaults — revisit when Compliance signs off):
//   • §11.70 artefact format: canonical JSON (hashSections() of the
//     document's current version at signing time). Reproducible,
//     machine-verifiable. A rendered-PDF binding is additive, not a swap.
//   • §11.200 re-authentication at signing is NOT in place yet: login is SSO
//     and no step-up (IdP re-login / TOTP / passkey) is configured. Until it
//     is, the signer confirms by typing their full name, and each record says
//     exactly that in authMethod (SIGNING_AUTH_METHOD) — never a method that
//     wasn't used.
//   • Time source: the server clock (UTC) is authoritative; the signer's
//     local time is kept alongside for reference.
//   • The final signature makes the document v1.0 (AC-A-046): a "Final"
//     snapshot of the signed content becomes the current version.
//
// Document state machine driven here:
//   pending_signature  →  signed     (terminal sign of a sequential chain)
//   (any)              →  in_authoring   (chain cancelled)
//
// Routes (mixed shapes, registered at root like crm/tlf/peer-review):
//   POST  /documents/:documentId/signature-chains        — initiate
//   GET   /documents/:documentId/signature-chains        — list
//   GET   /signature-chains/:chainId                     — detail + records
//   POST  /signature-chains/:chainId/cancel              — cancel; doc → in_authoring
//   POST  /signature-records/:recordId/sign              — the Part 11 act

import type { FastifyPluginAsync } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { DocumentService, hashSections } from '../documents/service.js'
import type { PrismaClient } from '@prisma/client'
import { blockedBody, checkSignatureGate } from '../checklist/gates.js'
import { fireAutoComplete } from '../checklist/auto-complete.js'
import { actorCanEditDocumentRaci } from '../../platform/document-raci/access.js'

const initiateSchema = z.object({
  chainType: z.enum(['sequential', 'parallel']).default('sequential'),
  signers: z.array(z.object({
    signerId: z.string().min(1),
    signerName: z.string().min(1),
    signerRole: z.string().min(1),
    meaning: z.enum(['authored', 'reviewed', 'approved']),
    scopeSections: z.array(z.string()).default([]),
  })).min(1, 'At least one signer required'),
})

const signSchema = z.object({
  // Interim confirmation until re-authentication is configured: the signer
  // types their full name, which must match the signer on the record.
  confirmName: z.string().trim().min(1, 'Type your full name to confirm the signature'),
  // Signer-side context, kept for reference (the server UTC time is authoritative).
  localTime: z.string().min(1),                 // '16:32 CET'
  deviceInfo: z.string().optional(),
})

// What each signature records as its authentication method — exactly what happened.
export const SIGNING_AUTH_METHOD = 'SSO session + typed full-name confirmation (re-authentication not yet configured)'
export const SIGNING_TIME_SOURCE = 'Server clock (UTC)'

// "Dr  Sarah  Chen" vs "dr sarah chen": same name, ignoring case and spacing.
const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

const cancelSchema = z.object({
  cancelReason: z.string().min(1, 'cancel reason required for Part 11 audit'),
})

export const signatureRoutes: FastifyPluginAsync = async (app) => {
  // In-app notice to a signer that it's their turn (contract §9 "notifies next
  // signer"). Never blocks or fails the signature itself.
  const notifySigners = async (
    signers: Array<{ signerId: string; step: number }>,
    doc: { id: string; projectId: string; title: string },
  ) => {
    if (!app.hasDecorator('notifications')) return
    for (const s of signers) {
      try {
        await app.notifications.send({
          recipientId: s.signerId,
          kind:        'signature_requested',
          title:       `Your signature is needed on "${doc.title}"`,
          body:        `It's your turn to sign (step ${s.step}). Open the E-Signature tab to review and sign.`,
          linkPath:    `/projects/${doc.projectId}/clinical-writing/documents/${doc.id}/sign`,
          payload:     { documentId: doc.id, step: s.step },
        })
      } catch (err) {
        app.log.warn({ err, documentId: doc.id, signerId: s.signerId }, 'signature_requested notification failed')
      }
    }
  }

  // --- Chain initiation + listing ----------------------------------------

  app.post('/documents/:documentId/signature-chains', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = initiateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    if (doc.status !== 'pending_signature') {
      return reply.code(422).send({
        error: 'wrong_status',
        message: `Signature chain requires document in pending_signature (current: ${doc.status})`,
      })
    }
    // Refuse concurrent chains — one active chain per doc at a time.
    const activeChain = await app.prisma.signatureChain.findFirst({
      where: { documentId, status: { in: ['initiated', 'in_progress'] } },
    })
    if (activeChain) {
      return reply.code(409).send({ error: 'chain_already_active', chainId: activeChain.id })
    }

    // Gate A — the strongest gate. Every mandatory ChecklistInstanceItem
    // across every stage must be Complete or Waived before a Part 11
    // signature chain is allowed to open on this document.
    const gate = await checkSignatureGate(app.prisma, documentId)
    if (!gate.ok) {
      return reply.code(409).send(blockedBody('signature', gate))
    }

    // All team Approvers (RACI='A') must sign with meaning='approved'
    // before the Final Document unlocks. Enforced here so bypassing the
    // UI (direct POST) can't skip approvals. Writers can still be added
    // for meaning='authored' and reviewers for meaning='reviewed'; those
    // are additive, not substitutes.
    const approverTeam = await app.prisma.projectTeamMember.findMany({
      where: { projectId: doc.projectId, raci: 'A' },
      select: { userId: true, name: true },
    })
    if (approverTeam.length === 0) {
      return reply.code(422).send({
        error: 'no_approvers_configured',
        message: 'This project has no team members with RACI=\'A\'. Assign at least one Approver on the project team before starting the signature chain.',
      })
    }
    const approvedSignerIds = new Set(
      parsed.data.signers
        .filter(s => s.meaning === 'approved')
        .map(s => s.signerId),
    )
    const missingApprovers = approverTeam.filter(t => !approvedSignerIds.has(t.userId))
    if (missingApprovers.length > 0) {
      return reply.code(422).send({
        error: 'missing_approvers',
        message: `Every Approver on this project's team must sign the chain. Missing ${missingApprovers.length} of ${approverTeam.length}: ${missingApprovers.map(m => m.name).join(', ')}.`,
        missingApprovers: missingApprovers.map(m => ({ userId: m.userId, name: m.name })),
      })
    }

    const signers = parsed.data.signers
    const sigIds = await reserveSignatureIds(app.prisma, signers.length)

    const created = await app.prisma.$transaction(async (tx) => {
      const chain = await tx.signatureChain.create({
        data: {
          documentId,
          chainType: parsed.data.chainType,
          status: 'in_progress',
          initiatedBy: request.user!.id,
        },
      })
      await tx.signatureRecord.createMany({
        data: signers.map((s, idx) => ({
          id: sigIds[idx]!,
          chainId: chain.id,
          signerId: s.signerId,
          signerName: s.signerName,
          signerRole: s.signerRole,
          step: idx + 1,
          meaning: s.meaning,
          // Sequential chains: step 1 is awaiting; rest queued.
          // Parallel chains: all awaiting from the start.
          status: parsed.data.chainType === 'parallel' || idx === 0 ? 'awaiting' : 'queued',
          scopeSections: s.scopeSections,
        })),
      })
      return chain
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'signature_initiated',
      entityType: 'document',
      entityId: documentId,
      details: { chainId: created.id, chainType: created.chainType, signerCount: signers.length },
      ipAddress: request.ip ?? null,
    })

    const withRecords = await app.prisma.signatureChain.findUnique({
      where: { id: created.id },
      include: { records: { orderBy: { step: 'asc' } } },
    })
    // Tell whoever can sign now: step 1 of a sequential chain, everyone in a parallel one.
    await notifySigners(
      (withRecords?.records ?? []).filter(r => r.status === 'awaiting'),
      { id: doc.id, projectId: doc.projectId, title: doc.title },
    )
    return reply.code(201).send(withRecords)
  })

  app.get('/documents/:documentId/signature-chains', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const chains = await app.prisma.signatureChain.findMany({
      where: { documentId },
      orderBy: { initiatedAt: 'desc' },
      include: { records: { orderBy: { step: 'asc' } } },
    })

    // Each signed record's audit trail entry (FR-A-066 "audit entry ID"): the
    // signature_recorded / document_signed event written when it was signed,
    // found by the record id it carries.
    const auditIdByRecord = new Map<string, string>()
    if (chains.some(c => c.records.some(r => r.status === 'signed'))) {
      for (const action of ['signature_recorded', 'document_signed']) {
        const page = await app.audit.pageForEntity('document', documentId, { action, limit: 500 })
        for (const row of page.rows) {
          const recordId = (row.details as { recordId?: unknown } | null)?.recordId
          if (typeof recordId === 'string' && !auditIdByRecord.has(recordId)) auditIdByRecord.set(recordId, String(row.id))
        }
      }
    }
    return chains.map(c => ({
      ...c,
      records: c.records.map(r => ({ ...r, credentialHash: undefined, auditEntryId: auditIdByRecord.get(r.id) ?? null })),
    }))
  })

  app.get('/signature-chains/:chainId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { chainId } = request.params as { chainId: string }
    const chain = await app.prisma.signatureChain.findUnique({
      where: { id: chainId },
      include: { records: { orderBy: { step: 'asc' } } },
    })
    if (!chain) return reply.code(404).send({ error: 'not_found' })
    return { ...chain, records: chain.records.map(r => ({ ...r, credentialHash: undefined })) }
  })

  // --- The signing act (§11.200) -----------------------------------------

  app.post('/signature-records/:recordId/sign', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { recordId } = request.params as { recordId: string }
    const parsed = signSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const record = await app.prisma.signatureRecord.findUnique({
      where: { id: recordId },
      include: { chain: true },
    })
    if (!record) return reply.code(404).send({ error: 'not_found' })

    // Only the designated signer can sign — no one, admins included, signs on
    // someone else's behalf (Part 11: signatures cannot be delegated, FR-A-063).
    if (record.signerId !== request.user!.id) {
      return reply.code(403).send({ error: 'wrong_signer', message: 'Only the designated signer may sign this step' })
    }
    if (record.status === 'signed') {
      return reply.code(409).send({ error: 'already_signed' })
    }
    if (record.status !== 'awaiting') {
      // Sequential chain: previous step not yet complete.
      return reply.code(409).send({ error: 'not_awaiting', message: `Record is ${record.status}; cannot sign` })
    }
    if (record.chain.status !== 'in_progress') {
      return reply.code(409).send({ error: 'chain_closed', message: `Chain is ${record.chain.status}` })
    }

    // §11.70 — bind the signature to the exact document state. We hash the
    // current version's sections, same shape as DocumentVersion.contentHash.
    const doc = await app.prisma.document.findUnique({
      where: { id: record.chain.documentId },
      include: { currentVersion: { include: { sections: true } } },
    })
    if (!doc || !doc.currentVersion) {
      return reply.code(409).send({ error: 'document_missing_version', message: 'Document has no current version to bind' })
    }

    // Interim confirmation: the typed name must be the signer's own.
    if (!sameName(parsed.data.confirmName, record.signerName)) {
      return reply.code(422).send({
        error:   'name_mismatch',
        message: `Type your full name exactly as shown (${record.signerName}) to confirm the signature.`,
      })
    }

    const documentHash = hashSections(
      doc.currentVersion.sections.map(s => ({ sectionId: s.sectionId, contentHtml: s.contentHtml })),
    )
    // Hash of what confirmed the signature (the typed name) — kept in place of a
    // credential until re-authentication is configured. Never the plain value.
    const credentialHash = createHash('sha256').update(`name-confirmation:${parsed.data.confirmName.trim()}`, 'utf8').digest('hex')
    const now = new Date()

    const result = await app.prisma.$transaction(async (tx) => {
      // 1. Record the signature (immutable from here).
      const signed = await tx.signatureRecord.update({
        where: { id: recordId },
        data: {
          status: 'signed',
          documentHash,
          versionAtSigning: doc.currentVersion!.versionNumber,   // e.g. "v0.2" — the label ("Working") is not a version
          credentialHash,
          timestampUtc: now,
          localTime: parsed.data.localTime,
          timeSource: SIGNING_TIME_SOURCE,
          authMethod: SIGNING_AUTH_METHOD,
          deviceInfo: parsed.data.deviceInfo ?? null,
          networkInfo: request.ip ?? null,
        },
      })

      // 2. Promote the next sequential step (if any) from queued → awaiting.
      let chainStatus = record.chain.status
      let completedAt: Date | null = null
      let released: { signerId: string; step: number } | null = null
      if (record.chain.chainType === 'sequential') {
        const next = await tx.signatureRecord.findFirst({
          where: { chainId: record.chainId, step: record.step + 1 },
        })
        if (next) {
          await tx.signatureRecord.update({ where: { id: next.id }, data: { status: 'awaiting' } })
          released = { signerId: next.signerId, step: next.step }
        }
      }

      // 3. Chain complete when all records are signed.
      const unsigned = await tx.signatureRecord.count({
        where: { chainId: record.chainId, NOT: { status: 'signed' } },
      })
      if (unsigned === 0) {
        chainStatus = 'complete'
        completedAt = now
        await tx.signatureChain.update({
          where: { id: record.chainId },
          data: { status: 'complete', completedAt: now },
        })
        // 4. Flip doc → signed + clear watermark. updateMany with status
        // predicate makes it a no-op if someone else already moved it.
        await tx.document.updateMany({
          where: { id: record.chain.documentId, status: 'pending_signature' },
          data: { status: 'signed', signedAt: now, watermarked: false },
        })
      }
      return { signed, chainStatus, completedAt, released }
    })

    // The next signer in a sequential chain is told it's their turn.
    if (result.released) {
      await notifySigners([result.released], { id: doc.id, projectId: doc.projectId, title: doc.title })
    }

    // Auto-complete items tagged autoCompleteOn='document_signed' —
    // only fires when the whole chain terminates (not on each individual
    // step). Typically "Final signature by Medical Director" on CSR and
    // "Sponsor signature on final version" on ICF. Non-fatal.
    let autoCompletedCount = 0
    let finalVersionNumber: string | null = null
    if (result.chainStatus === 'complete') {
      // AC-A-046: the signed document becomes v1.0 — a "Final" snapshot of the
      // exact content that was signed becomes the current version. Skipped if a
      // v1.0 already exists (never overwrite a version).
      const v1 = await app.prisma.documentVersion.findFirst({
        where: { documentId: record.chain.documentId, versionNumber: 'v1.0' },
        select: { id: true },
      })
      if (!v1) {
        try {
          const snap = await new DocumentService(app.prisma).createVersionSnapshot({
            documentId: record.chain.documentId,
            createdBy:  request.user!.id,
            label:      'Final',
            reason:     'final_signature',
            note:       `Signed — signature chain ${record.chainId} complete`,
            versionNumber: 'v1.0',
          })
          finalVersionNumber = snap.version.versionNumber
        } catch (err) {
          app.log.error({ err, documentId: record.chain.documentId }, 'final v1.0 version snapshot failed')
        }
      }

      const autoReport = await fireAutoComplete(app.prisma, app.audit, {
        trigger: 'document_signed',
        documentId: record.chain.documentId,
        actorId: request.user!.id,
        ipAddress: request.ip ?? null,
      }).catch(err => {
        app.log.warn({ err, documentId: record.chain.documentId }, 'auto_complete document_signed failed — items left pending')
        return null
      })
      autoCompletedCount = autoReport?.completedCount ?? 0
    }

    const auditEntry = await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: result.chainStatus === 'complete' ? 'document_signed' : 'signature_recorded',
      entityType: 'document',
      entityId: record.chain.documentId,
      details: {
        chainId: record.chainId,
        recordId: record.id,
        step: record.step,
        meaning: record.meaning,
        documentHash,
        versionAtSigning: doc.currentVersion.versionNumber,
        authMethod: SIGNING_AUTH_METHOD,
        finalVersionNumber,
        autoCompletedCount,
      },
      ipAddress: request.ip ?? null,
    })

    return { ...result.signed, credentialHash: undefined, auditEntryId: auditEntry ? String(auditEntry.id) : null }
  })

  // --- Cancellation -------------------------------------------------------

  app.post('/signature-chains/:chainId/cancel', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { chainId } = request.params as { chainId: string }
    const parsed = cancelSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const chain = await app.prisma.signatureChain.findUnique({ where: { id: chainId } })
    if (!chain) return reply.code(404).send({ error: 'not_found' })
    if (chain.status === 'complete' || chain.status === 'cancelled') {
      return reply.code(409).send({ error: 'chain_closed' })
    }
    // Only the document owner cancels (AC-A-045): the person who started the
    // chain, the document's R / assignee, or an admin.
    const isOwner = chain.initiatedBy === request.user!.id
      || await actorCanEditDocumentRaci(app.prisma, request.user!, chain.documentId)
    if (!isOwner) {
      return reply.code(403).send({
        error:   'cancel_forbidden',
        message: "Only the document's owner (its Responsible author), the person who started the chain, or an admin can cancel it.",
      })
    }

    const now = new Date()
    const updated = await app.prisma.$transaction(async (tx) => {
      const c = await tx.signatureChain.update({
        where: { id: chainId },
        data: { status: 'cancelled', cancelledAt: now, cancelReason: parsed.data.cancelReason },
      })
      // Doc reverts to in_authoring per the state machine (signer refusal).
      await tx.document.updateMany({
        where: { id: chain.documentId, status: 'pending_signature' },
        data: { status: 'in_authoring' },
      })
      return c
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: 'signature_chain_cancelled',
      entityType: 'document',
      entityId: chain.documentId,
      details: { chainId, cancelReason: parsed.data.cancelReason },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}

// --- Helpers --------------------------------------------------------------

// SIG-####-## format (datamodel §9.2 — 4-digit chain seq + 2-char step).
// For simplicity we generate from current max; UNIQUE(chainId, step) is the
// real safety net. The second component is a step-index-derived suffix.
async function reserveSignatureIds(prisma: PrismaClient, count: number): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    "SELECT \"id\" FROM signature_records WHERE \"id\" LIKE 'SIG-%' ORDER BY \"id\" DESC LIMIT 1",
  )
  const latest = rows[0]?.id
  const chainSeq = latest ? Number(latest.replace('SIG-', '').split('-')[0]) + 1 : 1
  const chainSeqStr = String(chainSeq).padStart(4, '0')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return Array.from({ length: count }, (_, i) => {
    const stepSuffix = `${alphabet[Math.floor(i / 10) % 26]}${i % 10}`
    return `SIG-${chainSeqStr}-${stepSuffix}`
  })
}
