// Pure-logic tests for validateRaciInsert. Prisma is stubbed inline so
// each case exercises a specific branch of the enforcement in service.ts.

import { describe, expect, it } from 'vitest'
import { validateRaciInsert, type RaciInsertInput } from './service.js'

type ExistingRow = { letter: string; sectionId: string | null }

interface StubUser {
  id: string
  capabilities: string[]
  role: string
}

function makePrisma(opts: {
  user?: StubUser | null
  documentExists?: boolean
  existingRows?: ExistingRow[]
}): any {
  const user = opts.user === undefined
    ? { id: 'u-1', capabilities: ['can-author'], role: 'contributor' }
    : opts.user
  const documentExists = opts.documentExists ?? true
  const existingRows = opts.existingRows ?? []
  return {
    user: {
      findUnique: async () => user,
    },
    document: {
      findUnique: async () => (documentExists ? { id: 'd-1' } : null),
    },
    documentRaci: {
      findMany: async () => existingRows,
    },
  }
}

const baseInput: RaciInsertInput = {
  documentId: 'd-1',
  userId: 'u-1',
  letter: 'R',
  sectionId: null,
  approvalOrder: null,
  signatureRequired: false,
  signatureMeaning: null,
  assignedBy: 'actor-1',
  isActorTenantAdmin: false,
}

describe('validateRaciInsert — shape', () => {
  it('rejects an invalid letter', async () => {
    const r = await validateRaciInsert(makePrisma({}), { ...baseInput, letter: 'X' as 'R' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('invalid_letter')
  })

  it('rejects approvalOrder when letter is not A', async () => {
    const r = await validateRaciInsert(makePrisma({}), { ...baseInput, letter: 'R', approvalOrder: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('approval_order_requires_a_letter')
  })

  it('rejects signatureRequired without a signatureMeaning', async () => {
    const r = await validateRaciInsert(makePrisma({}), { ...baseInput, signatureRequired: true, signatureMeaning: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('signature_meaning_required')
  })
})

describe('validateRaciInsert — entity existence', () => {
  it('rejects unknown user', async () => {
    const r = await validateRaciInsert(makePrisma({ user: null }), baseInput)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('user_not_found')
  })

  it('rejects unknown document', async () => {
    const r = await validateRaciInsert(makePrisma({ documentExists: false }), baseInput)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('document_not_found')
  })
})

describe('validateRaciInsert — capability match', () => {
  it('allows R when user has can-author', async () => {
    const r = await validateRaciInsert(makePrisma({ user: { id: 'u-1', capabilities: ['can-author'], role: 'contributor' } }), { ...baseInput, letter: 'R' })
    expect(r.ok).toBe(true)
  })

  it('rejects A when user lacks can-approve', async () => {
    const r = await validateRaciInsert(
      makePrisma({ user: { id: 'u-1', capabilities: ['can-author'], role: 'contributor' } }),
      { ...baseInput, letter: 'A', signatureRequired: true, signatureMeaning: 'Medical approval' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('missing_capability')
  })

  it('allows I without any capability', async () => {
    const r = await validateRaciInsert(
      makePrisma({ user: { id: 'u-1', capabilities: [], role: 'contributor' } }),
      { ...baseInput, letter: 'I' },
    )
    expect(r.ok).toBe(true)
  })

  it('permits tenant-admin self-grant without the capability', async () => {
    const r = await validateRaciInsert(
      makePrisma({ user: { id: 'u-1', capabilities: [], role: 'tenant-admin' } }),
      { ...baseInput, userId: 'u-1', assignedBy: 'u-1', isActorTenantAdmin: true, letter: 'A', signatureRequired: true, signatureMeaning: 'Author attestation' },
    )
    expect(r.ok).toBe(true)
  })

  it('does NOT permit a different user to grant to a tenant-admin without capability', async () => {
    // Only the self-grant path bypasses capability — if actor != subject,
    // the admin's missing capability is still a block.
    const r = await validateRaciInsert(
      makePrisma({ user: { id: 'u-1', capabilities: [], role: 'tenant-admin' } }),
      { ...baseInput, userId: 'u-1', assignedBy: 'other-admin', isActorTenantAdmin: true, letter: 'A', signatureRequired: true, signatureMeaning: 'Medical approval' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('missing_capability')
  })
})

describe('validateRaciInsert — section rules', () => {
  it('rejects a second letter on the same (user, section)', async () => {
    const r = await validateRaciInsert(
      makePrisma({
        user: { id: 'u-1', capabilities: ['can-author', 'can-approve'], role: 'contributor' },
        existingRows: [{ letter: 'R', sectionId: 'sec-3' }],
      }),
      { ...baseInput, letter: 'A', sectionId: 'sec-3', signatureRequired: true, signatureMeaning: 'Medical approval' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('duplicate_letter_on_section')
  })

  it('allows different letter on a different section', async () => {
    const r = await validateRaciInsert(
      makePrisma({
        user: { id: 'u-1', capabilities: ['can-author', 'can-review'], role: 'contributor' },
        existingRows: [{ letter: 'R', sectionId: 'sec-3' }],
      }),
      { ...baseInput, letter: 'C', sectionId: 'sec-7' },
    )
    expect(r.ok).toBe(true)
  })

  it('rejects per-section letter when a whole-doc letter already exists', async () => {
    const r = await validateRaciInsert(
      makePrisma({
        user: { id: 'u-1', capabilities: ['can-author', 'can-review'], role: 'contributor' },
        existingRows: [{ letter: 'R', sectionId: null }],
      }),
      { ...baseInput, letter: 'C', sectionId: 'sec-7' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('whole_doc_vs_section_conflict')
  })

  it('rejects whole-doc letter when a per-section letter already exists', async () => {
    const r = await validateRaciInsert(
      makePrisma({
        user: { id: 'u-1', capabilities: ['can-author'], role: 'contributor' },
        existingRows: [{ letter: 'C', sectionId: 'sec-3' }],
      }),
      { ...baseInput, letter: 'R', sectionId: null },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('whole_doc_vs_section_conflict')
  })

  it('allows adding a second letter on a different section when first was whole-doc — IF removed', async () => {
    // Removed rows should not block new assignments. Here we simulate the
    // "existingRows" query already filtering removedAt IS NULL (which the
    // service does); so an empty list means no conflict.
    const r = await validateRaciInsert(
      makePrisma({
        user: { id: 'u-1', capabilities: ['can-author'], role: 'contributor' },
        existingRows: [],
      }),
      { ...baseInput, letter: 'R', sectionId: 'sec-3' },
    )
    expect(r.ok).toBe(true)
  })
})
