// Uploads can sit in either store (the server's disk or S3): a file missing from one is read from the other, and an
// AI draft whose sources can't be read stops instead of writing from general knowledge.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FallbackBlobReader, type BlobReader } from '../../../../../worker/src/blob-reader.js'
import { handleAiInitialDraft } from '../../../../../worker/src/jobs/ai-initial-draft.js'
import { getWithFallback } from './plugin.js'

const state = vi.hoisted(() => ({ read: vi.fn(), steps: [] as string[] }))
vi.mock('../../../../../worker/src/blob-reader.js', async (original) => ({
  ...(await original<object>()), createBlobReaderFromEnv: () => ({ read: state.read }),
}))
vi.mock('../../../../../worker/src/jobs/resolve-anthropic-key.js', () => ({ resolveAnthropicKey: async () => 'k' }))
vi.mock('../../../../../worker/src/ai-engine-settings.js', () => ({ resolveDraftModel: async () => 'm' }))
vi.mock('../../../../../worker/src/jobs/policy-prompt.js', () => ({
  resolveForDocument: async () => null, renderPolicyPromptBlock: () => '', SECTION_GROUNDING_RULES: '',
}))
vi.mock('../../../../../worker/src/jobs/ai-draft-step.js', () => ({
  createStepLogger: () => ({ emit: async (kind: string, message: string) => { state.steps.push(`${kind}: ${message}`) } }),
}))

const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
const noKey = Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
const down = new Error('connect ECONNREFUSED')
const ok = (v: string) => async () => ({ bytes: Buffer.from(v), contentType: null })
const fail = (e: Error) => async () => { throw e }
const read = (a: BlobReader['read'], b: BlobReader['read']) => new FallbackBlobReader({ read: a }, { read: b }).read('documents', 'k')

describe('reading from either store', () => {
  it('worker: the first store wins; a file missing there comes from the other', async () => {
    expect(String((await read(ok('first'), ok('second'))).bytes)).toBe('first')
    expect(String((await read(fail(enoent), ok('second'))).bytes)).toBe('second')
    expect(String((await read(fail(noKey), ok('second'))).bytes)).toBe('second')
  })
  it('worker: missing in both reports the first; an outage is never taken for a missing file', async () => {
    await expect(read(fail(enoent), fail(noKey))).rejects.toBe(enoent)
    await expect(read(fail(down), ok('second'))).rejects.toBe(down)
    await expect(read(fail(enoent), fail(down))).rejects.toBe(down)
  })
  it('API: the same rules', async () => {
    const file = async () => ({ body: Buffer.from('x'), contentType: null, size: 1 })
    expect((await getWithFallback(fail(enoent), file)('documents', 'k')).size).toBe(1)
    await expect(getWithFallback(fail(enoent), fail(noKey))('documents', 'k')).rejects.toBe(enoent)
    await expect(getWithFallback(fail(down), file)('documents', 'k')).rejects.toBe(down)
  })
})

describe('a draft whose source cannot be read', () => {
  const update = vi.fn(async (_args: { data: { aiDraftState: string } }) => ({}))
  const sections = vi.fn(async () => [])
  const enqueue = vi.fn()
  const run = (targetSectionIds?: string[]) => handleAiInitialDraft(
    { data: { documentId: 'd', versionId: 'v', projectId: 'p', type: 'protocol', sourceUploadIds: ['a', 'b'], assigneeId: 'u', actorId: 'u', targetSectionIds } } as never,
    {
      prisma: {
        document: { update, findUnique: async () => ({ aiDraftState: 'drafting' }) },
        project: { findUnique: async () => null },
        documentTemplate: { findFirst: async () => ({ sections: [{ id: 's1', number: '1', title: 'One' }] }) },
        documentUpload: {
          findMany: async () => ['a', 'b'].map(id => ({
            id, title: `Doc ${id}`, fileName: 'f.pdf', sourceCategory: null, blobKey: id, contentType: 'application/pdf',
          })),
        },
        sectionContent: { findMany: sections },
        documentSource: { findMany: async () => [] },
      },
      log: { info() {}, warn() {}, error() {} },
      enqueue,
    } as never)
  beforeEach(() => { vi.clearAllMocks(); state.steps.length = 0 })

  it('stops before any section, is marked failed, and names the file', async () => {
    state.read.mockImplementation(async (_b: string, k: string) => {
      if (k === 'b') throw enoent
      return { bytes: Buffer.from('x'), contentType: null }
    })
    expect(await run()).toEqual({ skipped: 'sources_unreadable', unreadable: ['Doc b'] })
    expect(sections).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
    expect(update.mock.calls.at(-1)![0].data).toEqual({ aiDraftState: 'failed' })
    expect(state.steps.at(-1)).toMatch(/1 of 2 source documents could not be read: Doc b/)
  })
  it('a targeted re-draft leaves the text and the draft state alone', async () => {
    state.read.mockRejectedValue(enoent)
    expect(await run(['s1'])).toMatchObject({ skipped: 'sources_unreadable' })
    expect(update).not.toHaveBeenCalled()
    expect(sections).not.toHaveBeenCalled()
  })
  it('readable sources go on to drafting as before', async () => {
    state.read.mockResolvedValue({ bytes: Buffer.from('x'), contentType: null })
    await run()
    expect(sections).toHaveBeenCalled()
  })
})
