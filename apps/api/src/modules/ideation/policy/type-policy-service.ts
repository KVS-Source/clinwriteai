// IdeationTypePolicy service — thin pointer per ideation docType
// carrying template + checklist + reviewTierFormula + channelHint
// pins + legacy SME-prompt / digest fallback columns.
// Mirror of MedContentTypePolicyService.

import type { PrismaClient, Prisma } from '@prisma/client'

export interface IdeationTypePolicyEditableFields {
  smePrompt?:           string
  bestPracticeDigest?:  unknown
  sectionRules?:        unknown
  templateId?:          string | null
  checklistTemplateId?: string | null
  channelHint?:     string | null
  reviewTierFormula?:   string | null
}

export interface IdeationTypePolicyCreateBody extends IdeationTypePolicyEditableFields {
  docType:   string
  smePrompt: string
}

export class IdeationTypePolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  async listAll() {
    return this.prisma.ideationTypePolicy.findMany({
      where:   { isCurrent: true, retiredAt: null },
      orderBy: { docType: 'asc' },
    })
  }

  async getCurrent(docType: string) {
    return this.prisma.ideationTypePolicy.findFirst({
      where: { docType, isCurrent: true, retiredAt: null },
    })
  }

  async getById(id: string) {
    return this.prisma.ideationTypePolicy.findUnique({ where: { id } })
  }

  async create(input: IdeationTypePolicyCreateBody, actorId: string) {
    const docType = input.docType.replace(/-/g, '_')
    const existing = await this.getCurrent(docType)
    if (existing) {
      throw new IdeationTypePolicyServiceError(
        'duplicate',
        `A current policy already exists for '${docType}' (version ${existing.version}). Bump a new version instead.`,
      )
    }
    return this.prisma.ideationTypePolicy.create({
      data: {
        docType,
        version:             1,
        isCurrent:           true,
        smePrompt:           input.smePrompt,
        bestPracticeDigest:  (input.bestPracticeDigest ?? { principles: [] }) as unknown as Prisma.InputJsonValue,
        sectionRules:        (input.sectionRules       ?? {})                 as unknown as Prisma.InputJsonValue,
        templateId:          input.templateId          ?? null,
        checklistTemplateId: input.checklistTemplateId ?? null,
        channelHint:     input.channelHint     ?? null,
        reviewTierFormula:   input.reviewTierFormula   ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  }

  async update(docType: string, input: IdeationTypePolicyEditableFields, actorId: string) {
    const normalised = docType.replace(/-/g, '_')
    const current = await this.getCurrent(normalised)
    if (!current) throw new IdeationTypePolicyServiceError('not_found', `No current policy for '${normalised}'.`)
    return this.prisma.ideationTypePolicy.update({
      where: { id: current.id },
      data: {
        ...(input.smePrompt           !== undefined && { smePrompt:           input.smePrompt }),
        ...(input.bestPracticeDigest  !== undefined && { bestPracticeDigest:  input.bestPracticeDigest  as unknown as Prisma.InputJsonValue }),
        ...(input.sectionRules        !== undefined && { sectionRules:        input.sectionRules        as unknown as Prisma.InputJsonValue }),
        ...(input.templateId          !== undefined && { templateId:          input.templateId }),
        ...(input.checklistTemplateId !== undefined && { checklistTemplateId: input.checklistTemplateId }),
        ...(input.channelHint     !== undefined && { channelHint:     input.channelHint }),
        ...(input.reviewTierFormula   !== undefined && { reviewTierFormula:   input.reviewTierFormula }),
        updatedBy: actorId,
      },
    })
  }

  async retire(docType: string, reason: string, actorId: string) {
    const normalised = docType.replace(/-/g, '_')
    const current = await this.getCurrent(normalised)
    if (!current) throw new IdeationTypePolicyServiceError('not_found', `No current policy for '${normalised}'.`)
    return this.prisma.ideationTypePolicy.update({
      where: { id: current.id },
      data: {
        isCurrent:    false,
        retiredAt:    new Date(),
        retiredBy:    actorId,
        retireReason: reason,
        updatedBy:    actorId,
      },
    })
  }
}

export type IdeationTypePolicyErrorCode = 'not_found' | 'duplicate'

export class IdeationTypePolicyServiceError extends Error {
  constructor(public readonly code: IdeationTypePolicyErrorCode, message: string) {
    super(message)
    this.name = 'IdeationTypePolicyServiceError'
  }
}
