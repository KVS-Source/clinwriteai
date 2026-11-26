// A re-draft fired by the validation loop queues the loop's next pass itself, when it ends, so the pass checks the
// re-written text (it used to be queued alongside the re-draft and ran on the old text). Not after Pause or Stop.
// Uses the no-AI path, the shortest way through the handler. (The worker has no test runner of its own.)

import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleAiInitialDraft } from '../../../../../worker/src/jobs/ai-initial-draft.js'

afterEach(() => vi.unstubAllEnvs())

function harness(state: string, data: Record<string, unknown>) {
  const enqueued: Array<{ name: string; data: Record<string, unknown>; opts: unknown }> = []
  const docUpdates: Array<Record<string, unknown>> = []
  const prisma = {
    document: {
      update:     vi.fn(async (a: { data: Record<string, unknown> }) => { docUpdates.push(a.data); return {} }),
      findUnique: vi.fn(async () => ({ aiDraftState: state })),
    },
  }
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const enqueue = vi.fn(async (name: string, d: Record<string, unknown>, opts: unknown) => { enqueued.push({ name, data: d, opts }) })
  const job = { data: { documentId: 'D1', versionId: 'V1', projectId: 'P1', type: 'protocol', sourceUploadIds: [], assigneeId: 'u1', actorId: 'u1', ...data } }
  const run = () => handleAiInitialDraft(job as never, { prisma, log, enqueue } as never)
  return { run, enqueued, docUpdates }
}

describe('targeted re-draft → next validation pass', () => {
  it('queues the next pass when the re-draft ends', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('AI_ALLOW_STUB', '')
    const h = harness('validating', { targetSectionIds: ['s3_1'], nextIteration: 3 })
    await h.run()
    expect(h.enqueued).toEqual([{
      name: 'clinical.ai_validation_pass',
      data: expect.objectContaining({ documentId: 'D1', versionId: 'V1', iteration: 3 }),
      opts: { delayMs: 2_000, jobId: 'ai-validation-D1-3' },
    }])
    expect(h.docUpdates).toEqual([])                       // the state stays "validating"
  })

  it('queues nothing after Pause or Stop, or for a full draft without a pass to queue', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('AI_ALLOW_STUB', '')
    for (const state of ['paused', 'cancelled']) {
      const h = harness(state, { targetSectionIds: ['s3_1'], nextIteration: 2 })
      await h.run()
      expect(h.enqueued).toEqual([])
    }
    const old = harness('validating', { targetSectionIds: ['s3_1'] })   // queued before this change: its pass is queued already
    await old.run()
    expect(old.enqueued).toEqual([])
  })
})
