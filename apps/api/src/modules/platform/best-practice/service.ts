// BestPracticeRecord service — all invariants for the draft → approved
// → retired workflow live here so routes + the distiller worker stay
// thin.
//
// Rules (mirror of AiPromptService):
//   - Exactly one `status='approved'` row per (docType) at any time. On
//     approve, the previous approved row flips to 'retired' +
//     supersededBy = new row id (atomic in a transaction).
//   - 'draft' rows are editable in place (digest). 'approved' and
//     'retired' rows are immutable snapshots.
//   - version is per-docType, auto-incremented on create.
//   - The distiller worker calls `upsertDraftFromDistillation` so a
//     second upload replaces the pending draft instead of piling up
//     multiple drafts per docType.

import type { PrismaClient, Prisma } from '@prisma/client'

export type BestPracticeStatus = 'draft' | 'approved' | 'retired'

export interface DigestPrinciple {
  scope:    string               // 'whole-doc' | 'section:<key>'
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface DigestShape {
  principles:     DigestPrinciple[]
  sourcePdfId?:   string
  distilledAt?:   string
  distilledModel?: string
}

export interface UpdateDraftInput {
  digest?: DigestShape
}

export interface DistillUpsertInput {
  docType:        string
  digest:         DigestShape
  sourcePdfId:    string
  distilledModel: string
  actorId:        string
}

export class BestPracticeService {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------------------------------------------------------------- reads

  /** Latest approved row for a docType, or null. The resolver reads this
   *  when the Document has no pin. */
  async getApproved(docType: string) {
    return this.prisma.bestPracticeRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
    })
  }

  /** Every row for a docType, newest first — admin history view. */
  async listVersions(docType: string) {
    return this.prisma.bestPracticeRecord.findMany({
      where:   { docType },
      orderBy: { version: 'desc' },
    })
  }

  /** Latest-approved row for every docType (list screen). */
  async listAllApproved() {
    return this.prisma.bestPracticeRecord.findMany({
      where:   { status: 'approved' },
      orderBy: { docType: 'asc' },
    })
  }

  async findById(id: string) {
    return this.prisma.bestPracticeRecord.findUnique({ where: { id } })
  }

  // --------------------------------------------------------------- writes

  /** Edit a draft's digest in place. 409 for non-draft rows. */
  async updateDraft(id: string, input: UpdateDraftInput, actorId: string) {
    const row = await this.prisma.bestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new BestPracticeServiceError('not_found', `BestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new BestPracticeServiceError(
        'not_a_draft',
        `Row is '${row.status}' and immutable. Start a new draft to change the digest — approved/retired rows are audit snapshots.`,
      )
    }
    return this.prisma.bestPracticeRecord.update({
      where: { id },
      data:  {
        ...(input.digest !== undefined && { digest: input.digest as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  /** Promote a draft to approved. Flips the previously-approved row of
   *  the same docType to retired + supersededBy = this row id. Atomic. */
  async approve(id: string, actorId: string) {
    const row = await this.prisma.bestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new BestPracticeServiceError('not_found', `BestPracticeRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new BestPracticeServiceError('not_a_draft', `Only drafts can be approved (this row is '${row.status}').`)
    }
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const previous = await tx.bestPracticeRecord.findFirst({
        where: { docType: row.docType, status: 'approved' },
      })
      if (previous) {
        await tx.bestPracticeRecord.update({
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
      return tx.bestPracticeRecord.update({
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

  /** Retire a draft or approved row. Approved rows should normally be
   *  retired implicitly via `approve` of a replacement. */
  async retire(id: string, reason: string, actorId: string) {
    const row = await this.prisma.bestPracticeRecord.findUnique({ where: { id } })
    if (!row) throw new BestPracticeServiceError('not_found', `BestPracticeRecord ${id} not found.`)
    if (row.status === 'retired') {
      throw new BestPracticeServiceError('already_retired', 'Row is already retired.')
    }
    return this.prisma.bestPracticeRecord.update({
      where: { id },
      data: {
        status:       'retired',
        retiredAt:    new Date(),
        retireReason: reason,
        updatedBy:    actorId,
      },
    })
  }

  /** Called by the distill-best-practice worker when a new BP PDF has
   *  been parsed. Behaviour:
   *    - If a draft already exists for the docType, overwrite its
   *      digest + breadcrumbs (one pending draft per docType is the
   *      invariant — admin couldn't reasonably compare two).
   *    - Else create a fresh draft at version = (max for docType) + 1.
   *  Returns the resulting draft row. */
  async upsertDraftFromDistillation(input: DistillUpsertInput) {
    const docType = input.docType.replace(/-/g, '_')
    const existingDraft = await this.prisma.bestPracticeRecord.findFirst({
      where: { docType, status: 'draft' },
    })
    const now = new Date()
    if (existingDraft) {
      return this.prisma.bestPracticeRecord.update({
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
    const last = await this.prisma.bestPracticeRecord.findFirst({
      where:   { docType },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    return this.prisma.bestPracticeRecord.create({
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

// --- typed error ---------------------------------------------------------

export type BestPracticeErrorCode =
  | 'not_found'
  | 'not_a_draft'
  | 'already_retired'

export class BestPracticeServiceError extends Error {
  constructor(public readonly code: BestPracticeErrorCode, message: string) {
    super(message)
    this.name = 'BestPracticeServiceError'
  }
}
