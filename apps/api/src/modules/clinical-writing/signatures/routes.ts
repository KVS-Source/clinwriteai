// Part 11 e-signature chain — Module A terminal step.
//
// Source: 02-datamodel.md §9 (signature_chains + signature_records),
//         docs/compliance/Part11/compliance-assessment.md §11.70/§11.200.
//
// Compliance decisions baked in (defaults — revisit when Compliance signs off):
//   • §11.70 artefact format: canonical JSON (hashSections() of the
//     document's current version at signing time). Reproducible,
//     machine-verifiable. A rendered-PDF binding is additive, not a swap.
//   • §11.200 re-authentication at signing: the signer re-enters their login
//     password, checked against the stored bcrypt hash. Each record says exactly
//     that in authMethod (SIGNING_AUTH_METHOD) — never a method that wasn't used.
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
import { PASSWORD_MAX_LENGTH, verifyPassword } from '../../../auth/password.js'
import { DocumentService, hashSections } from '../documents/service.js'
import { fireAutoComplete } from '../checklist/auto-complete.js'
import { recordsToRelease, type ChainType, type SignatureStatus } from './chain-progress.js'
import { makeNotifySigners, startSignatureChain } from './start-chain.js'
import { actorCanCancelChain, actorCanReadDocumentRecord, actorCanStartChain } from './access.js'
import { resetRaciRound } from '../../platform/document-raci/access.js'
import { approvalRoundState, bounceToAuthoring } from '../../platform/document-raci/return-to-authoring.js'
import { PROJECT_CLOSED, documentProjectIsClosed } from '../../projects/closed.js'
import { autoPushSignedDocument } from '../../platform/library/auto-push.js'
import { nextCommentId } from '../comments/routes.js'
import { APPROVE_DOCUMENT_REF } from './auto-start.js'

const initiateSchema = z.object({
  // approvers_first (the default since 2026-11-17): Approvers sign first, then Authors, Reviewers and
  // Informed together. grouped stays accepted for chains started the old way.
  chainType: z.enum(['sequential', 'parallel', 'grouped', 'approvers_first']).default('approvers_first'),
  signers: z.array(z.object({
    signerId: z.string().min(1),
    signerName: z.string().min(1),
    signerRole: z.string().min(1),
    meaning: z.enum(['authored', 'reviewed', 'approved', 'acknowledged']),
    scopeSections: z.array(z.string()).default([]),
  })).min(1, 'At least one signer required'),
})

const signSchema = z.object({
  // Re-authentication at signing: the signer's own login password.
  password: z.string().min(1, 'Enter your password to confirm the signature').max(PASSWORD_MAX_LENGTH),
  // Signer-side context, kept for reference (the server UTC time is authoritative).
  localTime: z.string().min(1),                 // '16:32 CET'
  deviceInfo: z.string().optional(),
  // An Approver's optional comment from the Approve & E-sign dialog, kept with their approval.
  approvalComment: z.string().trim().max(2000).optional(),
})


export const SIGNING_AUTH_METHOD = 'Login session + password re-entered at signing'
export const SIGNING_TIME_SOURCE = 'Server clock (UTC)'

const cancelSchema = z.object({
  cancelReason: z.string().min(1, 'cancel reason required for Part 11 audit'),
})

