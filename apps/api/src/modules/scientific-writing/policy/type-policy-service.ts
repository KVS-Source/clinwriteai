// PublicationTypePolicy service — thin pointer per manuscript docType
// carrying template / checklist / guideline pins + legacy SME-prompt /
// digest fallback columns. Mirror of Module A's DocumentTypePolicyService.
//
// After Phase M-B.4 the resolver prefers PublicationAiPromptRecord +
// PublicationBestPracticeRecord for SME prompt / digest; this row's
// columns stay as a legacy fallback until Phase 3 of the pointer refactor
// (same migration path Module A is on).

import type { PrismaClient, Prisma } from '@prisma/client'
import type { PolicyRequirements } from '../../platform/policy-requirements.js'
import { DEFAULT_POLICY_REQUIREMENTS } from '../../platform/policy-requirements.js'

export interface PublicationTypePolicyEditableFields {
  smePrompt?:           string
  bestPracticeDigest?:  unknown
  sectionRules?:        unknown
  templateId?:          string | null
  checklistTemplateId?: string | null
  guidelineKey?:        string | null
  requirements?:        PolicyRequirements
}

export interface PublicationTypePolicyCreateBody extends PublicationTypePolicyEditableFields {
  docType:    string
  smePrompt:  string          // required on create
}

export class PublicationTypePolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  async listAll() {
    return this.prisma.publicationTypePolicy.findMany({
      where:   { isCurrent: true, retiredAt: null },
      orderBy: { docType: 'asc' },
    })
  }

  async getCurrent(docType: string) {
    return this.prisma.publicationTypePolicy.findFirst({
      where: { docType, isCurrent: true, retiredAt: null },
    })
  }

  async getById(id: string) {
    return this.prisma.publicationTypePolicy.findUnique({ where: { id } })
  }

  async create(input: PublicationTypePolicyCreateBody, actorId: string) {
    const docType = input.docType.replace(/-/g, '_')
    const existing = await this.getCurrent(docType)
    if (existing) {
      throw new PublicationTypePolicyServiceError(
        'duplicate',
        `A current policy already exists for '${docType}' (version ${existing.version}). Bump a new version instead.`,
      )
    }
    return this.prisma.publicationTypePolicy.create({
      data: {
        docType,
        version:            1,
        isCurrent:          true,
        smePrompt:          input.smePrompt,
        bestPracticeDigest: (input.bestPracticeDigest ?? { principles: [] }) as unknown as Prisma.InputJsonValue,
        sectionRules:       (input.sectionRules       ?? {})                  as unknown as Prisma.InputJsonValue,
        templateId:          input.templateId          ?? null,
        checklistTemplateId: input.checklistTemplateId ?? null,
        guidelineKey:        input.guidelineKey        ?? null,
        requirements:        (input.requirements ?? DEFAULT_POLICY_REQUIREMENTS) as unknown as Prisma.InputJsonValue,
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  }

  async update(docType: string, input: PublicationTypePolicyEditableFields, actorId: string) {
    const normalised = docType.replace(/-/g, '_')
    const current = await this.getCurrent(normalised)
    if (!current) throw new PublicationTypePolicyServiceError('not_found', `No current policy for '${normalised}'.`)
    return this.prisma.publicationTypePolicy.update({
      where: { id: current.id },
      data: {
        ...(input.smePrompt           !== undefined && { smePrompt:           input.smePrompt }),
        ...(input.bestPracticeDigest  !== undefined && { bestPracticeDigest:  input.bestPracticeDigest  as unknown as Prisma.InputJsonValue }),
        ...(input.sectionRules        !== undefined && { sectionRules:        input.sectionRules        as unknown as Prisma.InputJsonValue }),
        ...(input.templateId          !== undefined && { templateId:          input.templateId }),
        ...(input.checklistTemplateId !== undefined && { checklistTemplateId: input.checklistTemplateId }),
        ...(input.guidelineKey        !== undefined && { guidelineKey:        input.guidelineKey }),
        ...(input.requirements        !== undefined && { requirements:        input.requirements as unknown as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    })
  }

  async retire(docType: string, reason: string, actorId: string) {
    const normalised = docType.replace(/-/g, '_')
    const current = await this.getCurrent(normalised)
    if (!current) throw new PublicationTypePolicyServiceError('not_found', `No current policy for '${normalised}'.`)
    return this.prisma.publicationTypePolicy.update({
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

export type PublicationTypePolicyErrorCode =
  | 'not_found'
  | 'duplicate'

export class PublicationTypePolicyServiceError extends Error {
  constructor(public readonly code: PublicationTypePolicyErrorCode, message: string) {
    super(message)
    this.name = 'PublicationTypePolicyServiceError'
  }
}
