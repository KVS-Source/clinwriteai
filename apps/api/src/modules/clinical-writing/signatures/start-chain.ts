// Starting a Part 11 signature chain — shared by the manual route (POST
// /documents/:id/signature-chains) and the automatic start when the CRM meeting completes (auto-start.ts).
//
// Everything here is the chain's own rules, unchanged from when it lived in the route: the document
// must be pending_signature with no active chain, the two gates (mandatory checklist items, signable
// content) must pass, and the chain needs at least one Approver. Who may *ask* for a chain (Author /
// Approver) is the caller's concern; the automatic start runs on behalf of the last approving Approver.

import type { FastifyInstance } from 'fastify'
import type { Document, PrismaClient } from '@prisma/client'
import { blockedBody, checkSignatureGate } from '../checklist/gates.js'
import { checkSignableContent, contentBlockedBody } from './content-gate.js'
import { initialStatuses, sortForChain, type ChainType } from './chain-progress.js'
import { requiredSigners } from './access.js'

// Postgres advisory-lock key serialising signature-id allocation (arbitrary, unique to this use).
const SIGNATURE_ID_LOCK_KEY = 7301001

/** Test switch for the content gate (see startSignatureChain). Off unless set. In production the
 *  second flag SIGNATURE_ALLOW_SKIP_IN_PROD=1 must ALSO be set, so a stale test env var on a prod
 *  host can never silently bypass the gate. */
function skipContentGate(): boolean {
  if (process.env.SIGNATURE_SKIP_CONTENT_GATE !== '1') return false
  return process.env.NODE_ENV !== 'production'
    || process.env.SIGNATURE_ALLOW_SKIP_IN_PROD === '1'
}

export type SignerInput = {
  signerId: string
  signerName: string
  signerRole: string
  meaning: 'authored' | 'reviewed' | 'approved' | 'acknowledged'
  scopeSections: string[]
}

// In-app notice to a signer that it's their turn (contract §9 "notifies next signer"). Never blocks or
// fails the signature itself.
// In an approvers_first chain an Approver approves and signs in one step from the Approver View, so their
// notice links there; everyone else signs on the E-Signature tab.
export function makeNotifySigners(app: FastifyInstance) {
  return async (
    signers: Array<{ signerId: string; step: number; meaning?: string }>,
    doc: { id: string; projectId: string; title: string },
    startedBy?: string,
    chainType?: string,
  ) => {
    if (!app.hasDecorator('notifications')) return
    const base = `/projects/${doc.projectId}/clinical-writing/documents/${doc.id}`
    for (const s of signers) {
      const approveAndSign = chainType === 'approvers_first' && s.meaning === 'approved'
      try {
        await app.notifications.send({
          recipientId: s.signerId,
          kind:        'signature_requested',
          title:       approveAndSign ? `Your approval is needed on "${doc.title}"` : `Your signature is needed on "${doc.title}"`,
          body:        approveAndSign
            ? 'Every reviewer has finished. Open the document to read it and use Approve & E-sign.'
            : chainType === 'approvers_first'
              ? 'Every approver has signed. Open the E-Signature tab to review and sign.'
              : `It's your turn to sign (step ${s.step}). Open the E-Signature tab to review and sign.`,
          linkPath:    approveAndSign ? `${base}/review` : `${base}/sign`,
          payload:     { documentId: doc.id, projectId: doc.projectId, step: s.step, ...(startedBy ? { startedBy } : {}) },
        })
      } catch (err) {
        app.log.warn({ err, documentId: doc.id, signerId: s.signerId }, 'signature_requested notification failed')
      }
    }
  }
}

export type StartChainResult =
  | { ok: true; chain: unknown }
  | { ok: false; status: number; body: Record<string, unknown> }

