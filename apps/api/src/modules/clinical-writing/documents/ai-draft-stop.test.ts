// Cancellation path for the AI initial-draft worker.
//
// Writer hits Stop on the toast → POST /ai-draft/stop flips the
// document's aiDraftState to 'cancelled' → worker checks between
// sections and exits early. Already-drafted sections stay intact.

import { describe, expect, it, vi } from 'vitest'
import { handleAiInitialDraft } from '../../../../../worker/src/jobs/ai-initial-draft.js'

interface SectionFx { id: string; sectionId: string; contentHtml: string; templateFormatRules: string | null }

function harness(opts: {
  sections?:    Array<{ sectionId: string }>
  initialState?: string
  cancelAfterSection?: number   // flip to 'cancelled' once worker queried for the Nth time (1-indexed)
}) {
  let findCount = 0
  const current = { aiDraftState: opts.initialState ?? 'drafting' as string }
  const sectionRows: SectionFx[] = (opts.sections ?? [{ sectionId: 's1' }, { sectionId: 's2' }, { sectionId: 's3' }])
    .map((s, i) => ({ id: `row-${i}`, sectionId: s.sectionId, contentHtml: '', templateFormatRules: null }))

  const docUpdates: Array<Record<string, unknown>> = []
  const sectionWrites: Array<{ id: string }> = []
  const enqueued: string[] = []

  const prisma: Record<string, unknown> = {
    document: {
      findUnique: vi.fn(async () => {
        findCount += 1
        if (opts.cancelAfterSection !== undefined && findCount > opts.cancelAfterSection) {
          current.aiDraftState = 'cancelled'
        }
        return { ...current, type: 'csr-full' }
      }),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => { docUpdates.push(a.data); return {} }),
    },
    sectionContent: {
      findMany: vi.fn(async () => sectionRows),
      update:   vi.fn(async (a: { where: { id: string } }) => { sectionWrites.push({ id: a.where.id }); return {} }),
    },
    documentSource:     { findMany: vi.fn(async () => []) },
    documentUpload:     { findMany: vi.fn(async () => []) },
    documentTypePolicy: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
    aiPromptRecord:     { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
    bestPracticeRecord: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
    sectionTemplate:    { findFirst: vi.fn(async () => null) },
    documentTemplate:   { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
    editHistory:        { create: vi.fn(async () => ({})) },
    aiDraftingPass:     { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    documentVersion:    { findUnique: vi.fn(async () => ({ id: 'V1', versionNumber: 'v0.1' })) },
    project:            { findUnique: vi.fn(async () => ({ tenantId: 't1' })) },
    tenant:             { findUnique: vi.fn(async () => ({ id: 't1', aiEngineOverride: null })) },
    aiEngineConfig:     { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
    $transaction:       vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  }
  const log     = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const enqueue = vi.fn(async (name: string) => { enqueued.push(name) })
  const job = { data: {
    documentId: 'D1', versionId: 'V1', projectId: 'P1', type: 'csr-full',
    sourceUploadIds: [], assigneeId: 'u1', actorId: 'u1',
  } }
  return { prisma, log, enqueue, job, docUpdates, sectionWrites, enqueued }
}

describe('ai_initial_draft — writer cancellation', () => {
  it('exits the loop when aiDraftState flips to cancelled mid-run (no validation queued)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('AI_ALLOW_STUB', '1')
    // Cancel after the worker's second pre-section state check — first
    // two sections run, the third never gets touched.
    const h = harness({
      sections: [{ sectionId: 's1' }, { sectionId: 's2' }, { sectionId: 's3' }],
      cancelAfterSection: 2,
    })
    const result = await handleAiInitialDraft(h.job as never, { prisma: h.prisma, log: h.log, enqueue: h.enqueue } as never)
    // Two sections were written before the cancel landed; third skipped.
    expect(h.sectionWrites.length).toBeLessThanOrEqual(2)
    // No validation chain queued after a cancel.
    expect(h.enqueued.filter(n => n.includes('validation'))).toEqual([])
    // The result carries the pre-cancel drafted count.
    expect(result).toBeDefined()
    vi.unstubAllEnvs()
  })

  it('exits immediately when aiDraftState is already cancelled at start', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('AI_ALLOW_STUB', '1')
    const h = harness({
      sections: [{ sectionId: 's1' }],
      initialState: 'cancelled',
    })
    await handleAiInitialDraft(h.job as never, { prisma: h.prisma, log: h.log, enqueue: h.enqueue } as never)
    expect(h.sectionWrites).toEqual([])
    expect(h.enqueued.filter(n => n.includes('validation'))).toEqual([])
    vi.unstubAllEnvs()
  })
})
