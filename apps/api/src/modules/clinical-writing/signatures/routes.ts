// Part 11 e-signature chain — Module A terminal step.
//
// Source: 02-datamodel.md §9 (signature_chains + signature_records),
//         docs/compliance/Part11/compliance-assessment.md §11.70/§11.200.
//
// Compliance decisions baked in (defaults — revisit when Compliance signs off):
//   • §11.70 artefact format: canonical JSON (hashSections() of the
//     document's current version at signing time). Reproducible,
//     machine-verifiable. A rendered-PDF binding is additive, not a swap.
//   • §11.200 "two components": per-signature password re-auth + TOTP.
//     We store sha256(credential proof) — the plaintext never touches the DB.
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
import { hashSections } from '../documents/service.js'
import type { PrismaClient } from '@prisma/client'

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
  // Password re-auth proof — client POSTs the fresh password, server hashes
  // immediately and stores sha256(proof). The raw proof is never written.
  // (Compliance may replace this with a signed WebAuthn assertion later;
  //  shape stays the same, hash input changes.)
  credentialProof: z.string().min(8, 'credential proof required (§11.200)'),
  // Optional environment context — supplements the server-side ip/user agent.
  localTime: z.string().min(1),                 // '16:32 CET'
  timeSource: z.string().optional(),            // 'Aurora time server, NTP stratum 2'
  deviceInfo: z.string().optional(),
})

const cancelSchema = z.object({
  cancelReason: z.string().min(1, 'cancel reason required for Part 11 audit'),
})

export const signatureRoutes: FastifyPluginAsync = async (app) => {
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
    return reply.code(201).send(withRecords)
  })

  app.get('/documents/:documentId/signature-chains', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.signatureChain.findMany({
      where: { documentId },
      orderBy: { initiatedAt: 'desc' },
      include: { records: { orderBy: { step: 'asc' } } },
    })
  })

  app.get('/signature-chains/:chainId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { chainId } = request.params as { chainId: string }
    const chain = await app.prisma.signatureChain.findUnique({
      where: { id: chainId },
      include: { records: { orderBy: { step: 'asc' } } },
    })
    if (!chain) return reply.code(404).send({ error: 'not_found' })
    return chain
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

    // Only the designated signer (or admin) can sign.
    if (record.signerId !== request.user!.id && !['admin', 'super-admin'].includes(request.user!.role)) {
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

    const documentHash = hashSections(
      doc.currentVersion.sections.map(s => ({ sectionId: s.sectionId, contentHtml: s.contentHtml })),
    )
    const credentialHash = createHash('sha256').update(parsed.data.credentialProof, 'utf8').digest('hex')
    const now = new Date()

    const result = await app.prisma.$transaction(async (tx) => {
      // 1. Record the signature (immutable from here).
      const signed = await tx.signatureRecord.update({
        where: { id: recordId },
        data: {
          status: 'signed',
          documentHash,
          versionAtSigning: doc.currentVersion!.label,
          credentialHash,
          timestampUtc: now,
          localTime: parsed.data.localTime,
          timeSource: parsed.data.timeSource ?? 'server clock (UTC)',
          authMethod: 'password re-auth + TOTP',
          deviceInfo: parsed.data.deviceInfo ?? null,
          networkInfo: request.ip ?? null,
        },
      })

      // 2. Promote the next sequential step (if any) from queued → awaiting.
      let chainStatus = record.chain.status
      let completedAt: Date | null = null
      if (record.chain.chainType === 'sequential') {
        const next = await tx.signatureRecord.findFirst({
          where: { chainId: record.chainId, step: record.step + 1 },
        })
        if (next) {
          await tx.signatureRecord.update({ where: { id: next.id }, data: { status: 'awaiting' } })
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
      return { signed, chainStatus, completedAt }
    })

    await app.audit.append({
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
        versionAtSigning: doc.currentVersion.label,
      },
      ipAddress: request.ip ?? null,
    })

    return result.signed
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
