// Unit tests for OpenFlagService — stubbed Prisma, no DB.

import { describe, expect, it, vi } from 'vitest'
import { OpenFlagService } from './open-flags-service.js'
import type { FlagToken } from '../carry-prompt/parse.js'

const token = (type: FlagToken['type'], text: string, start = 0): FlagToken =>
  ({ type, text, start, end: start + text.length, match: `[${type}: ${text}]` })

function stubPrisma(over: {
  existing?: Array<{ type: string; text: string }>
  rowsForList?: Array<Partial<{
    id: string; documentId: string; sectionId: string; type: string; text: string
    aiCallRecordId: string | null; status: string
    resolvedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null
    createdAt: Date; updatedAt: Date
  }>>
} = {}) {
  const createMany = vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => ({ count: data.length }))
  const findMany   = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    if ((where as { status?: string }).status === 'open' && !Array.isArray((where as { OR?: unknown }).OR)) {
      // listOpenForBrief path — return the full snapshot the test provides.
      return over.rowsForList ?? []
    }
    // appendFromAiCall's existing-lookup path: filter by OR tuples.
    return over.existing ?? []
  })
  return {
    documentBriefOpenFlag: { findMany, createMany, findUnique: vi.fn(), update: vi.fn() },
  }
}

describe('OpenFlagService.appendFromAiCall', () => {
  it('returns {inserted:0, deduped:0} for an empty token array', async () => {
    const svc = new OpenFlagService(stubPrisma() as never)
    const r = await svc.appendFromAiCall({ documentId: 'd', sectionId: 's', aiCallRecordId: null, tokens: [] })
    expect(r).toEqual({ inserted: 0, deduped: 0 })
  })

  it('inserts tokens with no existing match and dedupes within the batch', async () => {
    const prisma = stubPrisma({ existing: [] })
    const svc = new OpenFlagService(prisma as never)
    const r = await svc.appendFromAiCall({
      documentId: 'd', sectionId: 's', aiCallRecordId: 'rec-1',
      tokens: [
        token('information_required', 'a'),
        token('information_required', 'a'),             // batch-internal dupe
        token('conflict', 'x vs y'),
      ],
    })
    expect(r).toEqual({ inserted: 2, deduped: 1 })
    const call = prisma.documentBriefOpenFlag.createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }
    expect(call.data).toHaveLength(2)
    expect(call.data[0]).toMatchObject({ type: 'information_required', text: 'a', aiCallRecordId: 'rec-1' })
  })

  it('skips tokens that match an existing open row on (type, text)', async () => {
    const prisma = stubPrisma({ existing: [{ type: 'information_required', text: 'dose' }] })
    const svc = new OpenFlagService(prisma as never)
    const r = await svc.appendFromAiCall({
      documentId: 'd', sectionId: 's', aiCallRecordId: null,
      tokens: [token('information_required', 'dose'), token('conflict', 'q')],
    })
    expect(r.inserted).toBe(1)
    const call = prisma.documentBriefOpenFlag.createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }
    expect(call.data[0]).toMatchObject({ type: 'conflict' })
  })
})

describe('OpenFlagService.listOpenForBrief', () => {
  it('groups rows by type into the four brief.openFlags arrays', async () => {
    const prisma = stubPrisma({
      rowsForList: [
        { sectionId: 's1', type: 'information_required',            text: 'dose',          status: 'open' },
        { sectionId: 's2', type: 'conflict',                        text: 'IB vs P',       status: 'open' },
        { sectionId: 's3', type: 'reference_verification_required', text: 'up-1',          status: 'open' },
        { sectionId: 's4', type: 'missing_cross_ref_target',        text: 'Table 7',       status: 'open' },
      ],
    })
    const svc = new OpenFlagService(prisma as never)
    const r = await svc.listOpenForBrief('d')
    expect(r.informationRequired).toEqual([{ sectionId: 's1', note: 'dose' }])
    expect(r.conflicts).toEqual([{ sectionId: 's2', note: 'IB vs P' }])
    expect(r.referenceVerification).toEqual([{ sourceId: 'up-1', note: '(section s3)' }])
    expect(r.missingCrossRefTargets).toEqual([{ sectionId: 's4', note: 'Table 7' }])
  })

  it('returns empty arrays when no open rows exist', async () => {
    const svc = new OpenFlagService(stubPrisma({ rowsForList: [] }) as never)
    const r = await svc.listOpenForBrief('d')
    expect(r.informationRequired).toEqual([])
    expect(r.conflicts).toEqual([])
    expect(r.referenceVerification).toEqual([])
    expect(r.missingCrossRefTargets).toEqual([])
  })
})

describe('OpenFlagService.resolve', () => {
  const base = {
    id: 'f-1', documentId: 'd', sectionId: 's', type: 'information_required',
    text: 'dose', aiCallRecordId: null, status: 'open',
    resolvedBy: null, resolvedAt: null, resolutionNote: null,
    createdAt: new Date(), updatedAt: new Date(),
  }

  it('flips status to resolved with actor + note', async () => {
    const findUnique = vi.fn(async () => ({ ...base }))
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...base, ...data }))
    const svc = new OpenFlagService({ documentBriefOpenFlag: { findUnique, update } } as never)
    const r = await svc.resolve({
      flagId: 'f-1', documentId: 'd', actorId: 'u-sarah',
      status: 'resolved', resolutionNote: 'confirmed via IB',
    })
    expect(r?.status).toBe('resolved')
    expect(r?.resolvedBy).toBe('u-sarah')
    expect(r?.resolutionNote).toBe('confirmed via IB')
  })

  it('returns null when the flag does not exist', async () => {
    const findUnique = vi.fn(async () => null)
    const svc = new OpenFlagService({ documentBriefOpenFlag: { findUnique, update: vi.fn() } } as never)
    const r = await svc.resolve({ flagId: 'nope', documentId: 'd', actorId: 'u', status: 'resolved', resolutionNote: null })
    expect(r).toBeNull()
  })

  it('returns null when the flag belongs to a different document (tenant safety)', async () => {
    const findUnique = vi.fn(async () => ({ ...base, documentId: 'other-doc' }))
    const svc = new OpenFlagService({ documentBriefOpenFlag: { findUnique, update: vi.fn() } } as never)
    const r = await svc.resolve({ flagId: 'f-1', documentId: 'd', actorId: 'u', status: 'resolved', resolutionNote: null })
    expect(r).toBeNull()
  })

  it('returns null when the flag is already resolved (no-op)', async () => {
    const findUnique = vi.fn(async () => ({ ...base, status: 'resolved' }))
    const svc = new OpenFlagService({ documentBriefOpenFlag: { findUnique, update: vi.fn() } } as never)
    const r = await svc.resolve({ flagId: 'f-1', documentId: 'd', actorId: 'u', status: 'resolved', resolutionNote: null })
    expect(r).toBeNull()
  })
})
