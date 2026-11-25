// Regulatory document section + version service — Module D analogue of
// MedContentSectionService.
//
// Scope: create v0.1 + sections from a template payload on document
// creation; upsert section content on save; bump new version;
// score aiConfidence + aiFlags (worker hook).

import { Prisma, type PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { extractManifest } from '../../clinical-writing/documents/must-preserve.js'

export interface RegulatoryDocumentSectionPayload {
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  contentHtml?:  string
}

export interface RegulatoryDocumentInitialiseArgs {
  regulatoryDocumentId: string
  actorId:              string
  sections:             RegulatoryDocumentSectionPayload[]
  /** docType for SectionTemplate snapshot (migration 90). */
  docType?:             string
  /** RegulatoryDocumentTemplate.id resolved at create. Snapshots
   *  formatRules + instructions + guidance per section onto the new
   *  RegulatoryDocumentSection rows (migration 105 Package R-3). */
  templateId?:          string
  /** Pinned RegulatoryAiPromptRecord id. Snapshots the per-section
   *  sectionRules slice so later in-place edits to the pinned record
   *  can't silently flow through to in-flight documents' regenerate
   *  calls. */
  aiPromptRecordId?:    string
}

export function hashRegulatoryDocumentSections(sections: RegulatoryDocumentSectionPayload[]): string {
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

export async function initialiseRegulatoryDocumentVersion(
  tx: Prisma.TransactionClient,
  args: RegulatoryDocumentInitialiseArgs,
): Promise<{ versionId: string; versionNumber: string; sectionCount: number }> {
  const version = await tx.regulatoryDocumentVersion.create({
    data: {
      regulatoryDocumentId: args.regulatoryDocumentId,
      versionNumber: 'v0.1',
      label:         'Draft',
      contentHash:   hashRegulatoryDocumentSections(args.sections),
      isCurrent:     true,
      createdBy:     args.actorId,
    },
  })
  if (args.sections.length > 0) {
    // Per-section snapshot fields (migrations 94 + 105). Mirror Clinical
    // + Publication + Medical section-services:
    //   - templateFormatRules  : from RegulatoryDocumentTemplate.sections[].formatRules
    //   - templateInstructions : from RegulatoryDocumentTemplate.sections[].instructions
    //   - templateGuidance     : from RegulatoryDocumentTemplate.sections[].guidance
    //   - aiPromptSectionRules : from the pinned RegulatoryAiPromptRecord's
    //                            sectionRules[sectionId], deep-cloned
    //   - mustPreserveManifest : extractManifest(contentHtml) at create
    const rulesBySection        = new Map<string, string>()
    const instructionsBySection = new Map<string, string>()
    const guidanceBySection     = new Map<string, string>()
    if (args.templateId) {
      try {
        const tpl = await tx.regulatoryDocumentTemplate.findUnique({
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
        const pinned = await tx.regulatoryAiPromptRecord.findUnique({
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

    await tx.regulatoryDocumentSection.createMany({
      data: args.sections.map(s => {
        const html = s.contentHtml ?? ''
        const manifest = extractManifest(html)
        const promptRules = aiPromptRulesBySection.get(s.sectionId)
        return {
          regulatoryDocumentVersionId: version.id,
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
  await tx.regulatoryDocument.update({
    where: { id: args.regulatoryDocumentId },
    data:  { currentVersionId: version.id },
  })
  return { versionId: version.id, versionNumber: version.versionNumber, sectionCount: args.sections.length }
}

export interface UpsertRegulatorySectionArgs {
  regulatoryDocumentId: string
  sectionId:            string
  contentHtml:          string
  actorId:              string
}

export class RegulatoryDocumentSectionService {
  constructor(private readonly prisma: PrismaClient) {}

  async listCurrentSections(regulatoryDocumentId: string) {
    const doc = await this.prisma.regulatoryDocument.findUnique({
      where: { id: regulatoryDocumentId }, select: { currentVersionId: true },
    })
    if (!doc?.currentVersionId) return []
    return this.prisma.regulatoryDocumentSection.findMany({
      where:   { regulatoryDocumentVersionId: doc.currentVersionId },
      orderBy: { sectionNumber: 'asc' },
    })
  }

  async upsertSectionContent(args: UpsertRegulatorySectionArgs) {
    const doc = await this.prisma.regulatoryDocument.findUnique({
      where:  { id: args.regulatoryDocumentId },
      select: { currentVersionId: true },
    })
    if (!doc?.currentVersionId) {
      throw new RegulatoryDocumentSectionServiceError(
        'no_current_version',
        `RegulatoryDocument ${args.regulatoryDocumentId} has no current version. Initialise v0.1 first.`,
      )
    }
    const row = await this.prisma.regulatoryDocumentSection.findUnique({
      where: { regulatoryDocumentVersionId_sectionId: { regulatoryDocumentVersionId: doc.currentVersionId, sectionId: args.sectionId } },
    })
    if (!row) {
      throw new RegulatoryDocumentSectionServiceError(
        'section_not_found',
        `Section ${args.sectionId} not found on current version of document ${args.regulatoryDocumentId}.`,
      )
    }
    return this.prisma.regulatoryDocumentSection.update({
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
    regulatoryDocumentVersionId: string
    sectionId:                   string
    aiConfidence:                number
    aiFlags:                     string[]
  }) {
    return this.prisma.regulatoryDocumentSection.update({
      where: { regulatoryDocumentVersionId_sectionId: { regulatoryDocumentVersionId: args.regulatoryDocumentVersionId, sectionId: args.sectionId } },
      data:  { aiConfidence: args.aiConfidence, aiFlags: args.aiFlags },
    })
  }

  async listVersions(regulatoryDocumentId: string) {
    return this.prisma.regulatoryDocumentVersion.findMany({
      where:   { regulatoryDocumentId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async bumpVersion(args: {
    regulatoryDocumentId: string
    label:                string
    newVersionNumber:     string
    actorId:              string
    note?:                string
  }) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.regulatoryDocument.findUnique({
        where:  { id: args.regulatoryDocumentId },
        select: { currentVersionId: true },
      })
      if (!doc?.currentVersionId) {
        throw new RegulatoryDocumentSectionServiceError(
          'no_current_version',
          `RegulatoryDocument ${args.regulatoryDocumentId} has no current version to bump from.`,
        )
      }
      const sections = await tx.regulatoryDocumentSection.findMany({
        where: { regulatoryDocumentVersionId: doc.currentVersionId },
      })
      const newVersion = await tx.regulatoryDocumentVersion.create({
        data: {
          regulatoryDocumentId: args.regulatoryDocumentId,
          versionNumber: args.newVersionNumber,
          label:         args.label,
          contentHash:   hashRegulatoryDocumentSections(sections.map(s => ({
            sectionId: s.sectionId, sectionNumber: s.sectionNumber, sectionTitle: s.sectionTitle, contentHtml: s.contentHtml,
          }))),
          isCurrent:     true,
          createdBy:     args.actorId,
          restoreSource: args.note ? { note: args.note } as unknown as Prisma.InputJsonValue : undefined,
        },
      })
      if (sections.length > 0) {
        await tx.regulatoryDocumentSection.createMany({
          data: sections.map(s => ({
            regulatoryDocumentVersionId: newVersion.id,
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
      await tx.regulatoryDocumentVersion.update({
        where: { id: doc.currentVersionId },
        data:  { isCurrent: false },
      })
      await tx.regulatoryDocument.update({
        where: { id: args.regulatoryDocumentId },
        data:  { currentVersionId: newVersion.id },
      })
      return newVersion
    })
  }
}

export type RegulatoryDocumentSectionErrorCode =
  | 'no_current_version'
  | 'section_not_found'

export class RegulatoryDocumentSectionServiceError extends Error {
  constructor(public readonly code: RegulatoryDocumentSectionErrorCode, message: string) {
    super(message)
    this.name = 'RegulatoryDocumentSectionServiceError'
  }
}
