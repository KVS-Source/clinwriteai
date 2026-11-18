// SectionTemplate service — draft → approved → retired lifecycle mirrors
// AiPromptService (apps/api/src/modules/platform/ai-prompt/service.ts).
// Rules:
//   - Exactly one `status='approved'` row per (docType, sectionKey) at any
//     time. Approving flips the previous approved row to 'retired' +
//     supersededBy = new row id (atomic in a transaction).
//   - 'draft' rows are mutable (formatJson). 'approved' + 'retired' are
//     immutable snapshots — admins start a new draft to change them.
//   - version is per (docType, sectionKey), auto-incremented on create.
//   - Only one 'draft' row per (docType, sectionKey) at a time — admin
//     edits the draft in place rather than piling up untouched drafts.

import type { PrismaClient } from '@prisma/client'

export type SectionTemplateStatus = 'draft' | 'approved' | 'retired'

export interface CreateInput {
  docType:     string
  sectionKey:  string
  formatRules: string
}

export interface UpdateDraftInput {
  formatRules: string
}

export class SectionTemplateService {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------------------------------------------------------------- reads

  /** Latest approved row for one (docType, sectionKey) — the resolver
   *  uses this when the document hasn't pinned a specific version. */
  async getApproved(docType: string, sectionKey: string) {
    return this.prisma.sectionTemplate.findFirst({
      where:   { docType, sectionKey, status: 'approved' },
      orderBy: { version: 'desc' },
    })
  }

  /** Every approved row for a docType — used at document creation to
   *  build the (sectionKey → template) map for snapshotting. */
  async listApprovedForDocType(docType: string) {
    return this.prisma.sectionTemplate.findMany({
      where:   { docType, status: 'approved' },
      orderBy: [{ sectionKey: 'asc' }, { version: 'desc' }],
    })
  }

  /** All versions (draft + approved + retired) for a (docType, sectionKey)
   *  — admin history view. */
  async listVersions(docType: string, sectionKey: string) {
    return this.prisma.sectionTemplate.findMany({
      where:   { docType, sectionKey },
      orderBy: { version: 'desc' },
    })
  }

  /** Latest approved per (docType, sectionKey) across the whole catalogue
   *  — admin list screen. */
  async listAllApproved() {
    return this.prisma.sectionTemplate.findMany({
      where:   { status: 'approved' },
      orderBy: [{ docType: 'asc' }, { sectionKey: 'asc' }],
    })
  }

  async findById(id: string) {
    return this.prisma.sectionTemplate.findUnique({ where: { id } })
  }

  // --------------------------------------------------------------- writes

  /** Create a new draft for (docType, sectionKey). 409 if a draft already
   *  exists — admin should edit that instead. */
  async createDraft(input: CreateInput, actorId: string) {
    const docType    = input.docType.replace(/-/g, '_')
    const sectionKey = input.sectionKey
    const existingDraft = await this.prisma.sectionTemplate.findFirst({
      where: { docType, sectionKey, status: 'draft' },
    })
    if (existingDraft) {
      throw new SectionTemplateServiceError(
        'draft_exists',
        `A draft section template already exists for '${docType}/${sectionKey}' (version ${existingDraft.version}). Edit or approve it instead.`,
      )
    }
    const last = await this.prisma.sectionTemplate.findFirst({
      where:   { docType, sectionKey },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    return this.prisma.sectionTemplate.create({
      data: {
        docType,
        sectionKey,
        version:     nextVersion,
        status:      'draft',
        formatRules: input.formatRules,
        createdBy:   actorId,
        updatedBy:   actorId,
      },
    })
  }

  async updateDraft(id: string, input: UpdateDraftInput, actorId: string) {
    const row = await this.prisma.sectionTemplate.findUnique({ where: { id } })
    if (!row) throw new SectionTemplateServiceError('not_found', `SectionTemplate ${id} not found.`)
    if (row.status !== 'draft') {
      throw new SectionTemplateServiceError(
        'not_a_draft',
        `Row is '${row.status}' and immutable. Start a new draft to change the template — approved/retired rows are audit snapshots.`,
      )
    }
    return this.prisma.sectionTemplate.update({
      where: { id },
      data:  {
        formatRules: input.formatRules,
        updatedBy:   actorId,
      },
    })
  }

  /** Promote a draft to approved. Flips the currently-approved row for
   *  the same (docType, sectionKey) to retired + supersededBy. Atomic. */
  async approve(id: string, actorId: string) {
    const row = await this.prisma.sectionTemplate.findUnique({ where: { id } })
    if (!row) throw new SectionTemplateServiceError('not_found', `SectionTemplate ${id} not found.`)
    if (row.status !== 'draft') {
      throw new SectionTemplateServiceError('not_a_draft', `Only drafts can be approved (this row is '${row.status}').`)
    }
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const previous = await tx.sectionTemplate.findFirst({
        where: { docType: row.docType, sectionKey: row.sectionKey, status: 'approved' },
      })
      if (previous) {
        await tx.sectionTemplate.update({
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
      return tx.sectionTemplate.update({
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
    const row = await this.prisma.sectionTemplate.findUnique({ where: { id } })
    if (!row) throw new SectionTemplateServiceError('not_found', `SectionTemplate ${id} not found.`)
    if (row.status === 'retired') {
      throw new SectionTemplateServiceError('already_retired', 'Row is already retired.')
    }
    return this.prisma.sectionTemplate.update({
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

export type SectionTemplateErrorCode =
  | 'not_found'
  | 'draft_exists'
  | 'not_a_draft'
  | 'already_retired'

export class SectionTemplateServiceError extends Error {
  constructor(public readonly code: SectionTemplateErrorCode, message: string) {
    super(message)
    this.name = 'SectionTemplateServiceError'
  }
}
