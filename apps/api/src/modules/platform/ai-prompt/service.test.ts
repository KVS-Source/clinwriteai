// Behaviour tests for AiPromptService.listVisible — the list query the
// admin screen reads. Must include brand-new drafts so they don't appear
// to "disappear" between create + approve.

import { describe, expect, it, vi } from 'vitest'
import { AiPromptService } from './service.js'

type Row = {
  id: string
  docType: string
  version: number
  status: 'draft' | 'approved' | 'retired'
  smePrompt: string
  sectionRules: unknown
}

function makePrisma(rows: Row[]) {
  return {
    aiPromptRecord: {
      findMany: vi.fn(async (args: { where?: { status?: { in?: string[] } | string } }) => {
        const filter = args.where?.status
        if (!filter) return rows
        if (typeof filter === 'string') return rows.filter(r => r.status === filter)
        if (typeof filter === 'object' && Array.isArray(filter.in)) {
          const allowed = new Set(filter.in)
          return rows.filter(r => allowed.has(r.status))
        }
        return rows
      }),
    },
  }
}

const base = (overrides: Partial<Row>): Row => ({
  id: 'id', docType: 'protocol', version: 1, status: 'approved',
  smePrompt: 'You are a protocol SME', sectionRules: {},
  ...overrides,
})

describe('AiPromptService.listVisible — admin list query', () => {
  it('returns the approved row when it is the only one for a docType', async () => {
    const svc = new AiPromptService(makePrisma([
      base({ id: 'a1', docType: 'protocol', version: 3, status: 'approved' }),
    ]) as never)
    const rows = await svc.listVisible()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('approved')
    expect(rows[0]!.version).toBe(3)
  })

  it('returns the draft when no approved row exists yet — the "disappeared" case', async () => {
    const svc = new AiPromptService(makePrisma([
      base({ id: 'd1', docType: 'protocol', version: 1, status: 'draft' }),
    ]) as never)
    const rows = await svc.listVisible()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('draft')
  })

  it('prefers approved over draft when both exist for the same docType', async () => {
    const svc = new AiPromptService(makePrisma([
      base({ id: 'a3', docType: 'protocol', version: 3, status: 'approved' }),
      base({ id: 'd4', docType: 'protocol', version: 4, status: 'draft' }),
    ]) as never)
    const rows = await svc.listVisible()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('approved')
    expect(rows[0]!.id).toBe('a3')
  })

  it('never returns retired rows', async () => {
    const svc = new AiPromptService(makePrisma([
      base({ id: 'r1', docType: 'csr_full', version: 1, status: 'retired' }),
      base({ id: 'a2', docType: 'csr_full', version: 2, status: 'approved' }),
    ]) as never)
    const rows = await svc.listVisible()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('approved')
    expect(rows.find(r => r.status === 'retired')).toBeUndefined()
  })

  it('returns one row per docType across a mixed set + sorts by docType', async () => {
    const svc = new AiPromptService(makePrisma([
      base({ id: 'z1', docType: 'protocol',       version: 1, status: 'approved' }),
      base({ id: 'z2', docType: 'csr_full',       version: 1, status: 'draft'    }),
      base({ id: 'z3', docType: 'ib',             version: 1, status: 'approved' }),
      base({ id: 'z4', docType: 'ib',             version: 2, status: 'draft'    }),  // superseded by approved
      base({ id: 'z5', docType: 'protocol',       version: 0, status: 'retired'  }),  // hidden
    ]) as never)
    const rows = await svc.listVisible()
    expect(rows.map(r => `${r.docType}:${r.status}`)).toEqual([
      'csr_full:draft',
      'ib:approved',
      'protocol:approved',
    ])
  })
})
