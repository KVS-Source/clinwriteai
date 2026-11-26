// Preflight checks for the AI initial-draft job — makes sure the
// writer sees actionable blockers (open in the AI Debug panel) instead
// of a generic 503/modal before any draft runs.
//
// Each case mocks the Prisma reads computeDraftPreflight() touches and
// asserts the issue list matches the scenario.

import { describe, expect, it, vi } from 'vitest'
import { computeDraftPreflight } from './ai-draft-preflight.js'

const PDF = 'application/pdf'
const USABLE_UPLOAD = {
  id:              'u1',
  contentType:     PDF,
  fileName:        'protocol.pdf',
  fileSizeBytes:   1024,
  status:          'confirmed',
  virusScanStatus: 'clean',
}

function makePrisma(opts: {
  doc?:          { type: string; projectId: string; deletedAt?: Date | null; aiInstructions?: string | null } | null
  policy?:       { templateId: string | null; checklistTemplateId: string | null; requirements?: unknown } | null
  checklistAuto?: { id: string; version: number } | null
  templateAuto?:  { id: string; label: string; version: number } | null
  sourceLinks?:  Array<{ uploadId: string; role?: string }>
  uploads?:      Array<typeof USABLE_UPLOAD>
  anthropicKey?: string
}) {
  const doc = opts.doc === undefined
    ? { id: 'D1', type: 'csr_full', projectId: 'P1', aiInstructions: 'Draft this doc for the primary endpoint', deletedAt: null }
    : opts.doc
  const policy = opts.policy === undefined
    ? { id: 'pol1', docType: 'csr_full', templateId: null, checklistTemplateId: null, requirements: { requireSources: true, requireTemplate: true, requirePurpose: true } }
    : opts.policy && { id: 'pol1', docType: 'csr_full', requirements: { requireSources: true, requireTemplate: true, requirePurpose: true }, ...opts.policy }
  const sourceLinks = opts.sourceLinks ?? [{ uploadId: 'u1' }]
  const uploads     = opts.uploads     ?? [USABLE_UPLOAD]

  const prisma = {
    document: {
      findUnique: vi.fn(async () => doc),
    },
    documentTypePolicy: {
      findFirst: vi.fn(async () => policy),
    },
    documentTemplate: {
      findFirst:  vi.fn(async () => opts.templateAuto  ?? null),
      findUnique: vi.fn(async () => null),
    },
    checklistTemplate: {
      findFirst:  vi.fn(async () => opts.checklistAuto ?? null),
      findUnique: vi.fn(async () => null),
    },
    documentSource: {
      findMany: vi.fn(async () => sourceLinks),
    },
    documentUpload: {
      findMany: vi.fn(async () => uploads),
    },
    regulatoryFramework: {
      findMany: vi.fn(async () => []),
    },
    externalApiCredential: {
      findFirst: vi.fn(async () => opts.anthropicKey ? { apiKey: opts.anthropicKey } : null),
    },
    aiEngineConfig: {
      findUnique: vi.fn(async () => null),
      findFirst:  vi.fn(async () => null),
    },
    tenant: {
      findUnique: vi.fn(async () => null),
    },
  }
  return prisma as unknown as import('@prisma/client').PrismaClient
}

