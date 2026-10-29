// Document templates — read-only endpoints that back the New Document
// wizard's type dropdown + source-category filter + section-template
// preview. Mutations (create/update/retire) land with the Admin edit
// screen in a later milestone; the canonical rows are seeded on deploy
// via apps/api/prisma/seeds/document-templates.ts.
//
// Routes (prefix /document-templates):
//   GET /                — list every current template (one row per type)
//   GET /:type           — single template by UI type key ('csr-full', …)
//
// Any authenticated user can read. The wizard doesn't need admin rights
// to render; selecting a template doesn't mutate state.

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'

interface TemplateRow {
  id:                       string
  type:                     string
  label:                    string
  description:              string
  framework:                string
  sections:                 unknown
  requiredSourceCategories: string[]
  version:                  number
  updatedAt:                Date
}

function toApiShape(row: TemplateRow) {
  return {
    id:                       row.id,
    type:                     row.type,
    label:                    row.label,
    description:              row.description,
    framework:                row.framework,
    sections:                 row.sections,
    requiredSourceCategories: row.requiredSourceCategories,
    version:                  row.version,
    updatedAt:                row.updatedAt.toISOString(),
  }
}

export const documentTemplatesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireAuth() }, async () => {
    const rows = await app.prisma.documentTemplate.findMany({
      where: { isCurrent: true, retiredAt: null },
      orderBy: [{ label: 'asc' }],
      select: {
        id: true, type: true, label: true, description: true, framework: true,
        sections: true, requiredSourceCategories: true, version: true, updatedAt: true,
      },
    })
    return rows.map(toApiShape)
  })

  app.get('/:type', { preHandler: requireAuth() }, async (request, reply) => {
    const { type } = request.params as { type: string }
    const row = await app.prisma.documentTemplate.findFirst({
      where: { type, isCurrent: true, retiredAt: null },
      select: {
        id: true, type: true, label: true, description: true, framework: true,
        sections: true, requiredSourceCategories: true, version: true, updatedAt: true,
      },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return toApiShape(row)
  })
}
