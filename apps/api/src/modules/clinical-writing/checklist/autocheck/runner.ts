// Autocheck runner — extracted from r-actions.ts so the HTTP endpoint
// AND the section-save hook can share the same path.
//
// Signature:
//   runAutocheckForDocument(prisma, { documentId, triggeredBy, audit? })
//     → { evaluated, flipped, items: [{ itemId, tag, kind, reason }] }
//
// Does NOT care who the caller is beyond stamping triggeredBy on audit
// events. The section-save hook passes a system actor id; the HTTP
// endpoint passes request.user.id. The runner always writes
// completedBy='system:autocheck' on flipped items so audit downstream
// can distinguish auto-ticks from manual ones.
//
// Resilient to missing prerequisites: no checklist instance → no-op
// (returns zero counts). No current version → empty sections context,
// which still fires the engine (strategies mark everything 'pending' or
// 'skipped' which is the correct answer).

import type { PrismaClient } from '@prisma/client'
import {
  emptyAiPassContext,
  emptyReferencesContext,
  emptySignalContext,
  evaluateItems as evaluateAutoCheck,
  type AiPassContext,
  type ItemForAutoCheck,
  type ReferencesContext,
  type SignalContext,
} from './engine.js'
import type { SectionContentForCheck } from './content-strategies.js'
import { getAllAiPassResultsForDocument } from './ai-pass-cache.js'

// Minimal audit-service shape — only the append method is used. The
// return value is ignored (the real repo returns { id, rowHash } but
// the runner doesn't care).
interface AuditAppender {
  append(event: {
    timestamp:  string
    actorId:    string
    action:     string
    entityType: string
    entityId:   string
    details:    Record<string, unknown>
    ipAddress:  string | null
  }): Promise<unknown>
}

export interface RunAutocheckArgs {
  documentId: string
  /** User id to record on audit events (not stamped on completedBy — that stays 'system:autocheck'). */
  triggeredBy: string
  /** Optional audit service; when omitted no audit events are emitted (useful in tests). */
  audit?: AuditAppender
}

export interface AutocheckRunResult {
  evaluated: number
  flipped: number
  items: Array<{
    itemId: string
    tag:    string
    kind:   'completed' | 'pending' | 'skipped'
    reason: string
  }>
}

export async function runAutocheckForDocument(
  prisma: PrismaClient,
  args: RunAutocheckArgs,
): Promise<AutocheckRunResult> {
  const { documentId, triggeredBy } = args

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, projectId: true, currentVersionId: true },
  })
  if (!doc) return { evaluated: 0, flipped: 0, items: [] }

  const instance = await prisma.checklistInstance.findUnique({
    where: { documentId },
    include: {
      items: {
        select: { id: true, autoCompleteOn: true, status: true, text: true, framework: true },
      },
    },
  })
  if (!instance) return { evaluated: 0, flipped: 0, items: [] }

  // Section content for the current version. Empty when no version yet;
  // engine handles it correctly.
  const sections: SectionContentForCheck[] = doc.currentVersionId
    ? (await prisma.sectionContent.findMany({
        where:  { documentVersionId: doc.currentVersionId },
        select: { sectionId: true, sectionNumber: true, contentHtml: true, wordCount: true },
      }))
    : []

  // References context — only fetched when a references-complete item exists.
  const hasReferencesItem = instance.items.some(i => (i.autoCompleteOn ?? '').toLowerCase().startsWith('references-complete'))
  const references: ReferencesContext = emptyReferencesContext()
  if (hasReferencesItem) {
    const [refs, removals] = await Promise.all([
      prisma.sourceReference.findMany({
        where: { documentId },
        select: { id: true, sectionId: true },
      }),
      prisma.sourceReferenceRemoval.findMany({
        where: { documentId },
        select: { referenceId: true },
      }),
    ])
    const removedIds = new Set(removals.map(r => r.referenceId))
    for (const r of refs) {
      if (removedIds.has(r.id)) continue
      references[r.sectionId] = (references[r.sectionId] ?? 0) + 1
    }
  }

  // Signal context — only when a signal:* item exists.
  const hasSignalItem = instance.items.some(i => (i.autoCompleteOn ?? '').toLowerCase().startsWith('signal:'))
  let signals: SignalContext = emptySignalContext()
  if (hasSignalItem) {
    const [tlfCurrent, signatures, crmMeetings] = await Promise.all([
      prisma.tlfPackage.findFirst({ where: { projectId: doc.projectId, isCurrent: true }, select: { id: true } }),
      prisma.signatureRecord.findMany({ where: { chain: { documentId }, status: 'signed' }, select: { meaning: true } }),
      prisma.crmMeeting.findMany({ where: { documentId }, select: { status: true } }),
    ])
    signals = {
      tlfPackageValidated: tlfCurrent !== null,
      signatureMeanings:   signatures.map(s => s.meaning.toLowerCase()),
      crmMeetingsComplete: crmMeetings.length > 0 && crmMeetings.every(m => m.status === 'complete'),
      crmMeetingCount:     crmMeetings.length,
    }
  }

  // AI pass context — reads only from the in-process cache (gateway
  // calls live on the dedicated /ai-pass endpoint).
  const hasAiPassItem = instance.items.some(i => (i.autoCompleteOn ?? '').toLowerCase().startsWith('ai-pass:'))
  const aiPass: AiPassContext = hasAiPassItem
    ? getAllAiPassResultsForDocument(documentId, doc.currentVersionId)
    : emptyAiPassContext()

  const items = instance.items as unknown as ItemForAutoCheck[]
  const evaluations = evaluateAutoCheck(items, sections, signals, aiPass, references)
  const toFlip = evaluations.filter(e => e.shouldComplete)

  const result: AutocheckRunResult = {
    evaluated: evaluations.length,
    flipped:   toFlip.length,
    items:     evaluations.map(e => ({
      itemId: e.itemId,
      tag:    e.tag,
      kind:   e.result.kind,
      reason: e.result.reason,
    })),
  }

  if (toFlip.length === 0) return result

  const now = new Date()
  await Promise.all(toFlip.map(e =>
    prisma.checklistInstanceItem.update({
      where: { id: e.itemId },
      data:  {
        status:      'complete',
        completedBy: 'system:autocheck',
        completedAt: now,
      },
    }),
  ))

  if (args.audit) {
    for (const e of toFlip) {
      const item = instance.items.find(i => i.id === e.itemId)
      await args.audit.append({
        timestamp:  now.toISOString(),
        actorId:    'system:autocheck',
        action:     'checklist_item_completed',
        entityType: 'document',
        entityId:   documentId,
        details: {
          itemId:    e.itemId,
          framework: item?.framework ?? null,
          text:      item?.text ?? null,
          source:    'auto',
          strategy:  e.tag,
          reason:    e.result.kind === 'completed' ? e.result.reason : null,
          triggeredBy,
        },
        ipAddress: null,
      })
    }
  }

  return result
}
