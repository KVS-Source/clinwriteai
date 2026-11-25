// Med content section + version service — Module C analogue of
// PublicationSectionService.
//
// Scope: create v0.1 + sections from a template payload on content
// creation; upsert section content on save; bump new version;
// score aiConfidence + aiFlags (worker hook).

import { Prisma, type PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { extractManifest } from '../../clinical-writing/documents/must-preserve.js'

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
  /** MedContentTemplate.id resolved at create. Snapshots formatRules +
   *  instructions + guidance per section onto the new MedContentSection
   *  rows (migration 105 Package C-3). Routes resolve this via
   *  policy.templateId before calling. */
  templateId?:   string
  /** Pinned MedContentAiPromptRecord id. Snapshots the per-section
   *  sectionRules slice so later in-place edits to the pinned record
   *  can't silently flow through to in-flight content's regenerate calls. */
  aiPromptRecordId?: string
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
    // Per-section snapshot fields (migrations 94 + 105). Mirror the
    // Clinical + Publication services (Package 6 / B-4):
    //   - templateFormatRules  : from MedContentTemplate.sections[].formatRules
    //   - templateInstructions : from MedContentTemplate.sections[].instructions
    //   - templateGuidance     : from MedContentTemplate.sections[].guidance
    //   - aiPromptSectionRules : from the pinned MedContentAiPromptRecord's
    //                            sectionRules[sectionId], deep-cloned
    //   - mustPreserveManifest : extractManifest(contentHtml) at create
    //
    // Admin edits to the template after create can't silently change
    // what in-flight content items draft against — snapshot is pinned.
    const rulesBySection        = new Map<string, string>()
    const instructionsBySection = new Map<string, string>()
    const guidanceBySection     = new Map<string, string>()
    if (args.templateId) {
      try {
        const tpl = await tx.medContentTemplate.findUnique({
          where:  { id: args.templateId },
          select: { sections: true },
        })
        if (tpl?.sections && Array.isArray(tpl.sections)) {
          for (const raw of tpl.sections as Array<Record<string, unknown>>) {
            const id = typeof raw.id === 'string' ? raw.id : null
            if (!id) continue
            const rules        = typeof raw.formatRules  === 'string' ? raw.formatRules.trim()  : ''
            const instructions = typeof raw.instructions === 'string' ? raw.instructions.trim() : ''
            const guidance     = typeof raw.guidance     === 'string' ? raw.guidance.trim()     : ''
            if (rules.length        > 0) rulesBySection.set(id, rules)
            if (instructions.length > 0) instructionsBySection.set(id, instructions)
            if (guidance.length     > 0) guidanceBySection.set(id, guidance)
          }
        }
      } catch { /* missing template → snapshots stay null */ }
    }

    const aiPromptRulesBySection = new Map<string, unknown>()
    if (args.aiPromptRecordId) {
      try {
        const pinned = await tx.medContentAiPromptRecord.findUnique({
          where:  { id: args.aiPromptRecordId },
          select: { sectionRules: true },
        })
        const sectionRules = pinned?.sectionRules as Record<string, unknown> | null | undefined
        if (sectionRules && typeof sectionRules === 'object' && !Array.isArray(sectionRules)) {
          for (const s of args.sections) {
            const slice = sectionRules[s.sectionId]
            if (slice !== undefined) aiPromptRulesBySection.set(s.sectionId, JSON.parse(JSON.stringify(slice)))
          }
        }
      } catch { /* missing pinned prompt → snapshots stay null */ }
    }

    await tx.medContentSection.createMany({
      data: args.sections.map(s => {
        const html = s.contentHtml ?? ''
        const manifest = extractManifest(html)
        const promptRules = aiPromptRulesBySection.get(s.sectionId)
        return {
          medContentVersionId:  version.id,
          sectionId:            s.sectionId,
          sectionNumber:        s.sectionNumber,
          sectionTitle:         s.sectionTitle,
          contentHtml:          html,
          wordCount:            wordsIn(html),
          templateFormatRules:  rulesBySection.get(s.sectionId)        ?? null,
          templateInstructions: instructionsBySection.get(s.sectionId) ?? null,
          templateGuidance:     guidanceBySection.get(s.sectionId)     ?? null,
          aiPromptSectionRules: (promptRules ?? Prisma.DbNull) as unknown as Prisma.InputJsonValue,
          mustPreserveManifest: (manifest    ?? Prisma.DbNull) as unknown as Prisma.InputJsonValue,
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
