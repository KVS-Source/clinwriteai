// Document Brief service — fetches inputs from Prisma, calls the
// pure generator, upserts the resulting row.
//
// Called by:
//   - Fire-and-forget trigger in section PATCH + document create +
//     protocol-metadata PATCH (document mutation paths).
//   - Lazy regen in GET /documents/:id/brief when no row exists yet.
//
// Errors during a fire-and-forget regen must NOT bubble up to the
// caller's save — the brief is a derived cache; the authoritative
// document write has already succeeded. Callers wrap in .catch() and
// log through Fastify.
//
// Cited-reference count: we count active SourceReference rows
// (total minus those with a SourceReferenceRemoval row). Not
// authoritative Vancouver numbering — there's no per-source
// deduplication yet — but gives the model a monotonically non-
// decreasing `nextNumber`, which is what the carry prompt needs.
// Exact Vancouver numbering lands with the citation-registry PR.

import type { PrismaClient } from '@prisma/client'
import { generateBrief, type GenerateBriefInputs } from './generate.js'
import type { DocumentBrief } from './schema.js'

export class DocumentBriefService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Returns the stored brief for a document, or null when none exists.
   *  Use `upsert()` to generate on-demand. */
  async get(documentId: string): Promise<{ rev: number; generatedAt: Date; brief: DocumentBrief } | null> {
    const row = await this.prisma.documentBrief.findUnique({ where: { documentId } })
    if (!row) return null
    return {
      rev:         row.rev,
      generatedAt: row.generatedAt,
      brief:       row.contentJson as unknown as DocumentBrief,
    }
  }

  /** Regenerates the brief from current document state, bumps rev,
   *  upserts the row, returns the new brief. Throws when the document
   *  doesn't exist (callers should pre-validate). */
  async upsert(documentId: string): Promise<DocumentBrief> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        currentVersion: {
          select: {
            sections: {
              select: {
                sectionId: true, sectionNumber: true, sectionTitle: true,
                ichStatus: true, wordCount: true,
              },
            },
          },
        },
      },
    })
    if (!doc) throw new Error(`document ${documentId} not found`)

    // DocumentSource join → DocumentUpload for title + category.
    const sourceRows = await this.prisma.documentSource.findMany({
      where: { documentId },
      select: { uploadId: true },
    })
    const uploadIds = sourceRows.map(r => r.uploadId)
    const uploads = uploadIds.length
      ? await this.prisma.documentUpload.findMany({
          where: { id: { in: uploadIds } },
          select: { id: true, title: true, sourceCategory: true },
        })
      : []
    const uploadById = new Map(uploads.map(u => [u.id, u]))
    const sources = uploadIds.map(id => {
      const u = uploadById.get(id)
      return { uploadId: id, title: u?.title ?? null, category: u?.sourceCategory ?? null }
    })

    // TLF inventory — current package for the document's project.
    // TlfPackage.projectId isn't on Document directly; fetch the doc's
    // projectId and look up the current package. Empty is fine (no TLF
    // package yet → empty inventory arrays in the brief).
    const projectRow = await this.prisma.document.findUnique({
      where: { id: documentId }, select: { projectId: true },
    })
    const tlfPackage = projectRow
      ? await this.prisma.tlfPackage.findFirst({
          where:   { projectId: projectRow.projectId, isCurrent: true },
          include: { items: { select: { itemType: true, referenceId: true, title: true } } },
        })
      : null
    const tlfItems = tlfPackage?.items ?? []

    // ICH waivers — stable sort by sectionCode so briefs stringify
    // deterministically (easier diffing + test asserting).
    const ichWaivers = await this.prisma.ichSectionWaiver.findMany({
      where:   { documentId },
      select:  { sectionCode: true, reason: true },
      orderBy: { sectionCode: 'asc' },
    })

    // Cited-reference count (see file header for the scoping caveat).
    const [totalRefs, removedRefs] = await Promise.all([
      this.prisma.sourceReference.count({ where: { documentId } }),
      this.prisma.sourceReferenceRemoval.count({ where: { documentId } }),
    ])
    const citedCount = Math.max(0, totalRefs - removedRefs)

    // Rev bump — null row ⇒ first generation at rev 0; otherwise prev+1.
    const prev = await this.prisma.documentBrief.findUnique({
      where: { documentId }, select: { rev: true },
    })
    const rev = prev ? prev.rev + 1 : 0

    const inputs: GenerateBriefInputs = {
      document: {
        id:                      doc.id,
        type:                    doc.type,
        title:                   doc.title,
        status:                  doc.status,
        stage:                   doc.stage,
        sponsor:                 doc.sponsor ?? null,
        templateId:              doc.templateId ?? null,
        regulatoryRegion:        doc.regulatoryRegion ?? null,
        studyTitle:              doc.studyTitle ?? null,
        protocolNumber:          doc.protocolNumber ?? null,
        protocolVersion:         doc.protocolVersion ?? null,
        investigationalProduct:  doc.investigationalProduct ?? null,
        studyDesign:             doc.studyDesign ?? null,
        targetPopulation:        doc.targetPopulation ?? null,
      },
      sections:   doc.currentVersion?.sections ?? [],
      sources,
      tlfItems,
      ichWaivers,
      citedCount,
      rev,
    }

    const brief = generateBrief(inputs)

    await this.prisma.documentBrief.upsert({
      where:  { documentId },
      update: { rev, contentJson: brief as unknown as object, generatedAt: new Date() },
      create: { documentId, rev, contentJson: brief as unknown as object },
    })

    return brief
  }
}

/** Fire-and-forget helper used by document mutation routes. Swallows
 *  errors (the authoritative write has already succeeded); logs via
 *  the Fastify instance when supplied. */
export function regenBriefInBackground(
  prisma: PrismaClient,
  documentId: string,
  log?: { warn: (obj: object, msg: string) => void },
): void {
  const svc = new DocumentBriefService(prisma)
  void svc.upsert(documentId).catch((err: unknown) => {
    log?.warn({ err, documentId }, 'document brief regen failed')
  })
}
