import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { DocumentService, highestVersion } from './service.js'

// Minimal in-memory tx double for DocumentService.updateSection.
function fakePrisma(opts: { allVersions: string[]; currentVersion: string }) {
  const calls: string[] = []
  const flagClears: Array<{ where: Record<string, unknown> }> = []
  const created: Array<{ versionNumber: string; sections: { create: Array<{ sectionId: string; contentHtml: string }> } }> = []
  const sections = [
    { id: 'row-uuid-1', sectionId: 'sae1', sectionNumber: '§1', sectionTitle: 'Case Identification', contentHtml: '<p>a</p>', ichStatus: 'complete' },
    { id: 'row-uuid-4', sectionId: 'sae4', sectionNumber: '§4', sectionTitle: 'Relevant Laboratory Data', contentHtml: '<p>old</p>', ichStatus: 'in_progress' },
  ]
  const tx = {
    document: {
      findUnique: async () => ({ id: 'DOC-005', status: 'in_review', currentVersion: { id: 'ver-cur', versionNumber: opts.currentVersion, sections } }),
      update: async () => ({}),
    },
    $executeRaw: async () => { calls.push('lock'); return 1 },
    documentVersion: {
      updateMany: async (args: { where: Record<string, unknown> }) => { calls.push('clear-flags'); flagClears.push(args); return { count: 1 } },
      findMany: async () => opts.allVersions.map(versionNumber => ({ versionNumber })),
      create: async ({ data }: { data: (typeof created)[number] }) => { calls.push('create-version'); created.push(data); return { id: 'ver-new', ...data } },
    },
    provenanceRecord: { create: async () => ({}) },
  }
  const prisma = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
  return { prisma, created, calls, flagClears }
}

describe('DocumentService.updateSection', () => {
  it('updates the existing section when the client sends its row uuid (no new section)', async () => {
    const { prisma, created } = fakePrisma({ allVersions: ['v0.2'], currentVersion: 'v0.2' })
    await new DocumentService(prisma).updateSection({ documentId: 'DOC-005', sectionId: 'row-uuid-4', contentHtml: '<p>new</p>', editorUserId: 'u1' })

    const next = created[0].sections.create
    expect(next).toHaveLength(2)
    expect(next.find(s => s.sectionId === 'sae4')?.contentHtml).toBe('<p>new</p>')
    expect(next.some(s => s.sectionId === 'row-uuid-4')).toBe(false)
  })

  it('bumps from the highest existing version even if the current pointer is stale', async () => {
    const { prisma, created } = fakePrisma({ allVersions: ['v0.1', 'v0.3', 'v0.4'], currentVersion: 'v0.3' })
    await new DocumentService(prisma).updateSection({ documentId: 'DOC-005', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1' })
    expect(created[0].versionNumber).toBe('v0.5')
  })
})

describe('DocumentService.updateSection — concurrency + stale pointer', () => {
  it('takes the per-document advisory lock before reading or writing', async () => {
    const { prisma, calls } = fakePrisma({ allVersions: ['v0.2'], currentVersion: 'v0.2' })
    await new DocumentService(prisma).updateSection({ documentId: 'DOC-005', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1' })
    expect(calls[0]).toBe('lock')
  })

  it('clears the current flag on every version of the document, not just the pointed-at one', async () => {
    // DOC-008 shape: pointer on v0.3 while v0.4 is flagged current.
    const { prisma, flagClears, calls } = fakePrisma({ allVersions: ['v0.1', 'v0.2', 'v0.3', 'v0.4'], currentVersion: 'v0.3' })
    await new DocumentService(prisma).updateSection({ documentId: 'DOC-008', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1' })
    expect(flagClears[0].where).toEqual({ documentId: 'DOC-005', isCurrent: true })
    expect(calls.indexOf('clear-flags')).toBeLessThan(calls.indexOf('create-version'))
  })

  it('saves successfully against a stale pointer instead of colliding on the version number', async () => {
    const { prisma, created } = fakePrisma({ allVersions: ['v0.1', 'v0.2', 'v0.3', 'v0.4'], currentVersion: 'v0.3' })
    const result = await new DocumentService(prisma).updateSection({ documentId: 'DOC-008', sectionId: 'sae4', contentHtml: '<p>new</p>', editorUserId: 'u1' })
    expect(result.created).toBe(true)
    expect(created[0].versionNumber).toBe('v0.5')   // not v0.4 (would violate the unique key)
  })
})

describe('highestVersion', () => {
  it('compares numerically, not as strings', () => {
    expect(highestVersion(['v0.9', 'v0.10', 'v0.2'], 'v0.1')).toBe('v0.10')
    expect(highestVersion([], 'v0.1')).toBe('v0.1')
  })
})
