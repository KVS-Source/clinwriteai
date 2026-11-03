import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { actorCanEditDocumentRaci, actorCanEditRaciAssignments } from './access.js'

// The actor is the document's assignee and holds an active R row, so the
// only thing that can deny RACI editing is their role.
const prisma = {
  document:     { findUnique: async () => ({ assigneeId: 'u-1' }) },
  documentRaci: { findFirst:  async () => ({ id: 'raci-r' }) },
} as unknown as PrismaClient
const noRows = {
  document:     { findUnique: async () => ({ assigneeId: 'someone-else' }) },
  documentRaci: { findFirst:  async () => null },
} as unknown as PrismaClient

const user = (role: AuthenticatedUser['role']): AuthenticatedUser =>
  ({ id: 'u-1', email: 'u@x', role, modules: ['A'], tenantId: null })

describe('actorCanEditRaciAssignments', () => {
  it('lets an author (R / assignee) edit RACI', async () => {
    expect(await actorCanEditRaciAssignments(prisma, user('contributor'), 'DOC-1')).toBe(true)
  })

  it.each(['tenant-admin', 'admin', 'pm'] as const)('never lets %s edit RACI, even as R + assignee', async (role) => {
    expect(await actorCanEditRaciAssignments(prisma, user(role), 'DOC-1')).toBe(false)
  })

  it('refuses a contributor who is not an author', async () => {
    expect(await actorCanEditRaciAssignments(noRows, user('contributor'), 'DOC-1')).toBe(false)
  })

  it('leaves the shared document gate (checklist / guests) open to admins', async () => {
    expect(await actorCanEditDocumentRaci(noRows, user('tenant-admin'), 'DOC-1')).toBe(true)
  })
})