describe('computeDraftPreflight', () => {
  it('passes when every input resolves', async () => {
    const prisma = makePrisma({
      anthropicKey:  'sk-test',
      checklistAuto: { id: 'cl1', version: 1 },
      templateAuto:  { id: 'tmpl1', label: 'CSR', version: 1 },
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('flags no_policy_for_doctype when no current policy exists', async () => {
    const prisma = makePrisma({
      anthropicKey:  'sk-test',
      policy:        null,
      checklistAuto: null,
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.ok).toBe(false)
    const codes = result.issues.map(i => i.code)
    expect(codes).toContain('no_policy_for_doctype')
    // When no policy exists we don't double-flag checklist — the policy
    // fix covers it.
    expect(codes).not.toContain('no_checklist')
  })

  it('flags no_checklist when policy exists but no checklist auto-matches', async () => {
    const prisma = makePrisma({
      anthropicKey:  'sk-test',
      checklistAuto: null,
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.ok).toBe(false)
    expect(result.issues.map(i => i.code)).toContain('no_checklist')
  })

  it('flags no_sources when no source documents are attached', async () => {
    const prisma = makePrisma({
      anthropicKey:  'sk-test',
      checklistAuto: { id: 'cl1', version: 1 },
      sourceLinks:   [],
      uploads:       [],
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.ok).toBe(false)
    expect(result.issues.map(i => i.code)).toContain('no_sources')
  })

  it('flags all_sources_dropped when every attached source is unusable', async () => {
    const prisma = makePrisma({
      anthropicKey:  'sk-test',
      checklistAuto: { id: 'cl1', version: 1 },
      uploads: [{
        id: 'u1', contentType: 'image/png', fileName: 'scan.png', fileSizeBytes: 1024,
        status: 'confirmed', virusScanStatus: 'clean',
      }],
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.ok).toBe(false)
    expect(result.issues.map(i => i.code)).toContain('all_sources_dropped')
  })

  it('a Word source is usable; every source being an example is not', async () => {
    const word = { ...USABLE_UPLOAD, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'synopsis.docx' }
    const ok = await computeDraftPreflight(makePrisma({ anthropicKey: 'sk-test', checklistAuto: { id: 'cl1', version: 1 }, templateAuto: { id: 't1', label: 'T', version: 1 }, uploads: [word] }), 'D1')
    expect(ok.issues.map(i => i.code)).not.toContain('all_sources_dropped')
    const examples = await computeDraftPreflight(makePrisma({
      anthropicKey: 'sk-test', checklistAuto: { id: 'cl1', version: 1 }, sourceLinks: [{ uploadId: 'u1', role: 'example' }],
    }), 'D1')
    expect(examples.issues.map(i => i.code)).toContain('no_evidence_sources')
  })

  it('flags ai_not_configured when no Anthropic key and stub is off', async () => {
    vi.stubEnv('AI_ALLOW_STUB', '')
    const prisma = makePrisma({ checklistAuto: { id: 'cl1', version: 1 } })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.issues.map(i => i.code)).toContain('ai_not_configured')
    vi.unstubAllEnvs()
  })

  it('treats a deleted or missing document as not-ok with no issues', async () => {
    const prisma = makePrisma({ anthropicKey: 'sk-test', doc: null })
    const result = await computeDraftPreflight(prisma, 'D-missing')
    expect(result).toEqual({ ok: false, issues: [] })
  })

  // --- requirements toggles (migration 100) ------------------------------

  it('flags no_template when policy.requireTemplate and nothing auto-matches', async () => {
    const prisma = makePrisma({
      anthropicKey:  'sk-test',
      checklistAuto: { id: 'cl1', version: 1 },
      // No templateAuto → resolveTemplate returns 'none'.
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.ok).toBe(false)
    expect(result.issues.map(i => i.code)).toContain('no_template')
  })

  it('does NOT flag no_template when policy switches it off', async () => {
    const prisma = makePrisma({
      anthropicKey:  'sk-test',
      policy: {
        templateId: null, checklistTemplateId: null,
        requirements: { requireSources: true, requireTemplate: false, requirePurpose: true },
      },
      checklistAuto: { id: 'cl1', version: 1 },
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.issues.map(i => i.code)).not.toContain('no_template')
  })

  it('flags no_purpose when policy.requirePurpose and aiInstructions is blank', async () => {
    const prisma = makePrisma({
      anthropicKey: 'sk-test',
      doc: { id: 'D1', type: 'csr_full', projectId: 'P1', aiInstructions: null, deletedAt: null } as never,
      checklistAuto: { id: 'cl1', version: 1 },
      templateAuto:  { id: 'tmpl1', label: 'CSR', version: 1 },
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.ok).toBe(false)
    expect(result.issues.map(i => i.code)).toContain('no_purpose')
  })

  it('does NOT flag no_purpose when policy switches it off', async () => {
    const prisma = makePrisma({
      anthropicKey: 'sk-test',
      doc: { id: 'D1', type: 'csr_full', projectId: 'P1', aiInstructions: null, deletedAt: null } as never,
      policy: {
        templateId: null, checklistTemplateId: null,
        requirements: { requireSources: true, requireTemplate: true, requirePurpose: false },
      },
      checklistAuto: { id: 'cl1', version: 1 },
      templateAuto:  { id: 'tmpl1', label: 'CSR', version: 1 },
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.issues.map(i => i.code)).not.toContain('no_purpose')
  })

  it('does NOT flag no_sources when policy switches sources off', async () => {
    const prisma = makePrisma({
      anthropicKey: 'sk-test',
      policy: {
        templateId: null, checklistTemplateId: null,
        requirements: { requireSources: false, requireTemplate: true, requirePurpose: true },
      },
      checklistAuto: { id: 'cl1', version: 1 },
      templateAuto:  { id: 'tmpl1', label: 'CSR', version: 1 },
      sourceLinks: [],
      uploads: [],
    })
    const result = await computeDraftPreflight(prisma, 'D1')
    expect(result.issues.map(i => i.code)).not.toContain('no_sources')
  })
})