export async function startSignatureChain(app: FastifyInstance, args: {
  doc: Document
  actorId: string
  ipAddress: string | null
  chainType: ChainType
  signers: SignerInput[]
  /** True when the system started it (after the last Approver approved), recorded in the audit entry. */
  automatic?: boolean
}): Promise<StartChainResult> {
  const { doc, actorId, ipAddress, chainType } = args
  const documentId = doc.id

  if (doc.status !== 'pending_signature') {
    return { ok: false, status: 422, body: {
      error: 'wrong_status',
      message: `Signature chain requires document in pending_signature (current: ${doc.status})`,
    } }
  }
  // Refuse concurrent chains — one active chain per doc at a time.
  const activeChain = await app.prisma.signatureChain.findFirst({
    where: { documentId, status: { in: ['initiated', 'in_progress'] } },
  })
  if (activeChain) return { ok: false, status: 409, body: { error: 'chain_already_active', chainId: activeChain.id } }

  // Older chain types sign only once every Approver (A) has approved the document separately. In an
  // approvers_first chain the Approvers' signatures ARE their approval, so there is nothing to wait for.
  const approvers = chainType === 'approvers_first' ? [] : await app.prisma.documentRaci.findMany({
    where:  { documentId, letter: 'A', removedAt: null },
    select: { documentApprovedAt: true },
  })
  const pendingApprovers = approvers.filter(a => a.documentApprovedAt === null).length
  if (pendingApprovers > 0) {
    return { ok: false, status: 409, body: {
      error:   'approvals_pending',
      message: `${pendingApprovers} approver${pendingApprovers === 1 ? ' has' : 's have'} not approved the document yet. Signing starts once every approver has approved.`,
      pendingApprovers,
    } }
  }

  // Gate A — the strongest gate. Every mandatory ChecklistInstanceItem across every stage must be
  // Complete or Waived before a Part 11 signature chain is allowed to open on this document.
  const gate = await checkSignatureGate(app.prisma, documentId)
  if (!gate.ok) return { ok: false, status: 409, body: blockedBody('signature', gate) as unknown as Record<string, unknown> }

  // Gate B — the text itself: no mandatory section empty or still holding a placeholder (CW-097).
  let contentGateSkipped = 0
  {
    const [version, waivers] = await Promise.all([
      doc.currentVersionId
        ? app.prisma.documentVersion.findUnique({ where: { id: doc.currentVersionId }, select: { sections: { select: { sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true } } } })
        : null,
      app.prisma.ichSectionWaiver.findMany({ where: { documentId }, select: { sectionCode: true } }),
    ])
    const content = checkSignableContent({
      documentType: doc.type, sections: version?.sections ?? [], waivedCodes: waivers.map(w => w.sectionCode),
    })
    if (!content.ok) {
      // TEST ONLY: SIGNATURE_SKIP_CONTENT_GATE=1 lets a chain open on a document with empty sections or
      // placeholders, to exercise the signing flow on sample data. Off by default; in production the
      // second flag SIGNATURE_ALLOW_SKIP_IN_PROD=1 must also be set. Every use is logged and recorded
      // in the audit entry.
      if (skipContentGate()) {
        contentGateSkipped = content.problems.length
        app.log.warn({
          documentId,
          problems: content.problems.length,
          nodeEnv: process.env.NODE_ENV,
          prodOverride: process.env.NODE_ENV === 'production',
        }, 'SIGNATURE_SKIP_CONTENT_GATE is on: opening a signature chain on incomplete content')
      } else {
        return { ok: false, status: 409, body: contentBlockedBody(content) as unknown as Record<string, unknown> }
      }
    }
  }

  // The chain needs at least one Approver: without an approval the document can't become signed.
  // Everyone named on the document (Author, Reviewer, Approver, Informed) is pre-filled on the screen,
  // but the starter may remove people, so naming is not enforced here. Anyone named who is left off is
  // recorded in the audit entry below, so the omission is traceable.
  if (!args.signers.some(s => s.meaning === 'approved')) {
    return { ok: false, status: 422, body: {
      error: 'approver_required',
      message: 'The signature chain needs at least one Approver. Add an Approver to the chain.',
    } }
  }
  const named = await requiredSigners(app.prisma as PrismaClient, doc)
  const omittedNamedSigners = named
    .filter(r => !args.signers.some(s => s.signerId === r.userId && r.meanings.has(s.meaning)))
    .map(r => ({ userId: r.userId, name: r.name, meanings: [...r.meanings] }))

  // A grouped chain stores the signers group by group (Authors, Reviewers, Approvers, Informed), so the
  // step numbers follow the signing order.
  const signers = sortForChain(args.signers, chainType)
  const startStatuses = initialStatuses(chainType, signers)
  const created = await app.prisma.$transaction(async (tx) => {
    // Take the ids under a lock held until commit, so two chains started at the same moment
    // can't be handed the same ones.
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${SIGNATURE_ID_LOCK_KEY})`)
    const sigIds = await reserveSignatureIds(tx, signers.length)
    const chain = await tx.signatureChain.create({
      data: {
        documentId,
        chainType,
        status: 'in_progress',
        initiatedBy: actorId,
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
    actorId,
    action: 'signature_initiated',
    entityType: 'document',
    entityId: documentId,
    details: { chainId: created.id, chainType: created.chainType, signerCount: signers.length, omittedNamedSigners, ...(args.automatic ? { automatic: true } : {}), ...(contentGateSkipped > 0 ? { contentGateSkipped } : {}) },
    ipAddress,
  })

  const withRecords = await app.prisma.signatureChain.findUnique({
    where: { id: created.id },
    include: { records: { orderBy: { step: 'asc' } } },
  })
  // Tell whoever can sign now: step 1 of a sequential chain, everyone in a parallel one.
  await makeNotifySigners(app)(
    (withRecords?.records ?? []).filter(r => r.status === 'awaiting'),
    { id: doc.id, projectId: doc.projectId, title: doc.title },
    actorId,
    chainType,
  )
  return { ok: true, chain: withRecords }
}

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

/**
 * The signers for an automatic chain: everyone named on the document, as the screen pre-fills it —
 * each Author (authored), Reviewer (reviewed), Approver (approved) and Informed (acknowledged).
 */
const MEANING_ROLE: Record<SignerInput['meaning'], string> = {
  authored: 'Author', reviewed: 'Reviewer', approved: 'Approver', acknowledged: 'Informed',
}
export async function defaultSigners(prisma: PrismaClient, doc: { id: string; projectId: string }): Promise<SignerInput[]> {
  const named = await requiredSigners(prisma, doc)
  const out: SignerInput[] = []
  for (const n of named) {
    for (const meaning of n.meanings) {
      out.push({ signerId: n.userId, signerName: n.name, signerRole: MEANING_ROLE[meaning as SignerInput['meaning']], meaning: meaning as SignerInput['meaning'], scopeSections: [] })
    }
  }
  return out
}
