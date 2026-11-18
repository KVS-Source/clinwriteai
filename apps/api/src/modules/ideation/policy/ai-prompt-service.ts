// IdeationAiPromptRecord service — Module D analogue of
// MedContentAiPromptService. Draft → approved → retired lifecycle
// scoped to ideation document doctypes.

import type { PrismaClient, Prisma } from '@prisma/client'

export type IdeationAiPromptStatus = 'draft' | 'approved' | 'retired'

export type IdeationAiSectionRulesMap = Record<
  string,
  Array<{ severity: 'must' | 'should' | 'nice'; text: string }>
>

export interface IdeationAiCreateInput {
  docType:       string
  smePrompt:     string
  sectionRules?: IdeationAiSectionRulesMap
}

export interface IdeationAiUpdateDraftInput {
  smePrompt?:    string
  sectionRules?: IdeationAiSectionRulesMap
}

export class IdeationAiPromptService {
  constructor(private readonly prisma: PrismaClient) {}

  async getApproved(docType: string) {
    return this.prisma.ideationAiPromptRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
    })
  }

  async listVersions(docType: string) {
    return this.prisma.ideationAiPromptRecord.findMany({
      where:   { docType },
      orderBy: { version: 'desc' },
    })
  }

  async listAllApproved() {
    return this.prisma.ideationAiPromptRecord.findMany({
      where:   { status: 'approved' },
      orderBy: { docType: 'asc' },
    })
  }

  async findById(id: string) {
    return this.prisma.ideationAiPromptRecord.findUnique({ where: { id } })
  }

  async createDraft(input: IdeationAiCreateInput, actorId: string) {
    const docType = input.docType.replace(/-/g, '_')
    const existingDraft = await this.prisma.ideationAiPromptRecord.findFirst({
      where: { docType, status: 'draft' },
    })
    if (existingDraft) {
      throw new IdeationAiPromptServiceError(
        'draft_exists',
        `A draft prompt already exists for '${docType}' (version ${existingDraft.version}). Edit or approve it instead.`,
      )
    }
    const last = await this.prisma.ideationAiPromptRecord.findFirst({
      where:   { docType },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    return this.prisma.ideationAiPromptRecord.create({
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

  async updateDraft(id: string, input: IdeationAiUpdateDraftInput, actorId: string) {
    const row = await this.prisma.ideationAiPromptRecord.findUnique({ where: { id } })
    if (!row) throw new IdeationAiPromptServiceError('not_found', `IdeationAiPromptRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new IdeationAiPromptServiceError(
        'not_a_draft',
        `Row is '${row.status}' and immutable. Start a new draft to change the prompt.`,
      )
    }
    return this.prisma.ideationAiPromptRecord.update({
      where: { id },
      data:  {
        ...(input.smePrompt    !== undefined && { smePrompt:    input.smePrompt }),
        ...(input.sectionRules !== undefined && { sectionRules: input.sectionRules as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  async approve(id: string, actorId: string) {
    const row = await this.prisma.ideationAiPromptRecord.findUnique({ where: { id } })
    if (!row) throw new IdeationAiPromptServiceError('not_found', `IdeationAiPromptRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new IdeationAiPromptServiceError('not_a_draft', `Only drafts can be approved (this row is '${row.status}').`)
    }
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const previous = await tx.ideationAiPromptRecord.findFirst({
        where: { docType: row.docType, status: 'approved' },
      })
      if (previous) {
        await tx.ideationAiPromptRecord.update({
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
      return tx.ideationAiPromptRecord.update({
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
    const row = await this.prisma.ideationAiPromptRecord.findUnique({ where: { id } })
    if (!row) throw new IdeationAiPromptServiceError('not_found', `IdeationAiPromptRecord ${id} not found.`)
    if (row.status === 'retired') {
      throw new IdeationAiPromptServiceError('already_retired', 'Row is already retired.')
    }
    return this.prisma.ideationAiPromptRecord.update({
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

export type IdeationAiPromptErrorCode =
  | 'not_found'
  | 'draft_exists'
  | 'not_a_draft'
  | 'already_retired'

export class IdeationAiPromptServiceError extends Error {
  constructor(public readonly code: IdeationAiPromptErrorCode, message: string) {
    super(message)
    this.name = 'IdeationAiPromptServiceError'
  }
}
