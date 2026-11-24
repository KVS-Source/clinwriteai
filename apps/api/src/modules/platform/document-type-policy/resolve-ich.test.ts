// ICH framework auto-pick (migration 100 + 102).
//
// resolvePolicyAssets returns ich = { auto, pinned, effective }:
//  - 'auto' pulled from the DOC_TYPE_TO_ICH convention map (single row today)
//  - 'pinned' pulled from policy.ichFrameworkNames (array; migration 102)
// Both are arrays so a doc type can cite multiple guidelines
// (Protocol → M11 + E6 + E8).

import { describe, expect, it, vi } from 'vitest'
import { resolvePolicyAssets } from './resolve-assets.js'

const FRAMEWORKS = [
  { name: 'ICH E3',  version: '1995',  jurisdiction: 'ICH' },
  { name: 'ICH M11', version: '2023',  jurisdiction: 'ICH' },
  { name: 'ICH E6',  version: 'R3',    jurisdiction: 'ICH' },
  { name: 'ICH E8',  version: 'R1',    jurisdiction: 'ICH' },
  { name: 'FDA 21 CFR 312', version: '2024', jurisdiction: 'US' },
]

function makePrisma(rows: typeof FRAMEWORKS = FRAMEWORKS) {
  return {
    documentTemplate: {
      findUnique: vi.fn(async () => null),
      findFirst:  vi.fn(async () => null),
    },
    checklistTemplate: {
      findUnique: vi.fn(async () => null),
      findFirst:  vi.fn(async () => null),
    },
    regulatoryFramework: {
      findMany: vi.fn(async (args: { where: { name: { in: string[] } } }) => {
        const wanted = new Set(args.where.name.in.map(n => n.toLowerCase()))
        return rows.filter(r => wanted.has(r.name.toLowerCase()))
      }),
    },
  } as unknown as import('@prisma/client').PrismaClient
}

describe('resolvePolicyAssets — ICH framework', () => {
  it("auto-matches CSR to ICH E3 when nothing is pinned", async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'csr_full',
      templateId:          null,
      checklistTemplateId: null,
      ichFrameworkNames:   [],
    })
    expect(assets.ich.effective).toBe('auto')
    expect(assets.ich.auto.map(f => f.name)).toEqual(['ICH E3'])
    expect(assets.ich.pinned).toEqual([])
  })

  it('auto-matches Protocol to ICH M11', async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'protocol',
      templateId:          null,
      checklistTemplateId: null,
      ichFrameworkNames:   [],
    })
    expect(assets.ich.auto.map(f => f.name)).toEqual(['ICH M11'])
    expect(assets.ich.effective).toBe('auto')
  })

  it('honours ichFrameworkNames pins and preserves order', async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'protocol',
      templateId:          null,
      checklistTemplateId: null,
      ichFrameworkNames:   ['ICH M11', 'ICH E6', 'ICH E8'],
    })
    expect(assets.ich.pinned.map(f => f.name)).toEqual(['ICH M11', 'ICH E6', 'ICH E8'])
    expect(assets.ich.effective).toBe('pinned')
  })

  it("matches case-insensitively — admin typing 'ich e3' still resolves", async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'csr_full',
      templateId:          null,
      checklistTemplateId: null,
      ichFrameworkNames:   ['ich e3'],
    })
    expect(assets.ich.pinned.map(f => f.name)).toEqual(['ICH E3'])
    expect(assets.ich.effective).toBe('pinned')
  })

  it("reports 'none' for an unknown doc type with no pins", async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'advisory_board_report',
      templateId:          null,
      checklistTemplateId: null,
      ichFrameworkNames:   [],
    })
    expect(assets.ich.effective).toBe('none')
    expect(assets.ich.auto).toEqual([])
    expect(assets.ich.pinned).toEqual([])
  })

  it("falls back to 'auto' when a pinned name doesn't match any row", async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'csr_full',
      templateId:          null,
      checklistTemplateId: null,
      ichFrameworkNames:   ['ICH Z99'],   // nonexistent
    })
    expect(assets.ich.pinned).toEqual([])
    expect(assets.ich.auto.map(f => f.name)).toEqual(['ICH E3'])
    expect(assets.ich.effective).toBe('auto')
  })

  it('reads the legacy ichFramework single field during the transition', async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'csr_full',
      templateId:          null,
      checklistTemplateId: null,
      // Old-style single-value pin — resolver prefers it when the new
      // array is empty, so unmigrated rows still render.
      ichFramework:        'FDA 21 CFR 312',
      ichFrameworkNames:   [],
    })
    expect(assets.ich.pinned.map(f => f.name)).toEqual(['FDA 21 CFR 312'])
    expect(assets.ich.effective).toBe('pinned')
  })
})
