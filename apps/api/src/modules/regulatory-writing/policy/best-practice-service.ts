// RegulatoryBestPracticeRecord service — Module D analogue of
// MedContentBestPracticeService. Draft → approved → retired for BP
// digests scoped to regulatory docTypes. The distill worker
// (regulatory.distill_best_practice) upserts drafts here.

import type { PrismaClient, Prisma } from '@prisma/client'

export type RegulatoryBestPracticeStatus = 'draft' | 'approved' | 'retired'

export interface RegulatoryBpDigestPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface RegulatoryBpDigestShape {
  principles:      RegulatoryBpDigestPrinciple[]
  sourcePdfId?:    string
  distilledAt?:    string
  distilledModel?: string
}

export interface RegulatoryBpUpdateDraftInput {
  digest?: RegulatoryBpDigestShape
}

export interface RegulatoryBpDistillUpsertInput {
  docType:        string
  digest:         RegulatoryBpDigestShape
  sourcePdfId:    string
  distilledModel: string
  actorId:        string
}

export class RegulatoryBestPracticeService {
  constructor(private readonly prisma: PrismaClient) {}

  async getApproved(docType: string) {
    return this.prisma.regulatoryBestPracticeRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
    })
  }

  async listVersions(docType: string) {
    return this.prisma.regulatoryBestPracticeRecord.findMany({
      where:   { docType },
      orderBy: { version: 'desc' },
    })
  }

  async listAllApproved() {
    return this.prisma.regulatoryBestPracticeRecord.findMany({
      where:   { status: 'approved' },
      orderBy: { docType: 'asc' },
    })
  }

  async findById(id: string) {
    return this.prisma.regulatoryBestPracticeRecord.findUnique({ where: { id } })
  }

  async updateDraft(id: string, input: RegulatoryBpUpdateDraftInput, actorId: string) {
    const row = await this.prisma.regulatoryBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new RegulatoryBpServiceError('not_found', `RegulatoryBestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new RegulatoryBpServiceError('not_a_draft', `Row is '${row.status}' and immutable.`)
    }
    return this.prisma.regulatoryBestPracticeRecord.update({
      where: { id },
      data:  {
        ...(input.digest !== undefined && { digest: input.digest as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  async approve(id: string, actorId: string) {
    const row = await this.prisma.regulatoryBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new RegulatoryBpServiceError('not_found', `RegulatoryBestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new RegulatoryBpServiceError('not_a_draft', `Only drafts can be approved (this row is '${row.status}').`)
    }
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const previous = await tx.regulatoryBestPracticeRecord.findFirst({
        where: { docType: row.docType, status: 'approved' },
      })
      if (previous) {
        await tx.regulatoryBestPracticeRecord.update({
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
      return tx.regulatoryBestPracticeRecord.update({
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
    const row = await this.prisma.regulatoryBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new RegulatoryBpServiceError('not_found', `RegulatoryBestPracticeRecord ${id} not found.`)
    if (row.status === 'retired') {
      throw new RegulatoryBpServiceError('already_retired', 'Row is already retired.')
    }
    return this.prisma.regulatoryBestPracticeRecord.update({
      where: { id },
      data: {
        status:       'retired',
        retiredAt:    new Date(),
        retireReason: reason,
        updatedBy:    actorId,
      },
    })
  }

  async upsertDraftFromDistillation(input: RegulatoryBpDistillUpsertInput) {
    const docType = input.docType.replace(/-/g, '_')
    const existingDraft = await this.prisma.regulatoryBestPracticeRecord.findFirst({
      where: { docType, status: 'draft' },
    })
    const now = new Date()
    if (existingDraft) {
      return this.prisma.regulatoryBestPracticeRecord.update({
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
    const last = await this.prisma.regulatoryBestPracticeRecord.findFirst({
      where:   { docType },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    return this.prisma.regulatoryBestPracticeRecord.create({
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

export type RegulatoryBpErrorCode =
  | 'not_found'
  | 'not_a_draft'
  | 'already_retired'

export class RegulatoryBpServiceError extends Error {
  constructor(public readonly code: RegulatoryBpErrorCode, message: string) {
    super(message)
    this.name = 'RegulatoryBpServiceError'
  }
}
