// MedContentTypePolicy service — thin pointer per medical content
// docType carrying template + checklist + reviewTierFormula +
// complianceTrack pins + legacy SME-prompt / digest fallback columns.
// Mirror of PublicationTypePolicyService.

import type { PrismaClient, Prisma } from '@prisma/client'
import type { PolicyRequirements } from '../../platform/policy-requirements.js'
import { DEFAULT_POLICY_REQUIREMENTS } from '../../platform/policy-requirements.js'

export interface MedContentTypePolicyEditableFields {
  smePrompt?:           string
  bestPracticeDigest?:  unknown
  sectionRules?:        unknown
  templateId?:          string | null
  checklistTemplateId?: string | null
  complianceTrack?:     string | null
  reviewTierFormula?:   string | null
  requirements?:        PolicyRequirements
}

export interface MedContentTypePolicyCreateBody extends MedContentTypePolicyEditableFields {
  docType:    string
  smePrompt:  string          // required on create
}

export class MedContentTypePolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  async listAll() {
    return this.prisma.medContentTypePolicy.findMany({
      where:   { isCurrent: true, retiredAt: null },
      orderBy: { docType: 'asc' },
    })
  }

  async getCurrent(docType: string) {
    return this.prisma.medContentTypePolicy.findFirst({
      where: { docType, isCurrent: true, retiredAt: null },
    })
  }

  async getById(id: string) {
    return this.prisma.medContentTypePolicy.findUnique({ where: { id } })
  }

  async create(input: MedContentTypePolicyCreateBody, actorId: string) {
    const docType = input.docType.replace(/-/g, '_')
    const existing = await this.getCurrent(docType)
    if (existing) {
      throw new MedContentTypePolicyServiceError(
        'duplicate',
        `A current policy already exists for '${docType}' (version ${existing.version}). Bump a new version instead.`,
      )
    }
    return this.prisma.medContentTypePolicy.create({
      data: {
        docType,
        version:            1,
        isCurrent:          true,
        smePrompt:          input.smePrompt,
        bestPracticeDigest: (input.bestPracticeDigest ?? { principles: [] }) as unknown as Prisma.InputJsonValue,
        sectionRules:       (input.sectionRules       ?? {})                  as unknown as Prisma.InputJsonValue,
        templateId:          input.templateId          ?? null,
        checklistTemplateId: input.checklistTemplateId ?? null,
        complianceTrack:     input.complianceTrack     ?? null,
        reviewTierFormula:   input.reviewTierFormula   ?? null,
        requirements:        (input.requirements ?? DEFAULT_POLICY_REQUIREMENTS) as unknown as Prisma.InputJsonValue,
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  }

  async update(docType: string, input: MedContentTypePolicyEditableFields, actorId: string) {
    const normalised = docType.replace(/-/g, '_')
    const current = await this.getCurrent(normalised)
    if (!current) throw new MedContentTypePolicyServiceError('not_found', `No current policy for '${normalised}'.`)
    return this.prisma.medContentTypePolicy.update({
      where: { id: current.id },
      data: {
        ...(input.smePrompt           !== undefined && { smePrompt:           input.smePrompt }),
        ...(input.bestPracticeDigest  !== undefined && { bestPracticeDigest:  input.bestPracticeDigest  as unknown as Prisma.InputJsonValue }),
        ...(input.sectionRules        !== undefined && { sectionRules:        input.sectionRules        as unknown as Prisma.InputJsonValue }),
        ...(input.templateId          !== undefined && { templateId:          input.templateId }),
        ...(input.checklistTemplateId !== undefined && { checklistTemplateId: input.checklistTemplateId }),
        ...(input.complianceTrack     !== undefined && { complianceTrack:     input.complianceTrack }),
        ...(input.reviewTierFormula   !== undefined && { reviewTierFormula:   input.reviewTierFormula }),
        ...(input.requirements        !== undefined && { requirements:        input.requirements as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  async retire(docType: string, reason: string, actorId: string) {
    const normalised = docType.replace(/-/g, '_')
    const current = await this.getCurrent(normalised)
    if (!current) throw new MedContentTypePolicyServiceError('not_found', `No current policy for '${normalised}'.`)
    return this.prisma.medContentTypePolicy.update({
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

export type MedContentTypePolicyErrorCode =
  | 'not_found'
  | 'duplicate'

export class MedContentTypePolicyServiceError extends Error {
  constructor(public readonly code: MedContentTypePolicyErrorCode, message: string) {
    super(message)
    this.name = 'MedContentTypePolicyServiceError'
  }
}
