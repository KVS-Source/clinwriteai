// The first-draft worker, with no AI set up: sections are left empty, the document is marked
// "not_configured", and the validation pass is not queued. (The worker has no test runner of its
// own, so this imports its handler the same way section-hash-parity.test.ts does.)

import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleAiInitialDraft } from '../../../../../worker/src/jobs/ai-initial-draft.js'

afterEach(() => vi.unstubAllEnvs())

function harness() {
  const docUpdates: Array<Record<string, unknown>> = []
  const sectionWrites: unknown[] = []
  const enqueued: string[] = []
  const prisma = {
    document:       { update: vi.fn(async (a: { data: Record<string, unknown> }) => { docUpdates.push(a.data); return {} }) },
    sectionContent: { update: vi.fn(async (a: unknown) => { sectionWrites.push(a); return {} }) },
  }
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const enqueue = vi.fn(async (name: string) => { enqueued.push(name) })
  const job = { data: { documentId: 'D1', versionId: 'V1', projectId: 'P1', type: 'csr-full', sourceUploadIds: [], assigneeId: 'u1', actorId: 'u1' } }
  return { prisma, log, enqueue, job, docUpdates, sectionWrites, enqueued }
}

describe('ai_initial_draft with no AI configured', () => {
  it('writes nothing to any section, marks the document not_configured, and queues no validation', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('AI_ALLOW_STUB', '')
    const h = harness()
    const result = await handleAiInitialDraft(h.job as never, { prisma: h.prisma, log: h.log, enqueue: h.enqueue } as never)
    expect(result).toEqual({ skipped: 'ai_not_configured' })
    expect(h.sectionWrites).toEqual([])
    expect(h.enqueued).toEqual([])
    expect(h.docUpdates).toEqual([{ aiDraftState: 'not_configured' }])
  })
})
