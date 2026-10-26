import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { DocumentService, highestVersion } from './service.js'

// Fake Prisma for DocumentService tests. Covers the surface the service hits
// across both updateSection (in-place path + sealed safety-net path) and
// createVersionSnapshot. Captures section mutations, version creates, and
// provenance appends in-order so tests can assert the call sequence.
type FakeOpts = {
  allVersions:    string[]
  currentVersion: string
  /** Signed records matching the current versionNumber trigger the safety-net path. */
  sealed?:        boolean
}
function fakePrisma(opts: FakeOpts) {
  const calls: string[] = []
  const flagClears: Array<{ where: Record<string, unknown> }> = []
  const createdVersions: Array<{ versionNumber: string; sections?: { create: Array<{ sectionId: string; contentHtml: string }> } }> = []
  const sectionUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const sectionCreates: Array<{ data: Record<string, unknown> }> = []
  const versionUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const docUpdates:     Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const provenance:     Array<{ data: Record<string, unknown> }> = []

  const sections = [
    { id: 'row-uuid-1', sectionId: 'sae1', sectionNumber: '§1', sectionTitle: 'Case Identification',   contentHtml: '<p>a</p>',  ichStatus: 'complete',    wordCount: 1, lastEditedBy: null, lastEditedAt: null, aiSpanCount: 0, humanSpanCount: 0 },
    { id: 'row-uuid-4', sectionId: 'sae4', sectionNumber: '§4', sectionTitle: 'Relevant Lab Data',     contentHtml: '<p>old</p>', ichStatus: 'in_progress', wordCount: 1, lastEditedBy: null, lastEditedAt: null, aiSpanCount: 0, humanSpanCount: 0 },
  ]
  const tx = {
    document: {
      findUnique: async () => ({
        id: 'DOC-005',
        status: 'in_authoring',
        currentVersion: { id: 'ver-cur', versionNumber: opts.currentVersion, contentHash: 'old-hash', sections },
      }),
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        docUpdates.push(args); calls.push('doc-update'); return {}
      },
    },
    $executeRaw: async () => { calls.push('lock'); return 1 },
    documentVersion: {
      updateMany: async (args: { where: Record<string, unknown> }) => { calls.push('clear-flags'); flagClears.push(args); return { count: 1 } },
      update:     async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        versionUpdates.push(args); calls.push('version-update'); return { id: 'ver-cur', ...args.data }
      },
      findMany:   async () => opts.allVersions.map(versionNumber => ({ versionNumber })),
      create:     async ({ data }: { data: (typeof createdVersions)[number] }) => {
        calls.push('create-version'); createdVersions.push(data); return { id: 'ver-new', ...data }
      },
    },
    sectionContent: {
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        sectionUpdates.push(args); calls.push('section-update'); return {}
      },
      create: async (args: { data: Record<string, unknown> }) => {
        sectionCreates.push(args); calls.push('section-create'); return {}
      },
    },
    signatureRecord: {
      findFirst: async () => (opts.sealed ? { id: 'sig-1' } : null),
    },
    provenanceRecord: {
      create: async (args: { data: Record<string, unknown> }) => { provenance.push(args); calls.push('provenance'); return {} },
    },
  }
  const prisma = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
  return { prisma, calls, flagClears, createdVersions, sectionUpdates, sectionCreates, versionUpdates, docUpdates, provenance }
}

// ---------- updateSection — in-place path (default) --------------------------

