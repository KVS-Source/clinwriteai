// PublicationBestPracticeRecord service — Module B analogue of the
// BestPracticeService in modules/platform/best-practice/service.ts.
//
// Same draft → approved → retired lifecycle. The distiller worker (lands
// in Phase M-B.3) upserts drafts here; admin promotes via approve().

import type { PrismaClient, Prisma } from '@prisma/client'

export type PublicationBestPracticeStatus = 'draft' | 'approved' | 'retired'

export interface PublicationBpDigestPrinciple {
  scope:    string               // 'whole-doc' | 'section:<key>'
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface PublicationBpDigestShape {
  principles:     PublicationBpDigestPrinciple[]
  sourcePdfId?:   string
  distilledAt?:   string
  distilledModel?: string
}

export interface PublicationBpUpdateDraftInput {
  digest?: PublicationBpDigestShape
}

export interface PublicationBpDistillUpsertInput {
  docType:        string
  digest:         PublicationBpDigestShape
  sourcePdfId:    string
  distilledModel: string
  actorId:        string
}

export class PublicationBestPracticeService {
  constructor(private readonly prisma: PrismaClient) {}

  async getApproved(docType: string) {
    return this.prisma.publicationBestPracticeRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
    })
  }

  async listVersions(docType: string) {
    return this.prisma.publicationBestPracticeRecord.findMany({
      where:   { docType },
      orderBy: { version: 'desc' },
    })
  }

  async listAllApproved() {
    return this.prisma.publicationBestPracticeRecord.findMany({
      where:   { status: 'approved' },
      orderBy: { docType: 'asc' },
    })
  }

  async findById(id: string) {
    return this.prisma.publicationBestPracticeRecord.findUnique({ where: { id } })
  }

  async updateDraft(id: string, input: PublicationBpUpdateDraftInput, actorId: string) {
    const row = await this.prisma.publicationBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new PublicationBpServiceError('not_found', `PublicationBestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new PublicationBpServiceError(
        'not_a_draft',
        `Row is '${row.status}' and immutable. Start a new draft to change the digest.`,
      )
    }
    return this.prisma.publicationBestPracticeRecord.update({
      where: { id },
      data:  {
        ...(input.digest !== undefined && { digest: input.digest as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  async approve(id: string, actorId: string) {
    const row = await this.prisma.publicationBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new PublicationBpServiceError('not_found', `PublicationBestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new PublicationBpServiceError('not_a_draft', `Only drafts can be approved (this row is '${row.status}').`)
    }
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const previous = await tx.publicationBestPracticeRecord.findFirst({
        where: { docType: row.docType, status: 'approved' },
      })
      if (previous) {
        await tx.publicationBestPracticeRecord.update({
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
      return tx.publicationBestPracticeRecord.update({
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
    const row = await this.prisma.publicationBestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new PublicationBpServiceError('not_found', `PublicationBestPracticeRecord ${id} not found.`)
    if (row.status === 'retired') {
      throw new PublicationBpServiceError('already_retired', 'Row is already retired.')
    }
    return this.prisma.publicationBestPracticeRecord.update({
      where: { id },
      data: {
        status:       'retired',
        retiredAt:    new Date(),
        retireReason: reason,
        updatedBy:    actorId,
      },
    })
  }

  /** Called by the publications BP distillation worker (Phase M-B.3)
   *  when a new BP PDF is parsed. Overwrites any existing draft for the
   *  docType, else creates a fresh draft at next version. */
  async upsertDraftFromDistillation(input: PublicationBpDistillUpsertInput) {
    const docType = input.docType.replace(/-/g, '_')
    const existingDraft = await this.prisma.publicationBestPracticeRecord.findFirst({
      where: { docType, status: 'draft' },
    })
    const now = new Date()
    if (existingDraft) {
      return this.prisma.publicationBestPracticeRecord.update({
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
    const last = await this.prisma.publicationBestPracticeRecord.findFirst({
      where:   { docType },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    return this.prisma.publicationBestPracticeRecord.create({
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

export type PublicationBpErrorCode =
  | 'not_found'
  | 'not_a_draft'
  | 'already_retired'

export class PublicationBpServiceError extends Error {
  constructor(public readonly code: PublicationBpErrorCode, message: string) {
    super(message)
    this.name = 'PublicationBpServiceError'
  }
}
