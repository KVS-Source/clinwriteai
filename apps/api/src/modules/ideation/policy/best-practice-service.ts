// IdeationBestPracticeRecord service — Module D analogue of
// MedContentBestPracticeService. Draft → approved → retired for BP
// digests scoped to ideation docTypes. The distill worker
// (ideation.distill_best_practice) upserts drafts here.

import type { PrismaClient, Prisma } from '@prisma/client'

export type IdeationBestPracticeStatus = 'draft' | 'approved' | 'retired'

export interface IdeationBpDigestPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface IdeationBpDigestShape {
  principles:      IdeationBpDigestPrinciple[]
  sourcePdfId?:    string
  distilledAt?:    string
  distilledModel?: string
}

export interface IdeationBpUpdateDraftInput {
  digest?: IdeationBpDigestShape
}

export interface IdeationBpDistillUpsertInput {
  docType:        string
  digest:         IdeationBpDigestShape
  sourcePdfId:    string
  distilledModel: string
  actorId:        string
}

export class IdeationBestPracticeService {
  constructor(private readonly prisma: PrismaClient) {}

  async getApproved(docType: string) {
    return this.prisma.ideationBestPracticeRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
    })
  }

  async listVersions(docType: string) {
    return this.prisma.ideationBestPracticeRecord.findMany({
      where:   { docType },
      orderBy: { version: 'desc' },
    })
  }

  async listAllApproved() {
    return this.prisma.ideationBestPracticeRecord.findMany({
      where:   { status: 'approved' },
      orderBy: { docType: 'asc' },
    })
  }

  async findById(id: string) {
    return this.prisma.ideationBestPracticeRecord.findUnique({ where: { id } })
  }

  async updateDraft(id: string, input: IdeationBpUpdateDraftInput, actorId: string) {
    const row = await this.prisma.ideationBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new IdeationBpServiceError('not_found', `IdeationBestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new IdeationBpServiceError('not_a_draft', `Row is '${row.status}' and immutable.`)
    }
    return this.prisma.ideationBestPracticeRecord.update({
      where: { id },
      data:  {
        ...(input.digest !== undefined && { digest: input.digest as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  async approve(id: string, actorId: string) {
    const row = await this.prisma.ideationBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new IdeationBpServiceError('not_found', `IdeationBestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new IdeationBpServiceError('not_a_draft', `Only drafts can be approved (this row is '${row.status}').`)
    }
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const previous = await tx.ideationBestPracticeRecord.findFirst({
        where: { docType: row.docType, status: 'approved' },
      })
      if (previous) {
        await tx.ideationBestPracticeRecord.update({
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
      return tx.ideationBestPracticeRecord.update({
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
    const row = await this.prisma.ideationBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new IdeationBpServiceError('not_found', `IdeationBestPracticeRecord ${id} not found.`)
    if (row.status === 'retired') {
      throw new IdeationBpServiceError('already_retired', 'Row is already retired.')
    }
    return this.prisma.ideationBestPracticeRecord.update({
      where: { id },
      data: {
        status:       'retired',
        retiredAt:    new Date(),
        retireReason: reason,
        updatedBy:    actorId,
      },
    })
  }

  async upsertDraftFromDistillation(input: IdeationBpDistillUpsertInput) {
    const docType = input.docType.replace(/-/g, '_')
    const existingDraft = await this.prisma.ideationBestPracticeRecord.findFirst({
      where: { docType, status: 'draft' },
    })
    const now = new Date()
    if (existingDraft) {
      return this.prisma.ideationBestPracticeRecord.update({
        where: { id: existingDraft.id },
        data: {
          digest:         input.digest as unknown as Prisma.InputJsonValue,
          sourcePdfId:    input.sourcePdfId,
          distilledAt:    now,
          distilledModel: input.distilledModel,
          updatedBy:      input.actorId,
        },
      })
    }
    const last = await this.prisma.ideationBestPracticeRecord.findFirst({
      where:   { docType },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    return this.prisma.ideationBestPracticeRecord.create({
      data: {
        docType,
        version:        nextVersion,
        status:         'draft',
        digest:         input.digest as unknown as Prisma.InputJsonValue,
        sourcePdfId:    input.sourcePdfId,
        distilledAt:    now,
        distilledModel: input.distilledModel,
        createdBy:      input.actorId,
        updatedBy:      input.actorId,
      },
    })
  }
}

export type IdeationBpErrorCode =
  | 'not_found'
  | 'not_a_draft'
  | 'already_retired'

export class IdeationBpServiceError extends Error {
  constructor(public readonly code: IdeationBpErrorCode, message: string) {
    super(message)
    this.name = 'IdeationBpServiceError'
  }
}
