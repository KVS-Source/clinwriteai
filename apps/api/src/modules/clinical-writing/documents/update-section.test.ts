import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { DocumentService, highestVersion } from './service.js'

// Minimal in-memory tx double for DocumentService.updateSection.
function fakePrisma(opts: { allVersions: string[]; currentVersion: string }) {
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
    documentVersion: {
      update: async () => ({}),
      findMany: async () => opts.allVersions.map(versionNumber => ({ versionNumber })),
      create: async ({ data }: { data: (typeof created)[number] }) => { created.push(data); return { id: 'ver-new', ...data } },
    },
    provenanceRecord: { create: async () => ({}) },
  }
  const prisma = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
  return { prisma, created }
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

describe('highestVersion', () => {
  it('compares numerically, not as strings', () => {
    expect(highestVersion(['v0.9', 'v0.10', 'v0.2'], 'v0.1')).toBe('v0.10')
    expect(highestVersion([], 'v0.1')).toBe('v0.1')
  })
})
