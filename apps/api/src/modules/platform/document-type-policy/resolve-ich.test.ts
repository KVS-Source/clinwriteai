// ICH framework auto-pick (migration 100 follow-up).
//
// resolvePolicyAssets returns { auto, pinned, effective } for ICH the
// same way it does for template + checklist. 'auto' comes from the
// DOC_TYPE_TO_ICH convention map; 'pinned' comes from policy.ichFramework.

import { describe, expect, it, vi } from 'vitest'
import { resolvePolicyAssets } from './resolve-assets.js'

const FRAMEWORKS = [
  { name: 'ICH E3',  version: '1995',  jurisdiction: 'ICH' },
  { name: 'ICH M11', version: '2023',  jurisdiction: 'ICH' },
  { name: 'ICH E6',  version: 'R3',    jurisdiction: 'ICH' },
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
  it("auto-matches CSR to ICH E3 when the policy doesn't pin one", async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'csr_full',
      templateId:          null,
      checklistTemplateId: null,
      ichFramework:        null,
    })
    expect(assets.ich.effective).toBe('auto')
    expect(assets.ich.auto?.name).toBe('ICH E3')
    expect(assets.ich.pinned).toBeNull()
  })

  it('auto-matches Protocol to ICH M11', async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'protocol',
      templateId:          null,
      checklistTemplateId: null,
      ichFramework:        null,
    })
    expect(assets.ich.auto?.name).toBe('ICH M11')
    expect(assets.ich.effective).toBe('auto')
  })

  it('honours policy.ichFramework as a pin when set', async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'csr_full',
      templateId:          null,
      checklistTemplateId: null,
      ichFramework:        'FDA 21 CFR 312',
    })
    expect(assets.ich.pinned?.name).toBe('FDA 21 CFR 312')
    expect(assets.ich.auto?.name).toBe('ICH E3')
    expect(assets.ich.effective).toBe('pinned')
  })

  it("matches case-insensitively — admin typing 'ich e3' still resolves", async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'csr_full',
      templateId:          null,
      checklistTemplateId: null,
      ichFramework:        'ich e3',
    })
    expect(assets.ich.pinned?.name).toBe('ICH E3')
    expect(assets.ich.effective).toBe('pinned')
  })

  it("reports 'none' for an unknown doc type with no pin", async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'advisory_board_report',
      templateId:          null,
      checklistTemplateId: null,
      ichFramework:        null,
    })
    expect(assets.ich.effective).toBe('none')
    expect(assets.ich.auto).toBeNull()
    expect(assets.ich.pinned).toBeNull()
  })

  it("reports 'auto' (not 'pinned') when the pinned name doesn't match any row", async () => {
    const prisma = makePrisma()
    const assets = await resolvePolicyAssets(prisma, {
      docType:             'csr_full',
      templateId:          null,
      checklistTemplateId: null,
      ichFramework:        'ICH Z99',   // nonexistent
    })
    // Pinned didn't resolve to a row; auto falls back. The auto match
    // is still populated so the UI can surface the default.
    expect(assets.ich.pinned).toBeNull()
    expect(assets.ich.auto?.name).toBe('ICH E3')
    expect(assets.ich.effective).toBe('auto')
  })
})
