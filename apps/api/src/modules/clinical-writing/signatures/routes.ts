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
import type { PrismaClient } from '@prisma/client'
import { blockedBody, checkSignatureGate } from '../checklist/gates.js'
import { fireAutoComplete } from '../checklist/auto-complete.js'
import { initialStatuses, recordsToRelease, sortForChain, type ChainType, type SignatureStatus } from './chain-progress.js'
import { actorCanCancelChain, actorCanReadDocumentRecord, actorCanStartChain, requiredSigners } from './access.js'
import { resetRaciRound } from '../../platform/document-raci/access.js'
import { PROJECT_CLOSED, documentProjectIsClosed } from '../../projects/closed.js'

const initiateSchema = z.object({
  chainType: z.enum(['sequential', 'parallel', 'grouped']).default('grouped'),
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
})

// What each signature records as its authentication method — exactly what happened.
// Postgres advisory-lock key serialising signature-id allocation (arbitrary, unique to this use).
const SIGNATURE_ID_LOCK_KEY = 7301001

export const SIGNING_AUTH_METHOD = 'Login session + password re-entered at signing'
export const SIGNING_TIME_SOURCE = 'Server clock (UTC)'

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

    // The chain needs at least one Approver: without an approval the document can't become signed.
    // Everyone named on the document (Author, Reviewer, Approver, Informed) is pre-filled on the screen,
    // but the starter may remove people, so naming is not enforced here. Anyone named who is left off is
    // recorded in the audit entry below, so the omission is traceable.
    if (!parsed.data.signers.some(s => s.meaning === 'approved')) {
      return reply.code(422).send({
        error: 'approver_required',
        message: 'The signature chain needs at least one Approver. Add an Approver to the chain.',
      })
    }
    const named = await requiredSigners(app.prisma, doc)
    const omittedNamedSigners = named
      .filter(r => !parsed.data.signers.some(s => s.signerId === r.userId && r.meanings.has(s.meaning)))
      .map(r => ({ userId: r.userId, name: r.name, meanings: [...r.meanings] }))

    // A grouped chain stores the signers group by group (Authors, Reviewers, Approvers, Informed), so the
    // step numbers follow the signing order.
    const signers = sortForChain(parsed.data.signers, parsed.data.chainType)
    const startStatuses = initialStatuses(parsed.data.chainType, signers)
    const created = await app.prisma.$transaction(async (tx) => {
      // Take the ids under a lock held until commit, so two chains started at the same moment
      // can't be handed the same ones.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${SIGNATURE_ID_LOCK_KEY})`)
      const sigIds = await reserveSignatureIds(tx, signers.length)
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
          // Sequential chains: step 1 is awaiting; rest queued. Parallel chains: all awaiting from the start.
          // Grouped chains: the whole first group is awaiting; the later groups are queued.
          status: startStatuses[idx]!,
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
      details: { chainId: created.id, chainType: created.chainType, signerCount: signers.length, omittedNamedSigners },
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

      // 2. Release whoever is next: the next step (sequential), or the next group once the signed person's
      // group has fully signed (grouped). Parallel chains release nobody — everyone is already awaiting.
      let chainStatus = record.chain.status
      let completedAt: Date | null = null
      const released: Array<{ signerId: string; step: number }> = []
      const chainRecords = (await tx.signatureRecord.findMany({ where: { chainId: record.chainId } }))
        .map(r => ({ id: r.id, step: r.step, status: r.status as SignatureStatus, signerId: r.signerId, meaning: r.meaning }))
      for (const next of recordsToRelease(chainRecords, record.chain.chainType as ChainType, record.id)) {
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

    // The next signer in a sequential chain is told it's their turn.
    if (result.released.length > 0) {
      await notifySigners(result.released, { id: doc.id, projectId: doc.projectId, title: doc.title })
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

    return { ...result.signed, credentialHash: undefined, auditEntryId: auditEntry ? String(auditEntry.id) : null }
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

// SIG-####-## format (datamodel §9.2 — 4-digit chain seq + 2-char step).
// For simplicity we generate from current max; UNIQUE(chainId, step) is the
// real safety net. The second component is a step-index-derived suffix.
async function reserveSignatureIds(prisma: Pick<PrismaClient, '$queryRawUnsafe'>, count: number): Promise<string[]> {
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
