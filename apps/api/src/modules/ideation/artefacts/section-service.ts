// Ideation artefact section + version service — Module D analogue of
// MedContentSectionService.
//
// Scope: create v0.1 + sections from a template payload on document
// creation; upsert section content on save; bump new version;
// score aiConfidence + aiFlags (worker hook).

import type { Prisma, PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

export interface IdeationArtefactSectionPayload {
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  contentHtml?:  string
}

export interface IdeationArtefactInitialiseArgs {
  ideationArtefactId: string
  actorId:              string
  sections:             IdeationArtefactSectionPayload[]
}

export function hashIdeationArtefactSections(sections: IdeationArtefactSectionPayload[]): string {
  const ordered = [...sections]
    .map(s => ({ sectionId: s.sectionId, html: s.contentHtml ?? '' }))
    .sort((a, b) => a.sectionId.localeCompare(b.sectionId))
  const h = createHash('sha256')
  for (const s of ordered) {
    h.update(s.sectionId); h.update('\n'); h.update(s.html); h.update('\n')
  }
  return h.digest('hex')
}

function wordsIn(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return 0
  return text.split(' ').length
}

export async function initialiseIdeationArtefactVersion(
  tx: Prisma.TransactionClient,
  args: IdeationArtefactInitialiseArgs,
): Promise<{ versionId: string; versionNumber: string; sectionCount: number }> {
  const version = await tx.ideationArtefactVersion.create({
    data: {
      ideationArtefactId: args.ideationArtefactId,
      versionNumber: 'v0.1',
      label:         'Draft',
      contentHash:   hashIdeationArtefactSections(args.sections),
      isCurrent:     true,
      createdBy:     args.actorId,
    },
  })
  if (args.sections.length > 0) {
    await tx.ideationArtefactSection.createMany({
      data: args.sections.map(s => ({
        ideationArtefactVersionId: version.id,
        sectionId:     s.sectionId,
        sectionNumber: s.sectionNumber,
        sectionTitle:  s.sectionTitle,
        contentHtml:   s.contentHtml ?? '',
        wordCount:     wordsIn(s.contentHtml ?? ''),
      })),
    })
  }
  await tx.ideationArtefact.update({
    where: { id: args.ideationArtefactId },
    data:  { currentVersionId: version.id },
  })
  return { versionId: version.id, versionNumber: version.versionNumber, sectionCount: args.sections.length }
}

export interface UpsertIdeationSectionArgs {
  ideationArtefactId: string
  sectionId:            string
  contentHtml:          string
  actorId:              string
}

export class IdeationArtefactSectionService {
  constructor(private readonly prisma: PrismaClient) {}

  async listCurrentSections(ideationArtefactId: string) {
    const doc = await this.prisma.ideationArtefact.findUnique({
      where: { id: ideationArtefactId }, select: { currentVersionId: true },
    })
    if (!doc?.currentVersionId) return []
    return this.prisma.ideationArtefactSection.findMany({
      where:   { ideationArtefactVersionId: doc.currentVersionId },
      orderBy: { sectionNumber: 'asc' },
    })
  }

  async upsertSectionContent(args: UpsertIdeationSectionArgs) {
    const doc = await this.prisma.ideationArtefact.findUnique({
      where:  { id: args.ideationArtefactId },
      select: { currentVersionId: true },
    })
    if (!doc?.currentVersionId) {
      throw new IdeationArtefactSectionServiceError(
        'no_current_version',
        `IdeationArtefact ${args.ideationArtefactId} has no current version. Initialise v0.1 first.`,
      )
    }
    const row = await this.prisma.ideationArtefactSection.findUnique({
      where: { ideationArtefactVersionId_sectionId: { ideationArtefactVersionId: doc.currentVersionId, sectionId: args.sectionId } },
    })
    if (!row) {
      throw new IdeationArtefactSectionServiceError(
        'section_not_found',
        `Section ${args.sectionId} not found on current version of document ${args.ideationArtefactId}.`,
      )
    }
    return this.prisma.ideationArtefactSection.update({
      where: { id: row.id },
      data: {
        contentHtml:  args.contentHtml,
        wordCount:    wordsIn(args.contentHtml),
        lastEditedBy: args.actorId,
        lastEditedAt: new Date(),
      },
    })
  }

  async setSectionAiScore(args: {
    ideationArtefactVersionId: string
    sectionId:                   string
    aiConfidence:                number
    aiFlags:                     string[]
  }) {
    return this.prisma.ideationArtefactSection.update({
      where: { ideationArtefactVersionId_sectionId: { ideationArtefactVersionId: args.ideationArtefactVersionId, sectionId: args.sectionId } },
      data:  { aiConfidence: args.aiConfidence, aiFlags: args.aiFlags },
    })
  }

  async listVersions(ideationArtefactId: string) {
    return this.prisma.ideationArtefactVersion.findMany({
      where:   { ideationArtefactId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async bumpVersion(args: {
    ideationArtefactId: string
    label:                string
    newVersionNumber:     string
    actorId:              string
    note?:                string
  }) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.ideationArtefact.findUnique({
        where:  { id: args.ideationArtefactId },
        select: { currentVersionId: true },
      })
      if (!doc?.currentVersionId) {
        throw new IdeationArtefactSectionServiceError(
          'no_current_version',
          `IdeationArtefact ${args.ideationArtefactId} has no current version to bump from.`,
        )
      }
      const sections = await tx.ideationArtefactSection.findMany({
        where: { ideationArtefactVersionId: doc.currentVersionId },
      })
      const newVersion = await tx.ideationArtefactVersion.create({
        data: {
          ideationArtefactId: args.ideationArtefactId,
          versionNumber: args.newVersionNumber,
          label:         args.label,
          contentHash:   hashIdeationArtefactSections(sections.map(s => ({
            sectionId: s.sectionId, sectionNumber: s.sectionNumber, sectionTitle: s.sectionTitle, contentHtml: s.contentHtml,
          }))),
          isCurrent:     true,
          createdBy:     args.actorId,
          restoreSource: args.note ? { note: args.note } as unknown as Prisma.InputJsonValue : undefined,
        },
      })
      if (sections.length > 0) {
        await tx.ideationArtefactSection.createMany({
          data: sections.map(s => ({
            ideationArtefactVersionId: newVersion.id,
            sectionId:      s.sectionId,
            sectionNumber:  s.sectionNumber,
            sectionTitle:   s.sectionTitle,
            contentHtml:    s.contentHtml,
            wordCount:      s.wordCount,
            aiSpanCount:    s.aiSpanCount,
            humanSpanCount: s.humanSpanCount,
            aiConfidence:   s.aiConfidence,
            aiFlags:        s.aiFlags,
          })),
        })
      }
      await tx.ideationArtefactVersion.update({
        where: { id: doc.currentVersionId },
        data:  { isCurrent: false },
      })
      await tx.ideationArtefact.update({
        where: { id: args.ideationArtefactId },
        data:  { currentVersionId: newVersion.id },
      })
      return newVersion
    })
  }
}

export type IdeationArtefactSectionErrorCode =
  | 'no_current_version'
  | 'section_not_found'

export class IdeationArtefactSectionServiceError extends Error {
  constructor(public readonly code: IdeationArtefactSectionErrorCode, message: string) {
    super(message)
    this.name = 'IdeationArtefactSectionServiceError'
  }
}
