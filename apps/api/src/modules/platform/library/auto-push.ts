// Signed documents go into the Master Library by themselves (2026-11-13).
//
// When the last e-signature completes a document's chain (and its "Final" v1.0 snapshot is made), the whole
// document is pushed to the Master Library with the four mandatory tags taken from the document itself:
//   therapeutic area — the document's own (must be an active TA)
//   version          — the final version's number (v1.0)
//   module           — A (Clinical Writing)
//   document type    — from the document's type (csr-full → CSR, protocol → Protocol, …)
// A missing tag never fails the signing: the push is skipped, the reason is logged, and the Final Document page
// shows a warning. Nothing is ever pushed twice: one library entry per document version, checked under a lock.
//
// Audit — always on the document's own trail (so it shows under "View audit trail"), actor "system:auto-push":
//   library_auto_pushed        what was pushed: library entry id, versions, the tags used, what triggered it
//   library_auto_push_skipped  why not (a missing tag, no content, no final version yet)
//   library_auto_push_failed   an unexpected error
//
// Triggers: the signing that completes the chain; the late v1.0 snapshot (when the snapshot failed at signing
// and is made when the signatures are next listed); and opening the Final Document of a document that was
// signed before this existed and isn't in the library yet (backfill — the manual push button is gone).
//
// The manual POST /library/push uses the same pushDocumentToLibrary below.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { requireAuth } from '../../../auth/rbac.js'
import { compareSections } from '../../clinical-writing/documents/service.js'
import { resolveTa } from '../taxonomy/validate.js'
import { htmlToPlainText } from './plain-text.js'
import type { SectionRow } from './shape.js'

export const AUTO_PUSH_ACTOR = 'system:auto-push'
export const AUTO_PUSH_MODULE = 'A'
const FINAL_VERSION = 'v1.0'
// After this many logged failures for one version the page stops retrying (each retry is audited).
const MAX_FAILED_ATTEMPTS = 3

export type AutoPushTrigger = 'signing' | 'late_final_version' | 'backfill'

/** The Master Library document-type tag for a Clinical Writing document type, or null when there is none. */
export function libraryDocType(type: string | null | undefined): string | null {
  const t = (type ?? '').trim().toLowerCase().replace(/_/g, '-')
  const map: Record<string, string> = {
    'csr-full': 'CSR', 'csr-synopsis': 'CSR', 'csr': 'CSR',
    'protocol': 'Protocol', 'protocol-amendment': 'Protocol',
    'ib': 'IB', 'icf': 'ICF', 'dsur': 'DSUR',
    'safety-narrative': 'Safety Narrative', 'patient-narrative': 'Patient Narrative',
    'end-of-study-summary': 'End-of-Study Summary',
  }
  return map[t] ?? null
}

type DocForPush = {
  id: string; title: string; projectId: string
  currentVersion: { versionNumber: string; sections: Array<{ sectionId: string; sectionNumber: string; sectionTitle: string; contentHtml: string }> } | null
}

// Thrown inside the push transaction when the same document version turns out to be in the library already.
class AlreadyInLibrary extends Error { constructor(readonly entry: SectionRow) { super('already_in_library') } }

export type PushOutcome =
  | { status: 'created'; created: SectionRow; earlier: SectionRow | null; documentVersion: string }
  | { status: 'already'; entry: SectionRow; documentVersion: string }
  | { status: 'empty'; documentVersion: string }

/**
 * Push a whole document version into the library (shared by the manual route and the auto-push). Idempotent:
 * a version already in the library is never added again — checked again under a per-document advisory lock, so
 * two pushes at the same moment (a retry, two tabs) can't both create an entry. A later version supersedes the
 * earlier entry.
 */
