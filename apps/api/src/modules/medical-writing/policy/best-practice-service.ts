// MedContentBestPracticeRecord service — Module C analogue of
// PublicationBestPracticeService. Draft → approved → retired for BP
// digests scoped to medical content doctypes. The distill worker
// (med_content.distill_best_practice) upserts drafts here.

import type { PrismaClient, Prisma } from '@prisma/client'

export type MedContentBestPracticeStatus = 'draft' | 'approved' | 'retired'

export interface MedContentBpDigestPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface MedContentBpDigestShape {
  principles:     MedContentBpDigestPrinciple[]
  sourcePdfId?:   string
  distilledAt?:   string
  distilledModel?: string
}

export interface MedContentBpUpdateDraftInput {
  digest?: MedContentBpDigestShape
}

export interface MedContentBpDistillUpsertInput {
  docType:        string
  digest:         MedContentBpDigestShape
  sourcePdfId:    string
  distilledModel: string
  actorId:        string
}

export class MedContentBestPracticeService {
  constructor(private readonly prisma: PrismaClient) {}

  async getApproved(docType: string) {
    return this.prisma.medContentBestPracticeRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
    })
  }

  async listVersions(docType: string) {
    return this.prisma.medContentBestPracticeRecord.findMany({
      where:   { docType },
      orderBy: { version: 'desc' },
    })
  }

  async listAllApproved() {
    return this.prisma.medContentBestPracticeRecord.findMany({
      where:   { status: 'approved' },
      orderBy: { docType: 'asc' },
    })
  }

  async findById(id: string) {
    return this.prisma.medContentBestPracticeRecord.findUnique({ where: { id } })
  }

  async updateDraft(id: string, input: MedContentBpUpdateDraftInput, actorId: string) {
    const row = await this.prisma.medContentBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new MedContentBpServiceError('not_found', `MedContentBestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new MedContentBpServiceError('not_a_draft', `Row is '${row.status}' and immutable.`)
    }
    return this.prisma.medContentBestPracticeRecord.update({
      where: { id },
      data:  {
        ...(input.digest !== undefined && { digest: input.digest as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  async approve(id: string, actorId: string) {
    const row = await this.prisma.medContentBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new MedContentBpServiceError('not_found', `MedContentBestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new MedContentBpServiceError('not_a_draft', `Only drafts can be approved (this row is '${row.status}').`)
    }
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const previous = await tx.medContentBestPracticeRecord.findFirst({
        where: { docType: row.docType, status: 'approved' },
      })
      if (previous) {
        await tx.medContentBestPracticeRecord.update({
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
      return tx.medContentBestPracticeRecord.update({
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
    const row = await this.prisma.medContentBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new MedContentBpServiceError('not_found', `MedContentBestPracticeRecord ${id} not found.`)
    if (row.status === 'retired') {
      throw new MedContentBpServiceError('already_retired', 'Row is already retired.')
    }
    return this.prisma.medContentBestPracticeRecord.update({
      where: { id },
      data: {
        status:       'retired',
        retiredAt:    new Date(),
        retireReason: reason,
        updatedBy:    actorId,
      },
    })
  }

  async upsertDraftFromDistillation(input: MedContentBpDistillUpsertInput) {
    const docType = input.docType.replace(/-/g, '_')
    const existingDraft = await this.prisma.medContentBestPracticeRecord.findFirst({
      where: { docType, status: 'draft' },
    })
    const now = new Date()
    if (existingDraft) {
      return this.prisma.medContentBestPracticeRecord.update({
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
    const last = await this.prisma.medContentBestPracticeRecord.findFirst({
      where:   { docType },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    return this.prisma.medContentBestPracticeRecord.create({
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

export type MedContentBpErrorCode =
  | 'not_found'
  | 'not_a_draft'
  | 'already_retired'

export class MedContentBpServiceError extends Error {
  constructor(public readonly code: MedContentBpErrorCode, message: string) {
    super(message)
    this.name = 'MedContentBpServiceError'
  }
}
