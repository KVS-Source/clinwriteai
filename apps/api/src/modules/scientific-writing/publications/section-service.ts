// Publication section + version service — Module B analogue of the
// clinical-writing DocumentService + section write paths.
//
// What lives here:
//   - initialiseFromTemplate: creates the first PublicationVersion (v0.1)
//     + one PublicationSectionContent row per template section. Called
//     from the publication create transaction so new publications are
//     editor-ready the moment they're saved.
//   - upsertSectionContent: save HTML + word count on a section of the
//     CURRENT version. In-place mutation (same as Module A section
//     saves — the version itself is immutable only in semantic terms
//     until a bump; edits on v0.1 stay on v0.1).
//   - bumpVersion: flip isCurrent off the old row, create a new
//     PublicationVersion whose sections are deep-copies of the previous
//     current. For "For Review" / "Final" style snapshots.
//   - findCurrentSections: convenience read used by the editor + the
//     AI-suggest route (Phase M-B.4) + the validation-pass worker
//     (Phase M-B.3).

import type { Prisma, PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

export interface PublicationSectionPayload {
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  contentHtml?:  string
}

export interface InitialiseArgs {
  publicationId: string
  actorId:       string
  sections:      PublicationSectionPayload[]
}

/** Hash the full set of section bodies so provenance can bind an
 *  e-signature to an exact content set later (same pattern as Module A).
 *  Stable ordering by sectionId keeps the hash deterministic across
 *  Prisma's non-deterministic createMany returns. */
export function hashSections(sections: PublicationSectionPayload[]): string {
  const ordered = [...sections]
    .map(s => ({ sectionId: s.sectionId, html: s.contentHtml ?? '' }))
    .sort((a, b) => a.sectionId.localeCompare(b.sectionId))
  const h = createHash('sha256')
  for (const s of ordered) {
    h.update(s.sectionId)
    h.update('\n')
    h.update(s.html)
    h.update('\n')
  }
  return h.digest('hex')
}

function wordsIn(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return 0
  return text.split(' ').length
}

/** Creates the first PublicationVersion (v0.1 · "Draft") + a
 *  PublicationSectionContent row per section payload, inside the
 *  caller's transaction. Returns the new version id so the caller can
 *  set Publication.currentVersionId before the transaction commits. */
export async function initialisePublicationVersion(
  tx: Prisma.TransactionClient,
  args: InitialiseArgs,
): Promise<{ versionId: string; versionNumber: string; sectionCount: number }> {
  const version = await tx.publicationVersion.create({
    data: {
      publicationId: args.publicationId,
      versionNumber: 'v0.1',
      label:         'Draft',
      contentHash:   hashSections(args.sections),
      isCurrent:     true,
      createdBy:     args.actorId,
    },
  })

  if (args.sections.length > 0) {
    await tx.publicationSectionContent.createMany({
      data: args.sections.map(s => ({
        publicationVersionId: version.id,
        sectionId:            s.sectionId,
        sectionNumber:        s.sectionNumber,
        sectionTitle:         s.sectionTitle,
        contentHtml:          s.contentHtml ?? '',
        wordCount:            wordsIn(s.contentHtml ?? ''),
      })),
    })
  }

  await tx.publication.update({
    where: { id: args.publicationId },
    data:  { currentVersionId: version.id },
  })

  return { versionId: version.id, versionNumber: version.versionNumber, sectionCount: args.sections.length }
}

export interface UpsertSectionArgs {
  publicationId: string
  sectionId:     string
  contentHtml:   string
  actorId:       string
}

/** Upsert the section content on the current version. Returns the
 *  updated row. Throws PublicationSectionServiceError('no_current_version')
 *  when the publication has no current version yet (should never happen
 *  after Phase M-B.2 since create seeds v0.1). */
export class PublicationSectionService {
  constructor(private readonly prisma: PrismaClient) {}

  async listCurrentSections(publicationId: string) {
    const pub = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      select: { currentVersionId: true },
    })
    if (!pub?.currentVersionId) return []
    return this.prisma.publicationSectionContent.findMany({
      where:   { publicationVersionId: pub.currentVersionId },
      orderBy: { sectionNumber: 'asc' },
    })
  }

  async upsertSectionContent(args: UpsertSectionArgs) {
    const pub = await this.prisma.publication.findUnique({
      where:  { id: args.publicationId },
      select: { currentVersionId: true },
    })
    if (!pub?.currentVersionId) {
      throw new PublicationSectionServiceError(
        'no_current_version',
        `Publication ${args.publicationId} has no current version. Initialise v0.1 first.`,
      )
    }
    const row = await this.prisma.publicationSectionContent.findUnique({
      where: {
        publicationVersionId_sectionId: {
          publicationVersionId: pub.currentVersionId,
          sectionId:            args.sectionId,
        },
      },
    })
    if (!row) {
      throw new PublicationSectionServiceError(
        'section_not_found',
        `Section ${args.sectionId} not found on current version of publication ${args.publicationId}.`,
      )
    }
    return this.prisma.publicationSectionContent.update({
      where: { id: row.id },
      data: {
        contentHtml:    args.contentHtml,
        wordCount:      wordsIn(args.contentHtml),
        lastEditedBy:   args.actorId,
        lastEditedAt:   new Date(),
      },
    })
  }

  /** Write aiConfidence + aiFlags on a section. Called by the
   *  validation-pass worker (Phase M-B.3) after it scores a section. */
  async setSectionAiScore(args: {
    publicationVersionId: string
    sectionId:            string
    aiConfidence:         number
    aiFlags:              string[]
  }) {
    return this.prisma.publicationSectionContent.update({
      where: {
        publicationVersionId_sectionId: {
          publicationVersionId: args.publicationVersionId,
          sectionId:            args.sectionId,
        },
      },
      data: {
        aiConfidence: args.aiConfidence,
        aiFlags:      args.aiFlags,
      },
    })
  }

  async listVersions(publicationId: string) {
    return this.prisma.publicationVersion.findMany({
      where:   { publicationId },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** Create a new version from the current one. Deep-copies every
   *  section_content row into the new version, flips isCurrent off the
   *  old row, points Publication.currentVersionId to the new one.
   *  Returns the new version. */
  async bumpVersion(args: {
    publicationId: string
    label:         string
    newVersionNumber: string
    actorId:       string
    note?:         string
  }) {
    return this.prisma.$transaction(async (tx) => {
      const pub = await tx.publication.findUnique({
        where:  { id: args.publicationId },
        select: { currentVersionId: true },
      })
      if (!pub?.currentVersionId) {
        throw new PublicationSectionServiceError(
          'no_current_version',
          `Publication ${args.publicationId} has no current version to bump from.`,
        )
      }
      const sections = await tx.publicationSectionContent.findMany({
        where: { publicationVersionId: pub.currentVersionId },
      })
      const newVersion = await tx.publicationVersion.create({
        data: {
          publicationId: args.publicationId,
          versionNumber: args.newVersionNumber,
          label:         args.label,
          contentHash:   hashSections(sections.map(s => ({
            sectionId: s.sectionId, sectionNumber: s.sectionNumber, sectionTitle: s.sectionTitle, contentHtml: s.contentHtml,
          }))),
          isCurrent:     true,
          createdBy:     args.actorId,
          restoreSource: args.note ? { note: args.note } as unknown as Prisma.InputJsonValue : undefined,
        },
      })
      if (sections.length > 0) {
        await tx.publicationSectionContent.createMany({
          data: sections.map(s => ({
            publicationVersionId: newVersion.id,
            sectionId:            s.sectionId,
            sectionNumber:        s.sectionNumber,
            sectionTitle:         s.sectionTitle,
            contentHtml:          s.contentHtml,
            wordCount:            s.wordCount,
            aiSpanCount:          s.aiSpanCount,
            humanSpanCount:       s.humanSpanCount,
            aiConfidence:         s.aiConfidence,
            aiFlags:              s.aiFlags,
          })),
        })
      }
      await tx.publicationVersion.update({
        where: { id: pub.currentVersionId },
        data:  { isCurrent: false },
      })
      await tx.publication.update({
        where: { id: args.publicationId },
        data:  { currentVersionId: newVersion.id },
      })
      return newVersion
    })
  }
}

export type PublicationSectionErrorCode =
  | 'no_current_version'
  | 'section_not_found'

export class PublicationSectionServiceError extends Error {
  constructor(public readonly code: PublicationSectionErrorCode, message: string) {
    super(message)
    this.name = 'PublicationSectionServiceError'
  }
}
