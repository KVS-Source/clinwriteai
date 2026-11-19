// AiPromptRecord service — all invariants for the draft → approved → retired
// workflow live here so routes stay thin.
//
// Rules:
//   - Exactly one `status='approved'` row per (docType) at any time. On
//     approve of a new row, the currently-approved row flips to
//     'retired' + supersededBy = new row id (atomic in a transaction).
//   - 'draft' rows can be edited in place (smePrompt + sectionRules).
//     'approved' and 'retired' rows are immutable (the approve flow
//     effectively snapshots them).
//   - version is per-docType, auto-incremented on create.
//   - A new draft can be started at any time for a docType; it won't
//     affect the approved row until it is itself approved.

import type { PrismaClient, Prisma } from '@prisma/client'

export type AiPromptStatus = 'draft' | 'approved' | 'retired'

export type SectionRulesMap = Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>

export interface CreateInput {
  docType:      string
  smePrompt:    string
  sectionRules?: SectionRulesMap
}

export interface UpdateDraftInput {
  smePrompt?:    string
  sectionRules?: SectionRulesMap
}

export class AiPromptService {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------------------------------------------------------------- reads

  /** Latest approved row for a docType, or null when none exists. The AI
   *  assembly uses this when no explicit pin is set on the Document. */
  async getApproved(docType: string) {
    return this.prisma.aiPromptRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
    })
  }

  /** Every row for a docType, newest first — admin history view. */
  async listVersions(docType: string) {
    return this.prisma.aiPromptRecord.findMany({
      where:   { docType },
      orderBy: { version: 'desc' },
    })
  }

  /** Latest-approved row for every docType (list screen). */
  async listAllApproved() {
    return this.prisma.aiPromptRecord.findMany({
      where:   { status: 'approved' },
      orderBy: { docType: 'asc' },
    })
  }

  /** Visible rows for the admin list: the most meaningful row per
   *  docType. Preference order:
   *    1. approved (if the docType has one)
   *    2. draft    (if no approved — makes brand-new drafts show up
   *                 instead of "disappearing" between create + approve)
   *  Retired rows are always hidden (they're audit snapshots, not
   *  navigation). Returns one row per docType; UI shows the status
   *  chip so admins can tell draft from approved at a glance. */
  async listVisible() {
    const rows = await this.prisma.aiPromptRecord.findMany({
      where:   { status: { in: ['approved', 'draft'] } },
      orderBy: [{ docType: 'asc' }, { version: 'desc' }],
    })
    const scoreOf = (s: string) => (s === 'approved' ? 2 : 1)
    const byDocType = new Map<string, typeof rows[number]>()
    for (const row of rows) {
      const existing = byDocType.get(row.docType)
      if (!existing || scoreOf(row.status) > scoreOf(existing.status)) {
        byDocType.set(row.docType, row)
      }
    }
    // Deterministic order: docType asc, same as listAllApproved so the
    // UI doesn't jump around when a draft lands.
    return Array.from(byDocType.values()).sort((a, b) => a.docType.localeCompare(b.docType))
  }

  async findById(id: string) {
    return this.prisma.aiPromptRecord.findUnique({ where: { id } })
  }

  // --------------------------------------------------------------- writes

  /** Create a new draft row for `docType`. If a draft already exists for
   *  the same docType, 409 — admin should edit that draft instead. */
  async createDraft(input: CreateInput, actorId: string) {
    const docType = input.docType.replace(/-/g, '_')
    const existingDraft = await this.prisma.aiPromptRecord.findFirst({
      where: { docType, status: 'draft' },
    })
    if (existingDraft) {
      throw new AiPromptServiceError(
        'draft_exists',
        `A draft prompt already exists for '${docType}' (version ${existingDraft.version}). Edit or approve it instead.`,
      )
    }
    // Next version = (max existing version for this docType) + 1.
    const last = await this.prisma.aiPromptRecord.findFirst({
      where:   { docType },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    return this.prisma.aiPromptRecord.create({
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

  /** Edit a draft in place. 409 for non-draft rows (approved + retired
   *  are immutable snapshots). */
  async updateDraft(id: string, input: UpdateDraftInput, actorId: string) {
    const row = await this.prisma.aiPromptRecord.findUnique({ where: { id } })
    if (!row) throw new AiPromptServiceError('not_found', `AiPromptRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new AiPromptServiceError(
        'not_a_draft',
        `Row is '${row.status}' and immutable. Start a new draft to change the prompt — approved/retired rows are audit snapshots.`,
      )
    }
    return this.prisma.aiPromptRecord.update({
      where: { id },
      data:  {
        ...(input.smePrompt    !== undefined && { smePrompt:    input.smePrompt }),
        ...(input.sectionRules !== undefined && { sectionRules: input.sectionRules as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  /** Promote a draft to approved. Flips the currently-approved row of
   *  the same docType to retired + supersededBy = this row id. Atomic. */
  async approve(id: string, actorId: string) {
    const row = await this.prisma.aiPromptRecord.findUnique({ where: { id } })
    if (!row) throw new AiPromptServiceError('not_found', `AiPromptRecord ${id} not found.`)
    if (row.status !== 'draft') {
      throw new AiPromptServiceError('not_a_draft', `Only drafts can be approved (this row is '${row.status}').`)
    }
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const previous = await tx.aiPromptRecord.findFirst({
        where: { docType: row.docType, status: 'approved' },
      })
      if (previous) {
        await tx.aiPromptRecord.update({
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
      return tx.aiPromptRecord.update({
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

  /** Retire a draft or an approved row. Approved rows should normally be
   *  retired implicitly via `approve` of a replacement — this path is
   *  for operator cleanup (e.g. retiring the only approved row because
   *  the doc type is being pulled from production). */
  async retire(id: string, reason: string, actorId: string) {
    const row = await this.prisma.aiPromptRecord.findUnique({ where: { id } })
    if (!row) throw new AiPromptServiceError('not_found', `AiPromptRecord ${id} not found.`)
    if (row.status === 'retired') {
      throw new AiPromptServiceError('already_retired', 'Row is already retired.')
    }
    return this.prisma.aiPromptRecord.update({
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

// --- typed error ---------------------------------------------------------

export type AiPromptErrorCode =
  | 'not_found'
  | 'draft_exists'
  | 'not_a_draft'
  | 'already_retired'

export class AiPromptServiceError extends Error {
  constructor(public readonly code: AiPromptErrorCode, message: string) {
    super(message)
    this.name = 'AiPromptServiceError'
  }
}
