// Phase 3 — PlatformSettings routes.
//
// Covers GET returning a well-shaped view on empty DB, PATCH merging
// partial updates without clobbering untouched sections, and the
// IT-admin role gate on writes.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformSettingsRoutes } from './routes.js'

type Row = {
  id: string
  branding: Record<string, unknown>
  localisation: Record<string, unknown>
  updatedBy: string | null
  updatedAt: Date
}

function buildPrisma(row: Row | null) {
  const current: { row: Row | null } = { row }
  return {
    platformSettings: {
      findUnique: vi.fn(async () => current.row),
      upsert: vi.fn(async ({ update, create }: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
        if (current.row) {
          current.row = { ...current.row, ...update, updatedAt: new Date() }
        } else {
          current.row = { ...(create as Row), updatedAt: new Date() }
        }
        return current.row
      }),
    },
  }
}

async function build(opts: { role?: 'admin' | 'pm'; initial?: Row | null } = {}) {
  const prisma = buildPrisma(opts.initial ?? null)
  const app = Fastify()
  app.decorate('prisma', prisma as never)
  app.decorate('audit',  { append: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const role = opts.role ?? 'admin'
    ;(req as unknown as { user: { id: string; role: string; modules: string[]; tenantId: string } }).user =
      { id: 'u1', role, modules: ['A'], tenantId: 't1' }
  })
  await app.register(platformSettingsRoutes, { prefix: '/platform-settings' })
  await app.ready()
  return { app, prisma }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('GET /platform-settings', () => {
  it('returns an empty-but-well-shaped view when no row exists yet', async () => {
    const { app } = await build({ initial: null })
    const res = await app.inject({ method: 'GET', url: '/platform-settings' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.branding).toEqual({})
    expect(body.localisation).toEqual({})
    expect(body.updatedBy).toBeNull()
    expect(typeof body.updatedAt).toBe('string')
  })

  it('returns the seeded values when the row exists', async () => {
    const { app } = await build({
      initial: {
        id: 'default',
        branding:     { companyName: 'Acme Pharma', primaryColor: '#B45309' },
        localisation: { timezone: 'Asia/Kolkata', country: 'IN' },
        updatedBy:    'u-seed',
        updatedAt:    new Date('2026-11-19T10:00:00Z'),
      },
    })
    const res = await app.inject({ method: 'GET', url: '/platform-settings' })
    const body = res.json()
    expect(body.branding).toMatchObject({ companyName: 'Acme Pharma', primaryColor: '#B45309' })
    expect(body.localisation).toMatchObject({ timezone: 'Asia/Kolkata', country: 'IN' })
  })
})

describe('PATCH /platform-settings/branding', () => {
  it('merges partial update with existing fields', async () => {
    const { app } = await build({
      initial: {
        id: 'default',
        branding:     { companyName: 'Acme Pharma', primaryColor: '#B45309', logoUrl: 'https://cdn.example.com/old.png' },
        localisation: { timezone: 'UTC' },
        updatedBy:    'u-seed',
        updatedAt:    new Date(),
      },
    })
    const res = await app.inject({
      method: 'PATCH', url: '/platform-settings/branding',
      payload: { primaryColor: '#2563EB' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // companyName + logoUrl survive the partial update.
    expect(body.branding).toMatchObject({
      companyName: 'Acme Pharma',
      primaryColor: '#2563EB',                       // changed
      logoUrl: 'https://cdn.example.com/old.png',
    })
    // Localisation section untouched.
    expect(body.localisation).toMatchObject({ timezone: 'UTC' })
  })

  it('400s on malformed colour', async () => {
    const { app } = await build()
    const res = await app.inject({
      method: 'PATCH', url: '/platform-settings/branding',
      payload: { primaryColor: 'not-a-color' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('validation')
  })

  it('403s when a non-admin tries to save', async () => {
    const { app } = await build({ role: 'pm' })
    const res = await app.inject({
      method: 'PATCH', url: '/platform-settings/branding',
      payload: { companyName: 'Sneaky Pharma' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('PATCH /platform-settings/localisation', () => {
  it('normalises country to uppercase + merges with existing branding', async () => {
    const { app } = await build({
      initial: {
        id: 'default',
        branding:     { companyName: 'Acme' },
        localisation: { timezone: 'UTC', country: 'US' },
        updatedBy:    'u-seed',
        updatedAt:    new Date(),
      },
    })
    const res = await app.inject({
      method: 'PATCH', url: '/platform-settings/localisation',
      payload: { country: 'in' },                       // lowercase
    })
    const body = res.json()
    expect(body.localisation).toMatchObject({ timezone: 'UTC', country: 'IN' })
    expect(body.branding).toMatchObject({ companyName: 'Acme' })
  })

  it('accepts timeFormat enum values', async () => {
    const { app } = await build()
    const res = await app.inject({
      method: 'PATCH', url: '/platform-settings/localisation',
      payload: { timeFormat: '12h' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().localisation.timeFormat).toBe('12h')
  })

  it('400s on a bad country code (length !== 2)', async () => {
    const { app } = await build()
    const res = await app.inject({
      method: 'PATCH', url: '/platform-settings/localisation',
      payload: { country: 'USA' },
    })
    expect(res.statusCode).toBe(400)
  })
})
