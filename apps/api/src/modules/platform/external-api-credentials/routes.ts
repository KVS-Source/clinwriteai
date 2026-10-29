// External API credentials — admin-managed secrets for the regulatory /
// publishing / messaging connectors shown on the Admin Panel's External
// APIs tab. Replaces the in-memory draft map in web/AdminPanel.tsx with
// durable storage so entries survive page reloads.
//
// Routes (prefix /admin/external-apis):
//   GET  /credentials               — list all credentials for the caller's
//                                     tenant (apiKey masked, see maskKey())
//   PUT  /:apiId/credentials        — upsert one connector's credentials
//   DELETE /:apiId/credentials      — remove the stored row entirely
//
// Tenancy: tenant-admin users get rows for their own tenant; platform
// admins (tenantId null) manage the platform-level connectors (PubMed,
// CrossRef, …). A platform admin never sees another tenant's rows via
// these routes — that's a tenant-admin's purview and lives on the
// per-tenant admin screen (not shipped yet).
//
// Security:
//   - apiKey is NEVER returned in cleartext from GET /credentials. The
//     list response includes `apiKeyMasked: '••••abcd'` + `hasApiKey:
//     true`, so UIs can show whether a value is set without echoing the
//     secret. The worker (which actually uses the secret) reads directly
//     from Prisma inside the same Node process.
//   - Column-level encryption at rest tracked under phase-5 compliance
//     (project_phase_5_deferrals.md) — not blocking this ship.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const putSchema = z.object({
  apiKey:   z.string().max(1024).nullable().optional(),
  username: z.string().max(256).nullable().optional(),
  baseUrl:  z.string().max(512).nullable().optional(),
  notes:    z.string().max(2048).nullable().optional(),
})

const KNOWN_API_IDS = /^[a-z0-9][a-z0-9_-]{0,63}$/

interface CredRow {
  id:        string
  tenantId:  string | null
  apiId:     string
  apiKey:    string | null
  username:  string | null
  baseUrl:   string | null
  notes:     string | null
  updatedBy: string
  updatedAt: Date
}

/** Mask every character except the last 4, so logs/UIs never leak the key. */
function maskKey(key: string | null | undefined): string | null {
  if (!key) return null
  if (key.length <= 4) return '••••'
  return '••••' + key.slice(-4)
}

function toApiShape(row: CredRow) {
  return {
    apiId:         row.apiId,
    hasApiKey:     !!row.apiKey && row.apiKey.length > 0,
    apiKeyMasked:  maskKey(row.apiKey),
    username:      row.username,
    baseUrl:       row.baseUrl,
    notes:         row.notes,
    updatedAt:     row.updatedAt.toISOString(),
    updatedBy:     row.updatedBy,
  }
}

export const externalApiCredentialsRoutes: FastifyPluginAsync = async (app) => {
  // Admin-only. Both tenant-admins and platform admins pass; the handler
  // scopes rows by request.user!.tenantId (null for platform admins).
  const adminGate = requireAuth({ roles: ['admin'] })

  app.get('/credentials', { preHandler: adminGate }, async (request) => {
    const tenantId = request.user!.tenantId ?? null
    const rows = await app.prisma.externalApiCredential.findMany({
      where: { tenantId },
      orderBy: { apiId: 'asc' },
    })
    return rows.map(toApiShape)
  })

  app.put('/:apiId/credentials', { preHandler: adminGate }, async (request, reply) => {
    const { apiId } = request.params as { apiId: string }
    if (!KNOWN_API_IDS.test(apiId)) {
      return reply.code(400).send({ error: 'invalid_api_id', message: 'apiId must be lowercase alphanumeric with - or _' })
    }
    const parsed = putSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const tenantId = request.user!.tenantId ?? null
    const { apiKey, username, baseUrl, notes } = parsed.data

    // Nullable compound unique keys don't work via Prisma's composite
    // `where`, so look up explicitly then create/update. Protected
    // further by the Postgres unique index on (tenantId, apiId).
    const existing = await app.prisma.externalApiCredential.findFirst({
      where: { tenantId, apiId },
    })
    const row: CredRow = existing
      ? await app.prisma.externalApiCredential.update({
          where: { id: existing.id },
          data:  { apiKey, username, baseUrl, notes, updatedBy: request.user!.id },
        })
      : await app.prisma.externalApiCredential.create({
          data: {
            tenantId,
            apiId,
            apiKey:    apiKey   ?? null,
            username:  username ?? null,
            baseUrl:   baseUrl  ?? null,
            notes:     notes    ?? null,
            updatedBy: request.user!.id,
          },
        })

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'external_api_credentials_saved',
      entityType: 'external_api_credential',
      entityId:   row.id,
      details:    { apiId, tenantId, hasApiKey: !!apiKey, hasUsername: !!username, hasBaseUrl: !!baseUrl },
      ipAddress:  request.ip ?? null,
    })

    return toApiShape(row)
  })

  app.delete('/:apiId/credentials', { preHandler: adminGate }, async (request, reply) => {
    const { apiId } = request.params as { apiId: string }
    if (!KNOWN_API_IDS.test(apiId)) {
      return reply.code(400).send({ error: 'invalid_api_id' })
    }
    const tenantId = request.user!.tenantId ?? null
    const existing = await app.prisma.externalApiCredential.findFirst({
      where: { tenantId, apiId },
      select: { id: true },
    })
    if (existing) {
      await app.prisma.externalApiCredential.delete({ where: { id: existing.id } })
    }
    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'external_api_credentials_cleared',
      entityType: 'external_api_credential',
      entityId:   apiId,
      details:    { apiId, tenantId },
      ipAddress:  request.ip ?? null,
    })
    return reply.code(204).send()
  })
}
