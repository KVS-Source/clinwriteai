// Med content section + version service — Module C analogue of
// PublicationSectionService.
//
// Scope: create v0.1 + sections from a template payload on content
// creation; upsert section content on save; bump new version;
// score aiConfidence + aiFlags (worker hook).

import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'

export interface MedContentSectionPayload {
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  contentHtml?:  string
}

export interface MedContentInitialiseArgs {
  contentItemId: string
  actorId:       string
  sections:      MedContentSectionPayload[]
  /** docType for SectionTemplate snapshot (migration 90). */
  docType?:      string
}

export function hashMedSections(sections: MedContentSectionPayload[]): string {
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

export async function initialiseMedContentVersion(
  tx: Prisma.TransactionClient,
  args: MedContentInitialiseArgs,
): Promise<{ versionId: string; versionNumber: string; sectionCount: number }> {
  const version = await tx.medContentVersion.create({
    data: {
      contentItemId: args.contentItemId,
      versionNumber: 'v0.1',
      label:         'Draft',
      contentHash:   hashMedSections(args.sections),
      isCurrent:     true,
      createdBy:     args.actorId,
    },
  })
  if (args.sections.length > 0) {
    // SectionTemplate snapshot (migration 90) — same pattern as clinical.
    const tplBySection = new Map<string, { id: string; formatJson: unknown }>()
    if (args.docType) {
      const docType = args.docType.replace(/-/g, '_')
      const sectionKeys = args.sections.map(s => s.sectionId)
      try {
        const templates = await tx.sectionTemplate.findMany({
          where:   { docType, sectionKey: { in: sectionKeys }, status: 'approved' },
          orderBy: { version: 'desc' },
          select:  { id: true, sectionKey: true, formatJson: true },
        })
        for (const t of templates) {
          if (!tplBySection.has(t.sectionKey)) {
            tplBySection.set(t.sectionKey, { id: t.id, formatJson: t.formatJson })
          }
        }
      } catch { /* model absent on test mocks — fine */ }
    }
    await tx.medContentSection.createMany({
      data: args.sections.map(s => {
        const tpl = tplBySection.get(s.sectionId)
        return {
          medContentVersionId: version.id,
          sectionId:           s.sectionId,
          sectionNumber:       s.sectionNumber,
          sectionTitle:        s.sectionTitle,
          contentHtml:         s.contentHtml ?? '',
          wordCount:           wordsIn(s.contentHtml ?? ''),
          sectionTemplateRecordId: tpl?.id ?? null,
          templateFormatJson:      (tpl?.formatJson as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        }
      }),
    })
  }
  await tx.medContentItem.update({
    where: { id: args.contentItemId },
    data:  { currentVersionId: version.id },
  })
  return { versionId: version.id, versionNumber: version.versionNumber, sectionCount: args.sections.length }
}

export interface UpsertMedSectionArgs {
  contentItemId: string
  sectionId:     string
  contentHtml:   string
  actorId:       string
}

export class MedContentSectionService {
  constructor(private readonly prisma: PrismaClient) {}

  async listCurrentSections(contentItemId: string) {
    const item = await this.prisma.medContentItem.findUnique({
      where: { id: contentItemId }, select: { currentVersionId: true },
    })
    if (!item?.currentVersionId) return []
    return this.prisma.medContentSection.findMany({
      where:   { medContentVersionId: item.currentVersionId },
      orderBy: { sectionNumber: 'asc' },
    })
  }

  async upsertSectionContent(args: UpsertMedSectionArgs) {
    const item = await this.prisma.medContentItem.findUnique({
      where:  { id: args.contentItemId },
      select: { currentVersionId: true },
    })
    if (!item?.currentVersionId) {
      throw new MedContentSectionServiceError(
        'no_current_version',
        `MedContentItem ${args.contentItemId} has no current version. Initialise v0.1 first.`,
      )
    }
    const row = await this.prisma.medContentSection.findUnique({
      where: { medContentVersionId_sectionId: { medContentVersionId: item.currentVersionId, sectionId: args.sectionId } },
    })
    if (!row) {
      throw new MedContentSectionServiceError(
        'section_not_found',
        `Section ${args.sectionId} not found on current version of content item ${args.contentItemId}.`,
      )
    }
    return this.prisma.medContentSection.update({
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
    medContentVersionId: string
    sectionId:           string
    aiConfidence:        number
    aiFlags:             string[]
  }) {
    return this.prisma.medContentSection.update({
      where: { medContentVersionId_sectionId: { medContentVersionId: args.medContentVersionId, sectionId: args.sectionId } },
      data:  { aiConfidence: args.aiConfidence, aiFlags: args.aiFlags },
    })
  }

  async listVersions(contentItemId: string) {
    return this.prisma.medContentVersion.findMany({
      where:   { contentItemId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async bumpVersion(args: {
    contentItemId: string
    label:         string
    newVersionNumber: string
    actorId:       string
    note?:         string
  }) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.medContentItem.findUnique({
        where:  { id: args.contentItemId },
        select: { currentVersionId: true },
      })
      if (!item?.currentVersionId) {
        throw new MedContentSectionServiceError(
          'no_current_version',
          `MedContentItem ${args.contentItemId} has no current version to bump from.`,
        )
      }
      const sections = await tx.medContentSection.findMany({
        where: { medContentVersionId: item.currentVersionId },
      })
      const newVersion = await tx.medContentVersion.create({
        data: {
          contentItemId: args.contentItemId,
          versionNumber: args.newVersionNumber,
          label:         args.label,
          contentHash:   hashMedSections(sections.map(s => ({
            sectionId: s.sectionId, sectionNumber: s.sectionNumber, sectionTitle: s.sectionTitle, contentHtml: s.contentHtml,
          }))),
          isCurrent:     true,
          createdBy:     args.actorId,
          restoreSource: args.note ? { note: args.note } as unknown as Prisma.InputJsonValue : undefined,
        },
      })
      if (sections.length > 0) {
        await tx.medContentSection.createMany({
          data: sections.map(s => ({
            medContentVersionId: newVersion.id,
            sectionId:           s.sectionId,
            sectionNumber:       s.sectionNumber,
            sectionTitle:        s.sectionTitle,
            contentHtml:         s.contentHtml,
            wordCount:           s.wordCount,
            aiSpanCount:         s.aiSpanCount,
            humanSpanCount:      s.humanSpanCount,
            aiConfidence:        s.aiConfidence,
            aiFlags:             s.aiFlags,
          })),
        })
      }
      await tx.medContentVersion.update({
        where: { id: item.currentVersionId },
        data:  { isCurrent: false },
      })
      await tx.medContentItem.update({
        where: { id: args.contentItemId },
        data:  { currentVersionId: newVersion.id },
      })
      return newVersion
    })
  }
}

export type MedContentSectionErrorCode =
  | 'no_current_version'
  | 'section_not_found'

export class MedContentSectionServiceError extends Error {
  constructor(public readonly code: MedContentSectionErrorCode, message: string) {
    super(message)
    this.name = 'MedContentSectionServiceError'
  }
}
