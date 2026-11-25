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

import { Prisma, type PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { extractManifest } from '../../clinical-writing/documents/must-preserve.js'

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
  /** docType for SectionTemplate snapshot lookup (migration 90). When
   *  provided, each PublicationSectionContent row is seeded with the
   *  approved template's formatJson so AI calls get formatting hints. */
  docType?:      string
  /** PublicationTemplate.id of the resolved-at-create-time template.
   *  Snapshots formatRules + instructions + guidance per section onto
   *  the new PublicationSectionContent rows (migration 105 Package B-4).
   *  Routes already resolve this via policy.templateId before calling. */
  templateId?:   string
  /** Pinned PublicationAiPromptRecord id. Snapshots the per-section
   *  sectionRules slice onto PublicationSectionContent.aiPromptSectionRules
   *  so later in-place edits to the pinned record can't silently flow
   *  through to in-flight publications' regenerate calls. */
  aiPromptRecordId?: string
}

/** A PublicationTemplate's `sections` JSON → the v0.1 section payloads for a new publication. Each section keeps its
 *  id / number / title and starts with the template's starterHtml (sub-headings, [placeholders], table shells, e.g.
 *  docs/templates/manuscript-original-research.template.json); a section without one starts empty. */
export function templateSectionPayloads(raw: unknown): PublicationSectionPayload[] {
  if (!Array.isArray(raw)) return []
  return (raw as Array<{ id?: unknown; number?: unknown; title?: unknown; starterHtml?: unknown }>).map((s, i) => ({
    sectionId:     String(s.id ?? `s${i + 1}`),
    sectionNumber: String(s.number ?? i + 1),
    sectionTitle:  String(s.title ?? `Section ${i + 1}`),
    ...(typeof s.starterHtml === 'string' && s.starterHtml && { contentHtml: s.starterHtml }),
  }))
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
    // Per-section snapshot fields (migrations 94 + 105):
    //   - templateFormatRules  : from PublicationTemplate.sections[].formatRules
    //   - templateInstructions : from PublicationTemplate.sections[].instructions
    //   - templateGuidance     : from PublicationTemplate.sections[].guidance
    //   - aiPromptSectionRules : from the pinned PublicationAiPromptRecord's
    //                            sectionRules[sectionId], deep-cloned
    //   - mustPreserveManifest : extractManifest(contentHtml) at create
    //
    // Mirrors the Clinical Writing service (apps/api/src/modules/
    // clinical-writing/documents/service.ts). Admin edits to the template
    // after pub-create can't silently change what in-flight publications
    // draft against.
    const rulesBySection        = new Map<string, string>()
    const instructionsBySection = new Map<string, string>()
    const guidanceBySection     = new Map<string, string>()
    if (args.templateId) {
      try {
        const tpl = await tx.publicationTemplate.findUnique({
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
        const pinned = await tx.publicationAiPromptRecord.findUnique({
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

    await tx.publicationSectionContent.createMany({
      data: args.sections.map(s => {
        const html = s.contentHtml ?? ''
        const manifest = extractManifest(html)
        const promptRules = aiPromptRulesBySection.get(s.sectionId)
        return {
          publicationVersionId: version.id,
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
    const rows = await this.prisma.publicationSectionContent.findMany({
      where:   { publicationVersionId: pub.currentVersionId },
    })
    // Natural order by section number: "1, 2, … 10, 12" and "2.1 < 2.10". A text sort put "10" before "2", so a
    // template with ten or more sections listed Tables & figures right after the Title page.
    return rows.sort((a, b) => a.sectionNumber.localeCompare(b.sectionNumber, 'en', { numeric: true }))
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