export const signatureRoutes: FastifyPluginAsync = async (app) => {
  const notifySigners = makeNotifySigners(app)

  // AC-A-046: the signed document becomes v1.0 — a "Final" snapshot of the exact content that was
  // signed. Never overwrites an existing v1.0. A failure is retried, then reported (versionNumber
  // null) so the caller can record it — it must not undo a signature that is already committed.
  const ensureFinalVersion = async (
    documentId: string, userId: string, chainId: string,
  ): Promise<{ versionNumber: string | null; created: boolean }> => {
    const existing = await app.prisma.documentVersion.findFirst({
      where: { documentId, versionNumber: 'v1.0' },
      select: { id: true },
    })
    if (existing) return { versionNumber: 'v1.0', created: false }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const snap = await new DocumentService(app.prisma).createVersionSnapshot({
          documentId,
          createdBy: userId,
          label:     'Final',
          reason:    'final_signature',
          note:      `Signed — signature chain ${chainId} complete`,
          versionNumber: 'v1.0',
        })
        return { versionNumber: snap.version.versionNumber, created: true }
      } catch (err) {
        app.log.error({ err, documentId, attempt }, 'final v1.0 version snapshot failed')
        if (attempt < 3) await new Promise(r => setTimeout(r, 150 * attempt))
      }
    }
    return { versionNumber: null, created: false }
  }

  // --- Chain initiation + listing ----------------------------------------

  app.post('/documents/:documentId/signature-chains', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    if (await documentProjectIsClosed(app.prisma, documentId)) return reply.code(423).send(PROJECT_CLOSED)
    const parsed = initiateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    // Only the document's Author (R) or Approver (A) starts a chain — never an admin, PM, auditor or guest.
    if (!(await actorCanStartChain(app.prisma, request.user!, documentId))) {
      return reply.code(403).send({
        error:   'start_forbidden',
        message: "Only the document's Author (R) or Approver (A) can start the signature chain.",
      })
    }
    const started = await startSignatureChain(app, {
      doc,
      actorId:   request.user!.id,
      ipAddress: request.ip ?? null,
      chainType: parsed.data.chainType,
      signers:   parsed.data.signers,
    })
    if (!started.ok) return reply.code(started.status).send(started.body)
    return reply.code(201).send(started.chain)
  })

  app.get('/documents/:documentId/signature-chains', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    if (!(await actorCanReadDocumentRecord(app.prisma, request.user!, doc))) {
      return reply.code(403).send({ error: 'signature_access_forbidden', message: "You don't have access to this document's signature records." })
    }
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
    // A signed document without its v1.0 snapshot (the snapshot failed when the last signature was
    // recorded): create it now. The content can't have changed since — signed documents are locked.
    const completedChain = chains.find(c => c.status === 'complete')
    if (doc.status === 'signed' && completedChain) {
      try {
        const final = await ensureFinalVersion(documentId, request.user!.id, completedChain.id)
        if (final.created) {
          await app.audit.append({
            timestamp: new Date().toISOString(),
            actorId: request.user!.id,
            action: 'final_version_created_late',
            entityType: 'document',
            entityId: documentId,
            details: { chainId: completedChain.id, versionNumber: final.versionNumber },
            ipAddress: request.ip ?? null,
          })
          // The push waited for this snapshot (auto-push.ts); do it now.
          await autoPushSignedDocument(app, documentId, { trigger: 'late_final_version', ipAddress: request.ip ?? null })
        }
      } catch (err) {
        app.log.warn({ err, documentId }, 'late v1.0 snapshot repair failed')
      }
    }
    return chains.map(c => ({
      ...c,
      records: c.records.map(r => ({ ...r, credentialHash: undefined, auditEntryId: auditIdByRecord.get(r.id) ?? null })),
    }))
  })

  // Why the E-Signature tab has no chain to show. Signing starts by itself when the CRM is finished (Approvers
  // first); nobody starts a chain by hand. While the document awaits signature with no running chain, this
  // returns the reason the automatic start was blocked (the last signature_auto_start_blocked audit entry).
  app.get('/documents/:documentId/signature-chains/start-status', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    if (!(await actorCanReadDocumentRecord(app.prisma, request.user!, doc))) {
      return reply.code(403).send({ error: 'signature_access_forbidden', message: "You don't have access to this document's signature records." })
    }
    if (doc.status !== 'pending_signature') return { status: doc.status, blocked: null }
    const running = await app.prisma.signatureChain.findFirst({ where: { documentId, status: { in: ['in_progress', 'complete'] } } })
    if (running) return { status: doc.status, blocked: null }
    const page = await app.audit.pageForEntity('document', documentId, { action: 'signature_auto_start_blocked', limit: 1 })
    const reason = (page.rows[0]?.details as { reason?: { error?: unknown; message?: unknown } } | null)?.reason
    return {
      status:  doc.status,
      blocked: reason ? { error: String(reason.error ?? 'blocked'), message: String(reason.message ?? '') } : null,
    }
  })

  app.get('/signature-chains/:chainId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { chainId } = request.params as { chainId: string }
    const chain = await app.prisma.signatureChain.findUnique({
      where: { id: chainId },
      include: { records: { orderBy: { step: 'asc' } } },
    })
    if (!chain) return reply.code(404).send({ error: 'not_found' })
    const chainDoc = await app.prisma.document.findUnique({ where: { id: chain.documentId } })
    if (!chainDoc || !(await actorCanReadDocumentRecord(app.prisma, request.user!, chainDoc))) {
      return reply.code(403).send({ error: 'signature_access_forbidden', message: "You don't have access to this document's signature records." })
    }
    return { ...chain, records: chain.records.map(r => ({ ...r, credentialHash: undefined })) }
  })

  // --- The signing act (§11.200) -----------------------------------------

  app.post('/signature-records/:recordId/sign', { preHandler: requireAuth({ modules: ['A'] }), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { recordId } = request.params as { recordId: string }
    const parsed = signSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const record = await app.prisma.signatureRecord.findUnique({
      where: { id: recordId },
      include: { chain: true },
    })
    if (!record) return reply.code(404).send({ error: 'not_found' })
    if (await documentProjectIsClosed(app.prisma, record.chain.documentId)) return reply.code(423).send(PROJECT_CLOSED)

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
    // An Approver who returned the document cannot also sign it: their part is closed, and the document goes back
    // to authoring once the other Approvers have finished.
    if (record.meaning === 'approved') {
      const returned = await app.prisma.documentRaci.findFirst({
        where:  { documentId: record.chain.documentId, userId: record.signerId, letter: 'A', removedAt: null, rejectedAt: { not: null } },
        select: { id: true },
      })
      if (returned) {
        return reply.code(409).send({
          error:   'returned_document',
          message: 'You returned this document, so you cannot sign it. It goes back to authoring once the other approvers have finished.',
        })
      }
    }

    // §11.70 — bind the signature to the exact document state. We hash the
    // current version's sections, same shape as DocumentVersion.contentHash.
    const doc = await app.prisma.document.findUnique({
      where: { id: record.chain.documentId },
      include: { currentVersion: { include: { sections: true } } },
    })
    // The document must still be awaiting signature. Something else (a status change) may have moved
    // it since the chain started; signing then would complete a chain on a document that can't become signed.
    if (doc && doc.status !== 'pending_signature') {
      return reply.code(409).send({
        error:   'document_not_pending_signature',
        message: `This document is no longer awaiting signature (status: ${doc.status}). Cancel this chain and start a new one once it is back in Pending signature.`,
      })
    }
    if (!doc || !doc.currentVersion) {
      return reply.code(409).send({ error: 'document_missing_version', message: 'Document has no current version to bind' })
    }

    // Re-authentication: the signer's own login password. A wrong password is a 422, not a 401: the
    // session is still valid and a 401 would send the signer to the sign-in page.
    const signer = await app.prisma.user.findUnique({ where: { id: request.user!.id }, select: { passwordHash: true } })
    if (!signer?.passwordHash) {
      return reply.code(409).send({
        error:   'no_password_on_file',
        message: 'Your account has no password set, so you cannot sign yet. Set a password from the sign-in page first.',
      })
    }
    if (!(await verifyPassword(parsed.data.password, signer.passwordHash))) {
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'signature_password_failed',
        entityType: 'document',
        entityId: record.chain.documentId,
        details: { chainId: record.chainId, recordId: record.id, step: record.step },
        ipAddress: request.ip ?? null,
      })
      return reply.code(422).send({ error: 'wrong_password', message: 'That password is not correct. Please try again.' })
    }

    const documentHash = hashSections(
      doc.currentVersion.sections.map(s => ({ sectionId: s.sectionId, contentHtml: s.contentHtml })),
    )
    // Fingerprint of the credential that confirmed the signature: a hash of the stored bcrypt hash,
    // which identifies it without the salt. Never the password or a fast hash of the password.
    const credentialHash = createHash('sha256').update(`password-credential:${signer.passwordHash}`, 'utf8').digest('hex')
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

      // An Approver's signature is their approval of the document (Approve & E-sign).
      if (record.meaning === 'approved') {
        await tx.documentRaci.updateMany({
          where: { documentId: record.chain.documentId, userId: record.signerId, letter: 'A', removedAt: null, documentApprovedAt: null },
          data:  { documentApprovedAt: now },
        })
      }

      // 2. Release whoever is next: the next step (sequential), or the next group once the signed person's
      // group has fully signed (grouped). Parallel chains release nobody — everyone is already awaiting.
      let chainStatus = record.chain.status
      let completedAt: Date | null = null
      const released: Array<{ signerId: string; step: number }> = []
      const chainRecords = (await tx.signatureRecord.findMany({ where: { chainId: record.chainId } }))
        .map(r => ({ id: r.id, step: r.step, status: r.status as SignatureStatus, signerId: r.signerId, meaning: r.meaning }))
      // While any Approver has returned the document nobody else is asked to sign: it goes back to authoring
      // once every Approver has finished (below).
      const approverReturned = record.meaning === 'approved'
        && (await tx.documentRaci.count({ where: { documentId: record.chain.documentId, letter: 'A', removedAt: null, rejectedAt: { not: null } } })) > 0
      for (const next of approverReturned ? [] : recordsToRelease(chainRecords, record.chain.chainType as ChainType, record.id)) {
        await tx.signatureRecord.update({ where: { id: next.id }, data: { status: 'awaiting' } })
        released.push({ signerId: next.signerId, step: next.step })
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

    // Whoever was released is told it's their turn: the next step of a sequential chain, the next group
    // of a group chain (approvers_first: Authors, Reviewers and Informed once every Approver has signed).
    if (result.released.length > 0) {
      await notifySigners(result.released, { id: doc.id, projectId: doc.projectId, title: doc.title }, request.user!.id, record.chain.chainType)
    }

    // The Approver's approval shows in Comments like any approval, with their comment if they wrote one.
    // The signature is already committed, so a failure here is logged and never fails it.
    if (record.meaning === 'approved') {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await app.prisma.comment.create({
            data: {
              id: await nextCommentId(app.prisma), documentId: doc.id, sectionRef: APPROVE_DOCUMENT_REF,
              text: parsed.data.approvalComment ?? '', severity: 'query', verdict: 'approve', reviewerId: request.user!.id,
            },
          })
          break
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002') continue
          app.log.warn({ err, documentId: doc.id, recordId }, 'approval comment after signing failed')
          break
        }
      }
    }

    // Auto-complete items tagged autoCompleteOn='document_signed' —
    // only fires when the whole chain terminates (not on each individual
    // step). Typically "Final signature by Medical Director" on CSR and
    // "Sponsor signature on final version" on ICF. Non-fatal.
    let autoCompletedCount = 0
    let finalVersionNumber: string | null = null
    let finalSnapshotFailed = false
    if (result.chainStatus === 'complete') {
      const final = await ensureFinalVersion(record.chain.documentId, request.user!.id, record.chainId)
      finalVersionNumber = final.created ? final.versionNumber : null
      finalSnapshotFailed = final.versionNumber === null

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

    const signatureAudit = {
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
        finalSnapshotFailed,
        autoCompletedCount,
        ...(record.meaning === 'approved' ? { approved: true, approvalComment: parsed.data.approvalComment ?? null } : {}),
      },
      ipAddress: request.ip ?? null,
    }

    // The signature is already committed, so a failed audit write must not make it look like the
    // signing failed (the signer would retry and hit already_signed). Retry a few times; if it still
    // fails, log the full entry loudly so it can be recovered, and return the signature without an
    // audit id.
    let auditEntry: { id: unknown } | null | undefined = null
    for (let attempt = 1; attempt <= 3 && !auditEntry; attempt++) {
      try {
        auditEntry = await app.audit.append(signatureAudit)
      } catch (err) {
        app.log.error({ err, attempt, recordId: record.id, signatureAudit }, 'signature audit entry failed')
        if (attempt < 3) await new Promise(r => setTimeout(r, 150 * attempt))
      }
    }

    // The signed document goes into the Master Library by itself, after the signature is on the trail. Tags come
    // from the document; a missing tag skips the push with a logged reason. Never throws, so it can't fail the
    // signing; audited on the document (auto-push.ts). Without the v1.0 snapshot it waits for the late one.
    if (result.chainStatus === 'complete') {
      await autoPushSignedDocument(app, record.chain.documentId, { trigger: 'signing', signedBy: request.user!.id, ipAddress: request.ip ?? null })
    }

    // Every Approver has now finished (signed or returned) and at least one returned the document: it goes back
    // to authoring, as if the last of them had returned it. The signature above stays on the trail.
    let returnedToAuthoring = false
    if (record.meaning === 'approved' && result.chainStatus !== 'complete') {
      const state = await approvalRoundState(app.prisma, record.chain.documentId)
      if (state.allIn && state.rejected.length > 0) {
        const trigger = state.rejected[state.rejected.length - 1]!
        await bounceToAuthoring(app, new DocumentService(app.prisma), {
          documentId: record.chain.documentId, from: 'pending_signature', actorId: request.user!.id, ip: request.ip ?? null,
          returnedBy: { raciId: trigger.id, userId: trigger.userId, letter: 'A', sectionId: trigger.sectionId },
          note: trigger.rejectionNote ?? 'Returned by an Approver',
          doc: { title: doc.title, projectId: doc.projectId, assigneeId: doc.assigneeId },
        })
        returnedToAuthoring = true
      }
    }

    return { ...result.signed, credentialHash: undefined, auditEntryId: auditEntry ? String(auditEntry.id) : null, ...(returnedToAuthoring && { returnedToAuthoring: true }) }
  })

  // --- Cancellation -------------------------------------------------------

  app.post('/signature-chains/:chainId/cancel', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { chainId } = request.params as { chainId: string }
    const parsed = cancelSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const chain = await app.prisma.signatureChain.findUnique({ where: { id: chainId } })
    if (!chain) return reply.code(404).send({ error: 'not_found' })
    if (await documentProjectIsClosed(app.prisma, chain.documentId)) return reply.code(423).send(PROJECT_CLOSED)
    if (chain.status === 'complete' || chain.status === 'cancelled') {
      return reply.code(409).send({ error: 'chain_closed' })
    }
    // Only the document's Author (R) or the person who started the chain cancels (AC-A-045).
    // Admins and PMs no longer can.
    if (!(await actorCanCancelChain(app.prisma, request.user!, chain))) {
      return reply.code(403).send({
        error:   'cancel_forbidden',
        message: "Only the document's Author (R) or the person who started the chain can cancel it.",
      })
    }

    const now = new Date()
    const updated = await app.prisma.$transaction(async (tx) => {
      const c = await tx.signatureChain.update({
        where: { id: chainId },
        data: { status: 'cancelled', cancelledAt: now, cancelReason: parsed.data.cancelReason },
      })
      // Doc reverts to in_authoring per the state machine (signer refusal).
      const reverted = await tx.document.updateMany({
        where: { id: chain.documentId, status: 'pending_signature' },
        data: { status: 'in_authoring' },
      })
      // A new round: authors submit again, reviewers and approvers review / approve again.
      if (reverted.count > 0) await resetRaciRound(tx, chain.documentId)
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