export async function pushDocumentToLibrary(
  prisma: PrismaClient,
  p: { doc: DocForPush; taTag: string; module: string; docType: string; tenantId: string | null; approvedBy: string; fallbackVersion?: string },
): Promise<PushOutcome> {
  const { doc } = p
  const sections = [...(doc.currentVersion?.sections ?? [])].sort(compareSections)
  const documentVersion = doc.currentVersion?.versionNumber ?? p.fallbackVersion ?? ''
  const body = sections.filter(s => htmlToPlainText(s.contentHtml)).map(s => `${s.sectionNumber} ${s.sectionTitle}\n${htmlToPlainText(s.contentHtml)}`).join('\n\n')
  if (!body) return { status: 'empty', documentVersion }

  const sourceTag = `source:${doc.id}`
  const tags = [
    `module:${p.module}`, `doctype:${p.docType}`, `project:${doc.projectId}`, sourceTag, `fromdoc:${doc.id}`, `docversion:${documentVersion}`,
    'type:document',
  ]
  const current = (tx: Pick<PrismaClient, 'librarySection'>) =>
    tx.librarySection.findFirst({ where: { tenantId: p.tenantId, isCurrent: true, retiredAt: null, tags: { has: sourceTag } } })

  const quick = await current(prisma)
  if (quick?.tags.includes(`docversion:${documentVersion}`)) return { status: 'already', entry: quick, documentVersion }
  try {
    const { created, earlier } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`library-push:${p.tenantId ?? 'platform'}:${sourceTag}`}))`
      const prior = await current(tx)
      if (prior?.tags.includes(`docversion:${documentVersion}`)) throw new AlreadyInLibrary(prior)
      const next = await tx.librarySection.create({
        data: { tenantId: p.tenantId, taTag: p.taTag, tags, body, title: doc.title, framework: p.docType, category: 'claim', version: (prior?.version ?? 0) + 1, approvedBy: p.approvedBy },
      })
      if (prior) await tx.librarySection.update({ where: { id: prior.id }, data: { isCurrent: false, supersededBy: next.id } })
      return { created: next, earlier: prior }
    })
    return { status: 'created', created, earlier, documentVersion }
  } catch (err) {
    if (err instanceof AlreadyInLibrary) return { status: 'already', entry: err.entry, documentVersion }
    throw err
  }
}

export type AutoPushResult =
  | { state: 'pushed'; libraryItemId: string; created: boolean }
  | { state: 'skipped'; reason: string; missing?: string[] }
  | { state: 'failed'; reason: string }
  | { state: 'not_signed' }
  | { state: 'waiting' }       // signed, but the final v1.0 snapshot isn't made yet (it will be, then pushed)

type AuditLike = Pick<FastifyInstance['audit'], 'append' | 'pageForEntity'>
type AppLike = { prisma: PrismaClient; audit: AuditLike; log: Pick<FastifyInstance['log'], 'warn' | 'error'> }

/** A completed signature chain whose v1.0 snapshot isn't made yet. */
async function waitingForFinalSnapshot(prisma: PrismaClient, documentId: string): Promise<boolean> {
  const [chain, final] = await Promise.all([
    prisma.signatureChain.findFirst({ where: { documentId, status: 'complete' }, select: { id: true } }),
    prisma.documentVersion.findFirst({ where: { documentId, versionNumber: FINAL_VERSION }, select: { id: true } }),
  ])
  return !!chain && !final
}

async function loggedFor(audit: AuditLike, documentId: string, action: string, documentVersion: string) {
  const page = await audit.pageForEntity('document', documentId, { action, limit: 50 })
  return page.rows.filter(r => (r.details as { documentVersion?: unknown } | null)?.documentVersion === documentVersion)
}

/**
 * Push a signed document to the library, if it isn't there already. Never throws — the caller is signing, or
 * showing a page; a problem is logged (and audited) and reported in the result.
 */
export async function autoPushSignedDocument(
  app: AppLike,
  documentId: string,
  opts: { trigger: AutoPushTrigger; signedBy?: string | null; ipAddress?: string | null },
): Promise<AutoPushResult> {
  const audit = (action: string, details: Record<string, unknown>) => app.audit.append({
    timestamp: new Date().toISOString(), actorId: AUTO_PUSH_ACTOR, action, entityType: 'document', entityId: documentId,
    details: { trigger: opts.trigger, ...(opts.signedBy && { signedBy: opts.signedBy }), ...details },
    ipAddress: opts.ipAddress ?? null,
  })
  let documentVersion = ''
  try {
    const doc = await app.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      include: { currentVersion: { include: { sections: true } } },
    })
    if (!doc || doc.status !== 'signed') return { state: 'not_signed' }
    documentVersion = doc.currentVersion?.versionNumber ?? ''

    // The final snapshot goes in (v1.0, made when the chain completes). If the chain completed but the snapshot
    // failed, wait: it is made later and the push happens then — logged once, so the trail says why nothing is
    // in the library yet. (Documents signed another way, e.g. seeded ones ending on v1.4, go in as they are.)
    if (documentVersion !== FINAL_VERSION && await waitingForFinalSnapshot(app.prisma, documentId)) {
      if (opts.trigger === 'signing' && !(await loggedFor(app.audit, documentId, 'library_auto_push_skipped', documentVersion)).length) {
        await audit('library_auto_push_skipped', { documentVersion, reason: 'final_version_missing', message: 'The final v1.0 version was not created at signing; the push happens once it is.' })
      }
      return { state: 'waiting' }
    }

    // A skip, or too many failures, for this version is final: don't retry (and re-log) on every page view.
    if (opts.trigger === 'backfill') {
      const skipped = (await loggedFor(app.audit, documentId, 'library_auto_push_skipped', documentVersion))[0]
      if (skipped) {
        const d = skipped.details as { reason?: string; missing?: string[] }
        return { state: 'skipped', reason: d.reason ?? 'unknown', ...(d.missing && { missing: d.missing }) }
      }
      const failures = await loggedFor(app.audit, documentId, 'library_auto_push_failed', documentVersion)
      if (failures.length >= MAX_FAILED_ATTEMPTS) return { state: 'failed', reason: String((failures[0]!.details as { reason?: unknown }).reason ?? 'unknown') }
    }

    // The four mandatory tags, from the document itself.
    const taTag = doc.therapeuticArea ? await resolveTa(app.prisma, doc.therapeuticArea) : null
    const docType = libraryDocType(doc.type)
    const missing = [
      ...(!taTag ? ['therapeutic_area'] : []),
      ...(!docType ? ['document_type'] : []),
      ...(!documentVersion ? ['version'] : []),
    ]
    const tags = { therapeuticArea: taTag ?? doc.therapeuticArea ?? null, module: AUTO_PUSH_MODULE, documentType: docType, version: documentVersion }
    if (missing.length) {
      await audit('library_auto_push_skipped', { documentVersion, reason: 'missing_tags', missing, tags, documentType: doc.type })
      return { state: 'skipped', reason: 'missing_tags', missing }
    }

    const project = await app.prisma.project.findUnique({ where: { id: doc.projectId }, select: { tenantId: true } })
    // The library entry's "pushed by": whoever completed the signing — for a backfill, the last signer on record.
    const lastSigner = opts.signedBy ? null : await app.prisma.signatureRecord.findFirst({
      where: { status: 'signed', chain: { is: { documentId, status: 'complete' } } },
      orderBy: { timestampUtc: 'desc' },
      select: { signerId: true },
    })
    const outcome = await pushDocumentToLibrary(app.prisma, {
      doc, taTag: taTag!, module: AUTO_PUSH_MODULE, docType: docType!,
      tenantId: project?.tenantId ?? null,
      approvedBy: opts.signedBy ?? lastSigner?.signerId ?? AUTO_PUSH_ACTOR,
    })
    if (outcome.status === 'already') return { state: 'pushed', libraryItemId: outcome.entry.id, created: false }
    if (outcome.status === 'empty') {
      await audit('library_auto_push_skipped', { documentVersion, reason: 'no_content', tags })
      return { state: 'skipped', reason: 'no_content' }
    }
    await audit('library_auto_pushed', {
      documentVersion, libraryItemId: outcome.created.id, libraryVersion: outcome.created.version, tags,
      ...(outcome.earlier && { supersedes: outcome.earlier.id }),
    })
    return { state: 'pushed', libraryItemId: outcome.created.id, created: true }
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 300) : String(err)
    app.log.error({ err, documentId, trigger: opts.trigger }, 'auto-push to the Master Library failed')
    try { await audit('library_auto_push_failed', { documentVersion, reason }) } catch (auditErr) {
      app.log.error({ err: auditErr, documentId }, 'auto-push failure could not be audited')
    }
    return { state: 'failed', reason }
  }
}

// GET /library/auto-push/:documentId — what happened to this document's library push, for the Final Document
// page: in the library (with the entry), skipped (why), failed, waiting, or not signed. A signed document that
// isn't in the library and has no recorded skip is pushed now (backfill for documents signed before
// auto-push existed). Same visibility as the document (the app-wide :documentId hook).
export const libraryAutoPushRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auto-push/:documentId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: { id: true, status: true, projectId: true, currentVersion: { select: { versionNumber: true } } },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    if (doc.status !== 'signed') return { state: 'not_signed' }
    const documentVersion = doc.currentVersion?.versionNumber ?? null

    const entryFor = () => app.prisma.librarySection.findFirst({
      where: { isCurrent: true, retiredAt: null, tags: { has: `fromdoc:${documentId}` }, ...(documentVersion && { AND: [{ tags: { has: `docversion:${documentVersion}` } }] }) },
      orderBy: { approvedAt: 'desc' },
      select: { id: true, approvedAt: true, version: true },
    })
    const shape = (e: { id: string; approvedAt: Date; version: number }) => ({
      state: 'pushed' as const, entry: { id: e.id, addedAt: e.approvedAt.toISOString(), libraryVersion: `v${e.version}.0`, documentVersion },
    })

    const existing = await entryFor()
    if (existing) return shape(existing)

    const result = await autoPushSignedDocument(app, documentId, { trigger: 'backfill', ipAddress: request.ip ?? null })
    if (result.state === 'pushed') {
      const entry = await entryFor()
      if (entry) return shape(entry)
    }
    if (result.state === 'skipped' || result.state === 'failed') {
      const action = result.state === 'skipped' ? 'library_auto_push_skipped' : 'library_auto_push_failed'
      const row = (await app.audit.pageForEntity('document', documentId, { action, limit: 1 })).rows[0]
      return { ...result, at: row ? new Date(row.timestamp).toISOString() : null, documentVersion }
    }
    return { state: result.state, documentVersion }
  })
}
