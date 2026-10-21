// Citations routes — Module B (API contract §18).
//
// Vancouver numbering model: labels `[N]` are NOT stored. They're assigned
// at read time by ordering non-removed citations by insertedAt ASC. This
// means remove→renumber is automatic (one PATCH to removedAt propagates to
// every subsequent label on the next GET).
//
// Soft-delete-only: source-document citations (isSourceDocument=true) are
// locked for the publication's active life per FR-B-025 — the DB CHECK
// constraint enforces it, but the route also 422s with the friendly message.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const createSchema = z.object({
  pmid: z.string().optional(),
  title: z.string().min(1),
  shortRef: z.string().min(1),
  fullRef: z.string().min(1),
  locus: z.string().min(1),
  isSourceDocument: z.boolean().default(false),
})

export const citationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:publicationId/citations', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.citation.findMany({
      where: { publicationId, removedAt: null },
      orderBy: { insertedAt: 'asc' },
    })

    // Attach computed Vancouver label — insertion-order 1-based.
    return rows.map((c, idx) => ({ ...c, label: `[${idx + 1}]` }))
  })

  app.post('/:publicationId/citations', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    // Duplicate PMID check — only against live (non-removed) rows. A citation
    // can be re-added after soft-remove without colliding; the previous
    // removed row stays in the audit record.
    if (parsed.data.pmid) {
      const dup = await app.prisma.citation.findFirst({
        where: { publicationId, pmid: parsed.data.pmid, removedAt: null },
      })
      if (dup) {
        return reply.code(409).send({
          error: 'conflict',
          message: `PMID ${parsed.data.pmid} already inserted (citation ${dup.id})`,
        })
      }
    }

    const created = await app.prisma.citation.create({
      data: {
        publicationId,
        pmid: parsed.data.pmid ?? null,
        title: parsed.data.title,
        shortRef: parsed.data.shortRef,
        fullRef: parsed.data.fullRef,
        locus: parsed.data.locus,
        isSourceDocument: parsed.data.isSourceDocument,
        insertedBy: request.user!.id,
      },
    })

    // The new label is simply the count of live citations after insertion —
    // one count query avoids pulling every row back for the handler.
    const liveCount = await app.prisma.citation.count({
      where: { publicationId, removedAt: null },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'citation_inserted',
      entityType: 'publication',
      entityId: publicationId,
      details: {
        citationId: created.id,
        pmid: parsed.data.pmid ?? null,
        label: `[${liveCount}]`,
        isSourceDocument: parsed.data.isSourceDocument,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send({ ...created, label: `[${liveCount}]` })
  })

  app.delete('/:publicationId/citations/:citationId', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, citationId } = request.params as { publicationId: string; citationId: string }

    const citation = await app.prisma.citation.findFirst({ where: { id: citationId, publicationId } })
    if (!citation) return reply.code(404).send({ error: 'not_found' })
    if (citation.removedAt) return reply.code(204).send()   // idempotent

    if (citation.isSourceDocument) {
      return reply.code(422).send({
        error: 'source_document_locked',
        message: 'Source document citations cannot be removed while the publication is active (FR-B-025).',
      })
    }

    await app.prisma.citation.update({
      where: { id: citationId },
      data: { removedAt: new Date(), removedBy: request.user!.id },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'citation_removed',
      entityType: 'publication',
      entityId: publicationId,
      details: { citationId, pmid: citation.pmid, title: citation.title },
      ipAddress: request.ip ?? null,
    })

    return reply.code(204).send()
  })
}

// PubMed search stub — the citation editor queries this when the author
// types a search string. Real E-utilities integration is externally
// blocked (procurement for ORCID / CrossRef / PubMed keys per
// project_phase_3b_deferrals). Stub returns a deterministic set shaped
// like PubmedRecord so the UI's search autocomplete + "insert citation"
// flow works end-to-end against the demo DB.
//
// Registered at the root prefix in server.ts (NOT /publications) because
// the client calls GET /pubmed/search?q=... as a top-level search.
export const pubmedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/pubmed/search', { preHandler: requireAuth({ modules: ['B'] }) }, async (request) => {
    const q = ((request.query as { q?: string }).q ?? '').trim().toLowerCase()
    const base = [
      {
        id:    'pm-001',
        pmid:  '38765432',
        title: 'Veloricept plus pembrolizumab in first-line advanced NSCLC: Phase III VELORA-301 primary analysis',
        source:'New England Journal of Medicine · 2026',
        shortRef: 'Chen SY, et al. N Engl J Med 2026;395:812-824.',
        fullRef:  'Chen SY, Hartley J, Morton R, et al. Veloricept plus pembrolizumab in first-line advanced NSCLC: Phase III VELORA-301 primary analysis. N Engl J Med 2026;395:812-824. doi:10.1056/NEJMoa260XXXX',
        abstractText: 'In this Phase III randomised, double-blind trial, veloricept + pembrolizumab significantly improved progression-free survival (HR 0.61; 95% CI 0.48-0.77; p<0.001) versus pembrolizumab alone in treatment-naive advanced NSCLC with PD-L1 TPS ≥50% …',
        keys: 'VELORA-301,NSCLC,PD-L1,pembrolizumab',
      },
      {
        id:    'pm-002',
        pmid:  '38112233',
        title: 'Updated ICH E6(R3) good clinical practice guideline — operational implications',
        source:'The Lancet · 2025',
        shortRef: 'Smith T, Patel A. Lancet 2025;406:1234-1240.',
        fullRef:  'Smith T, Patel A. Updated ICH E6(R3) good clinical practice guideline — operational implications. Lancet 2025;406:1234-1240. doi:10.1016/S0140-6736(25)XXXXX-X',
        abstractText: 'The ICH E6(R3) revision modernises the GCP framework around risk-based quality management and electronic systems …',
        keys: 'ICH,GCP,E6R3,quality',
      },
      {
        id:    'pm-003',
        pmid:  '37998877',
        title: 'Progression-free survival as a surrogate endpoint in immuno-oncology trials: a systematic review',
        source:'Journal of Clinical Oncology · 2025',
        shortRef: 'Vasquez E, et al. J Clin Oncol 2025;43:988-1000.',
        fullRef:  'Vasquez E, Kim L, Chen D. Progression-free survival as a surrogate endpoint in immuno-oncology trials: a systematic review. J Clin Oncol 2025;43:988-1000.',
        abstractText: 'This systematic review of 142 immuno-oncology Phase III trials examines the correlation between progression-free survival and overall survival outcomes …',
        keys: 'PFS,surrogate endpoint,immuno-oncology,systematic review',
      },
    ]
    // Case-insensitive substring filter so "velora" or "ICH" both match
    // reasonably. Empty query returns the top of the stub list.
    const results = q
      ? base.filter(r => `${r.title} ${r.abstractText} ${r.keys}`.toLowerCase().includes(q))
      : base
    return { stub: true, query: q, results }
  })
}
