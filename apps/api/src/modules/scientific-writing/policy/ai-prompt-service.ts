// PublicationAiPromptRecord service — Module B analogue of the
// AiPromptService in modules/platform/ai-prompt/service.ts.
//
// Exact same draft → approved → retired lifecycle, scoped to publication
// doctypes (manuscript_full_research, manuscript_review_systematic,
// abstract, poster, letter, pls, …).
//
// Rules:
//   - Exactly one 'approved' row per docType at a time. Approve atomically
//     retires the previous approved row with supersededBy = new id.
//   - Only 'draft' rows are mutable; approved / retired are audit snapshots.
//   - version is per-docType auto-increment.

import type { PrismaClient, Prisma } from '@prisma/client'

export type PublicationAiPromptStatus = 'draft' | 'approved' | 'retired'

export type PublicationAiSectionRulesMap = Record<
  string,
  Array<{ severity: 'must' | 'should' | 'nice'; text: string }>
>

export interface PublicationAiCreateInput {
  docType:       string
  smePrompt:     string
  sectionRules?: PublicationAiSectionRulesMap
}

export interface PublicationAiUpdateDraftInput {
  smePrompt?:    string
  sectionRules?: PublicationAiSectionRulesMap
}

export class PublicationAiPromptService {
  constructor(private readonly prisma: PrismaClient) {}

  async getApproved(docType: string) {
    return this.prisma.publicationAiPromptRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
    })
  }

  async listVersions(docType: string) {
    return this.prisma.publicationAiPromptRecord.findMany({
      where:   { docType },
      orderBy: { version: 'desc' },
    })
  }

  async listAllApproved() {
    return this.prisma.publicationAiPromptRecord.findMany({
      where:   { status: 'approved' },
      orderBy: { docType: 'asc' },
    })
  }

  async findById(id: string) {
    return this.prisma.publicationAiPromptRecord.findUnique({ where: { id } })
  }

  async createDraft(input: PublicationAiCreateInput, actorId: string) {
    const docType = input.docType.replace(/-/g, '_')
    const existingDraft = await this.prisma.publicationAiPromptRecord.findFirst({
      where: { docType, status: 'draft' },
    })
    if (existingDraft) {
      throw new PublicationAiPromptServiceError(
        'draft_exists',
        `A draft prompt already exists for '${docType}' (version ${existingDraft.version}). Edit or approve it instead.`,
      )
    }
    const last = await this.prisma.publicationAiPromptRecord.findFirst({
      where:   { docType },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    return this.prisma.publicationAiPromptRecord.create({
      data: {
        docType,
        version:      nextVersion,
        status:       'draft',
        smePrompt:    input.smePrompt,
        sectionRules: (input.sectionRules ?? {}) as unknown as Prisma.InputJsonValue,
        createdBy:    actorId,
        updatedBy:    actorId,
      },
    })
  }

  async updateDraft(id: string, input: PublicationAiUpdateDraftInput, actorId: string) {
    const row = await this.prisma.publicationAiPromptRecord.findUnique({ where: { id } })
    if (!row) throw new PublicationAiPromptServiceError('not_found', `PublicationAiPromptRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new PublicationAiPromptServiceError(
        'not_a_draft',
        `Row is '${row.status}' and immutable. Start a new draft to change the prompt.`,
      )
    }
    return this.prisma.publicationAiPromptRecord.update({
      where: { id },
      data:  {
        ...(input.smePrompt    !== undefined && { smePrompt:    input.smePrompt }),
        ...(input.sectionRules !== undefined && { sectionRules: input.sectionRules as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  async approve(id: string, actorId: string) {
    const row = await this.prisma.publicationAiPromptRecord.findUnique({ where: { id } })
    if (!row) throw new PublicationAiPromptServiceError('not_found', `PublicationAiPromptRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new PublicationAiPromptServiceError('not_a_draft', `Only drafts can be approved (this row is '${row.status}').`)
    }
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const previous = await tx.publicationAiPromptRecord.findFirst({
        where: { docType: row.docType, status: 'approved' },
      })
      if (previous) {
        await tx.publicationAiPromptRecord.update({
          where: { id: previous.id },
          data: {
            status:       'retired',
            retiredAt:    now,
            retireReason: 'superseded',
            supersededBy: row.id,
            updatedBy:    actorId,
          },
        })
      }
      return tx.publicationAiPromptRecord.update({
        where: { id: row.id },
        data: {
          status:        'approved',
          approvedBy:    actorId,
          approvedAt:    now,
          effectiveDate: now,
          updatedBy:     actorId,
        },
      })
    })
  }

  async retire(id: string, reason: string, actorId: string) {
    const row = await this.prisma.publicationAiPromptRecord.findUnique({ where: { id } })
    if (!row) throw new PublicationAiPromptServiceError('not_found', `PublicationAiPromptRecord ${id} not found.`)
    if (row.status === 'retired') {
      throw new PublicationAiPromptServiceError('already_retired', 'Row is already retired.')
    }
    return this.prisma.publicationAiPromptRecord.update({
      where: { id },
      data: {
        status:       'retired',
        retiredAt:    new Date(),
        retireReason: reason,
        updatedBy:    actorId,
      },
    })
  }
}

export type PublicationAiPromptErrorCode =
  | 'not_found'
  | 'draft_exists'
  | 'not_a_draft'
  | 'already_retired'

export class PublicationAiPromptServiceError extends Error {
  constructor(public readonly code: PublicationAiPromptErrorCode, message: string) {
    super(message)
    this.name = 'PublicationAiPromptServiceError'
  }
}