describe('DocumentService.updateSection — in-place mutation (default)', () => {
  it('mutates SectionContent in place; does NOT create a new DocumentVersion', async () => {
    const { prisma, createdVersions, sectionUpdates, versionUpdates } =
      fakePrisma({ allVersions: ['v0.2'], currentVersion: 'v0.2' })
    const result = await new DocumentService(prisma).updateSection({
      documentId: 'DOC-005', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1',
    })
    expect(result.created).toBe(false)
    expect(result.mutated).toBe(true)
    expect(createdVersions).toHaveLength(0)                                             // no new version row
    expect(sectionUpdates).toHaveLength(1)                                              // one in-place section write
    expect((sectionUpdates[0].data as { contentHtml: string }).contentHtml).toBe('<p>new</p>')
    expect(versionUpdates).toHaveLength(1)                                              // version.contentHash rewritten
    expect(versionUpdates[0].data).toHaveProperty('contentHash')
  })

  it('resolves a row-uuid to the stable section key before mutating', async () => {
    const { prisma, sectionUpdates } = fakePrisma({ allVersions: ['v0.2'], currentVersion: 'v0.2' })
    await new DocumentService(prisma).updateSection({
      documentId: 'DOC-005', sectionId: 'row-uuid-4', contentHtml: '<p>new</p>', editorUserId: 'u1',
    })
    expect((sectionUpdates[0].where as { documentVersionId_sectionId: { sectionId: string } }).documentVersionId_sectionId.sectionId).toBe('sae4')
  })

  it('no-op when the HTML is unchanged — nothing is written', async () => {
    const { prisma, calls, sectionUpdates, versionUpdates } = fakePrisma({ allVersions: ['v0.2'], currentVersion: 'v0.2' })
    const result = await new DocumentService(prisma).updateSection({
      documentId: 'DOC-005', sectionId: 'sae4', contentHtml: '<p>old</p>', editorUserId: 'u1',
    })
    expect(result.created).toBe(false)
    expect(result.mutated).toBe(false)
    expect(sectionUpdates).toHaveLength(0)
    expect(versionUpdates).toHaveLength(0)
    expect(calls.filter(c => c === 'create-version')).toHaveLength(0)
  })

  it('appends a provenance record when aiDrafted is true', async () => {
    const { prisma, provenance } = fakePrisma({ allVersions: ['v0.2'], currentVersion: 'v0.2' })
    await new DocumentService(prisma).updateSection({
      documentId: 'DOC-005', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1',
      aiDrafted: true, aiModel: 'claude-sonnet-4-6',
    })
    expect(provenance).toHaveLength(1)
    expect(provenance[0].data.sourceType).toBe('ai_draft')
    expect(provenance[0].data.aiModel).toBe('claude-sonnet-4-6')
  })

  it('takes the per-document advisory lock before any read or write', async () => {
    const { prisma, calls } = fakePrisma({ allVersions: ['v0.2'], currentVersion: 'v0.2' })
    await new DocumentService(prisma).updateSection({
      documentId: 'DOC-005', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1',
    })
    expect(calls[0]).toBe('lock')
  })
})

// ---------- updateSection — sealed safety-net path ---------------------------

describe('DocumentService.updateSection — sealed safety net', () => {
  it('creates a new DocumentVersion when the current version is already signed', async () => {
    const { prisma, createdVersions, sectionUpdates } =
      fakePrisma({ allVersions: ['v0.2'], currentVersion: 'v0.2', sealed: true })
    const result = await new DocumentService(prisma).updateSection({
      documentId: 'DOC-005', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1',
    })
    expect(result.created).toBe(true)
    expect(result.mutated).toBe(false)
    expect(createdVersions).toHaveLength(1)                                             // safety net kicked in
    expect(createdVersions[0].versionNumber).toBe('v0.3')                               // bumped past current
    expect(sectionUpdates).toHaveLength(0)                                              // no in-place mutation on sealed
  })

  it('bumps from the highest existing version even if the current pointer is stale', async () => {
    const { prisma, createdVersions } =
      fakePrisma({ allVersions: ['v0.1', 'v0.3', 'v0.4'], currentVersion: 'v0.3', sealed: true })
    await new DocumentService(prisma).updateSection({
      documentId: 'DOC-005', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1',
    })
    expect(createdVersions[0].versionNumber).toBe('v0.5')
  })

  it('clears the current flag on every version before marking the new row current', async () => {
    const { prisma, flagClears, calls } =
      fakePrisma({ allVersions: ['v0.1', 'v0.2', 'v0.3', 'v0.4'], currentVersion: 'v0.3', sealed: true })
    await new DocumentService(prisma).updateSection({
      documentId: 'DOC-005', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1',
    })
    expect(flagClears[0].where).toEqual({ documentId: 'DOC-005', isCurrent: true })
    expect(calls.indexOf('clear-flags')).toBeLessThan(calls.indexOf('create-version'))
  })
})

// ---------- createVersionSnapshot (explicit + review-bounce) -----------------

describe('DocumentService.createVersionSnapshot', () => {
  it('creates a new DocumentVersion carrying the current section set + restoreSource metadata', async () => {
    const { prisma, createdVersions } = fakePrisma({ allVersions: ['v0.2'], currentVersion: 'v0.2' })
    const result = await new DocumentService(prisma).createVersionSnapshot({
      documentId: 'DOC-005', createdBy: 'u1', reason: 'review_bounce', note: 'reviewer requested rewrite',
    })
    expect(result.created).toBe(true)
    expect(createdVersions).toHaveLength(1)
    expect(createdVersions[0].versionNumber).toBe('v0.3')
    const restore = (createdVersions[0] as unknown as { restoreSource: { reason: string; note: string; fromVersionNumber: string } }).restoreSource
    expect(restore.reason).toBe('review_bounce')
    expect(restore.note).toBe('reviewer requested rewrite')
    expect(restore.fromVersionNumber).toBe('v0.2')
  })
})

describe('highestVersion', () => {
  it('compares numerically, not as strings', () => {
    expect(highestVersion(['v0.9', 'v0.10', 'v0.2'], 'v0.1')).toBe('v0.10')
    expect(highestVersion([], 'v0.1')).toBe('v0.1')
  })
})
