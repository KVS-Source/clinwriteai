// Document service — the only path for mutations that need the
// version/provenance invariants to hold.
//
// Invariants enforced here:
//   1. A document has exactly one version row with is_current = true. Flipping
//      the flag is wrapped in a transaction with the new row's insert.
//   2. documents.current_version_id always points at that is_current row.
//   3. content_hash on a version is the sha256 of the deterministic join of
//      every section's HTML (sorted by sectionId). This is what the Part 11
//      e-sig chain binds to — never recompute it from a different source.
//   4. ProvenanceRecord is append-only — the service never updates existing
//      rows, only inserts new ones for AI-accepted spans.

import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

export interface SectionPayload {
  sectionId: string
  sectionNumber: string
  sectionTitle: string
  contentHtml: string
  ichStatus?: string
}

export function hashSections(sections: ReadonlyArray<Pick<SectionPayload, 'sectionId' | 'contentHtml'>>): string {
  const sorted = [...sections].sort((a, b) => a.sectionId.localeCompare(b.sectionId))
  const h = createHash('sha256')
  for (const s of sorted) {
    h.update(s.sectionId, 'utf8')
    h.update('', 'utf8')
    h.update(s.contentHtml, 'utf8')
    h.update('', 'utf8')
  }
  return h.digest('hex')
}

export interface CreateDocumentArgs {
  projectId: string
  type: string
  title: string
  therapeuticArea: string
  assigneeId: string
  createdBy: string
  templateId?: string
  targetCompletionDate?: Date
}

export class DocumentService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(args: CreateDocumentArgs) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          projectId: args.projectId,
          type: args.type,
          title: args.title,
          therapeuticArea: args.therapeuticArea,
          assigneeId: args.assigneeId,
          createdBy: args.createdBy,
          templateId: args.templateId ?? null,
          targetCompletionDate: args.targetCompletionDate ?? null,
          status: 'not_started',
          stage: 'study_start_up',
        },
      })

      const version = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: 'v0.1',
          label: 'Draft',
          contentHash: hashSections([]),       // empty-document hash
          isCurrent: true,
          createdBy: args.createdBy,
        },
      })

      await tx.document.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id },
      })

      return { document: { ...doc, currentVersionId: version.id }, version }
    })
  }

  async getWithSections(documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        currentVersion: {
          include: { sections: { orderBy: { sectionId: 'asc' } } },
        },
      },
    })
    return doc
  }

  /**
   * Update a single section on the current version. If the HTML changed, the
   * current version is left alone and a new version is created with the full
   * updated section set (an immutable snapshot — never mutate a prior
   * version's section_contents).
   *
   * Returns the resulting document + the (possibly new) current version id.
   */
  async updateSection(args: {
    documentId: string
    sectionId: string
    sectionNumber?: string
    sectionTitle?: string
    contentHtml: string
    editorUserId: string
    aiDrafted?: boolean
    aiModel?: string
    sourceRef?: string
  }) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.findUnique({
        where: { id: args.documentId },
        include: {
          currentVersion: { include: { sections: true } },
        },
      })
      if (!doc?.currentVersion) throw new Error(`Document ${args.documentId} not found or has no current version`)

      const current = doc.currentVersion
      const existing = current.sections.find(s => s.sectionId === args.sectionId)

      // No-op if content didn't actually change — spare the version churn.
      if (existing && existing.contentHtml === args.contentHtml) {
        return { document: doc, version: current, created: false }
      }

      // Build the next section set: replace the edited section's HTML and
      // keep everything else as-is.
      const nextSections: SectionPayload[] = current.sections.map(s =>
        s.sectionId === args.sectionId
          ? {
              sectionId: s.sectionId,
              sectionNumber: args.sectionNumber ?? s.sectionNumber,
              sectionTitle: args.sectionTitle ?? s.sectionTitle,
              contentHtml: args.contentHtml,
              ichStatus: 'in_progress',
            }
          : {
              sectionId: s.sectionId,
              sectionNumber: s.sectionNumber,
              sectionTitle: s.sectionTitle,
              contentHtml: s.contentHtml,
              ichStatus: s.ichStatus,
            },
      )
      if (!existing) {
        nextSections.push({
          sectionId: args.sectionId,
          sectionNumber: args.sectionNumber ?? args.sectionId,
          sectionTitle: args.sectionTitle ?? args.sectionId,
          contentHtml: args.contentHtml,
          ichStatus: 'in_progress',
        })
      }

      const nextVersionNumber = bumpVersion(current.versionNumber)
      const nextHash = hashSections(nextSections)

      // Atomically: mark old version non-current, insert new version + its
      // sections, update document.current_version_id, append provenance if AI.
      await tx.documentVersion.update({
        where: { id: current.id },
        data: { isCurrent: false },
      })

      const nextVersion = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: nextVersionNumber,
          label: 'Draft',
          contentHash: nextHash,
          isCurrent: true,
          createdBy: args.editorUserId,
          sections: {
            create: nextSections.map(s => ({
              sectionId: s.sectionId,
              sectionNumber: s.sectionNumber,
              sectionTitle: s.sectionTitle,
              contentHtml: s.contentHtml,
              ichStatus: s.ichStatus ?? 'in_progress',
              wordCount: countWords(s.contentHtml),
              lastEditedBy: s.sectionId === args.sectionId ? args.editorUserId : null,
              lastEditedAt: s.sectionId === args.sectionId ? new Date() : null,
              aiSpanCount: s.sectionId === args.sectionId && args.aiDrafted ? 1 : 0,
              humanSpanCount: s.sectionId === args.sectionId && !args.aiDrafted ? 1 : 0,
            })),
          },
        },
      })

      await tx.document.update({
        where: { id: doc.id },
        data: {
          currentVersionId: nextVersion.id,
          status: doc.status === 'not_started' ? 'in_authoring' : doc.status,
        },
      })

      if (args.aiDrafted) {
        await tx.provenanceRecord.create({
          data: {
            documentVersionId: nextVersion.id,
            sectionId: args.sectionId,
            spanId: `${args.sectionId}#${Date.now()}`,
            spanText: stripHtml(args.contentHtml),
            sourceType: 'ai_draft',
            sourceRef: args.sourceRef ?? null,
            aiModel: args.aiModel ?? null,
            aiGeneratedAt: new Date(),
            acceptedBy: args.editorUserId,
            acceptedAt: new Date(),
          },
        })
      }

      return { document: doc, version: nextVersion, created: true }
    })
  }
}

// --- helpers --------------------------------------------------------------

function bumpVersion(v: string): string {
  // Simple "v0.N" ladder for Phase 3A. Cross-major jumps (v1.0 → v1.1) land
  // when the signature chain lifecycle takes over version numbering.
  const match = v.match(/^v(\d+)\.(\d+)$/)
  if (!match) return `${v}.1`
  const [, major, minor] = match
  return `v${major}.${Number(minor) + 1}`
}

function countWords(html: string): number {
  const text = stripHtml(html)
  if (!text.trim()) return 0
  return text.trim().split(/\s+/).length
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
