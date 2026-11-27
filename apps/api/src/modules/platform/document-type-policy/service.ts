// DocumentTypePolicy service — all the row-shape invariants live here
// so the routes stay thin.
//
// Invariants:
//   - Exactly one `isCurrent = true` row per docType at any time. A
//     new version flips the old row's `isCurrent = false` + `supersededBy`
//     to the new row id, atomically.
//   - Editing a policy IN PLACE (updatePolicy) is only legal if no
//     Document has pinned `policyVersionAtCreate` to this version yet.
//     Once a document has been authored under a policy version, that
//     version becomes immutable — later edits must bump a new version.
//   - Retiring a policy sets retiredAt + retiredBy + retireReason and
//     flips isCurrent=false. A subsequent create() for the same docType
//     starts fresh at version 1 (semantic: the doc type was pulled
//     from production and reintroduced).

import type { PrismaClient } from '@prisma/client'
import { defaultPlaceholderSmePrompt, DEFAULT_POLICY_REQUIREMENTS } from './schema.js'
import type {
  BestPracticeDigest, CreatePolicyInput, SectionRules, UpdatePolicyInput, BumpVersionInput,
} from './schema.js'

export class DocumentTypePolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------------------------------------------------------------- reads

  /** Current policy for a doc type, or null if none has been authored. */
  async getCurrent(docType: string) {
    return this.prisma.documentTypePolicy.findFirst({
      where: { docType, isCurrent: true, retiredAt: null },
    })
  }

  /** Full version history for a doc type, newest first. */
  async listVersions(docType: string) {
    return this.prisma.documentTypePolicy.findMany({
      where:   { docType },
      orderBy: { version: 'desc' },
    })
  }

  /** Every current, non-retired policy across all doc types — powers
   *  the admin "which doc types have policies" overview. */
  async listAllCurrent() {
    return this.prisma.documentTypePolicy.findMany({
      where:   { isCurrent: true, retiredAt: null },
      orderBy: { docType: 'asc' },
    })
  }

  /** Load a specific (docType, version) pair. Used by the audit-replay
   *  path when reconstructing what rules applied to a signed document. */
  async getByVersion(docType: string, version: number) {
    return this.prisma.documentTypePolicy.findUnique({
      where: { docType_version: { docType, version } },
    })
  }

  // --------------------------------------------------------------- writes

  /** First-version create. Fails 409 if a current policy already exists
   *  for this docType (caller should use bumpVersion instead).
   *
   *  `smePrompt` defaults to the "configure in AI Prompts" placeholder
   *  when the admin didn't supply one — the real SME text lives on an
   *  AiPromptRecord that the policy auto-resolves per docType. */
  async create(input: CreatePolicyInput, actorId: string) {
    const existing = await this.getCurrent(input.docType)
    if (existing) {
      throw new PolicyServiceError('already_exists', `A current policy already exists for docType '${input.docType}' (version ${existing.version}). Use bumpVersion.`)
    }
    const smePrompt = input.smePrompt?.trim() || defaultPlaceholderSmePrompt(input.docType)
    return this.prisma.documentTypePolicy.create({
      data: {
        docType:             input.docType,
        version:             1,
        isCurrent:           true,
        smePrompt,
        bestPracticeDigest:  (input.bestPracticeDigest ?? { principles: [] }) as unknown as object,
        sectionRules:        (input.sectionRules ?? {})                        as unknown as object,
        templateId:          input.templateId          ?? null,
        checklistTemplateId: input.checklistTemplateId ?? null,
        ichFramework:        input.ichFramework        ?? null,
        ichFrameworkNames:   input.ichFrameworkNames   ?? [],
        requirements:        (input.requirements ?? DEFAULT_POLICY_REQUIREMENTS) as unknown as object,
        ...(input.referenceStyle ? { referenceStyle: input.referenceStyle } : {}),
        ...(input.costEstimateEnabled !== undefined ? { costEstimateEnabled: input.costEstimateEnabled } : {}),
        ...(input.costLimitEnabled !== undefined ? { costLimitEnabled: input.costLimitEnabled } : {}),
        createdBy:           actorId,
        updatedBy:           actorId,
      },
    })
  }

  /** Bump a new version. Atomically flips the old row to isCurrent=false +
   *  supersededBy = new.id, inserts the new row as isCurrent=true. */
  async bumpVersion(docType: string, input: BumpVersionInput, actorId: string) {
    const current = await this.getCurrent(docType)
    if (!current) {
      throw new PolicyServiceError('no_current_policy', `No current policy for docType '${docType}'. Use create() first.`)
    }
    return this.prisma.$transaction(async (tx) => {
      const next = await tx.documentTypePolicy.create({
        data: {
          docType,
          version:             current.version + 1,
          isCurrent:           true,
          smePrompt:           input.smePrompt,
          bestPracticeDigest:  (input.bestPracticeDigest ?? { principles: [] }) as unknown as object,
          sectionRules:        (input.sectionRules ?? {})                        as unknown as object,
          templateId:          input.templateId          ?? null,
          checklistTemplateId: input.checklistTemplateId ?? null,
          ichFramework:        input.ichFramework        ?? null,
          ichFrameworkNames:   input.ichFrameworkNames   ?? current.ichFrameworkNames ?? [],
          requirements:        (input.requirements ?? (current.requirements ?? DEFAULT_POLICY_REQUIREMENTS)) as unknown as object,
          // The build plan comes only from a policy package; a new version keeps it.
          ...carriedBuildPlan(current),
          referenceStyle:      input.referenceStyle ?? current.referenceStyle,
          costEstimateEnabled: input.costEstimateEnabled ?? current.costEstimateEnabled,
          costLimitEnabled:    input.costLimitEnabled ?? current.costLimitEnabled,
          createdBy:           actorId,
          updatedBy:           actorId,
        },
      })
      await tx.documentTypePolicy.update({
        where: { id: current.id },
        data:  { isCurrent: false, supersededBy: next.id },
      })
      return next
    })
  }

  /**
   * A new version that is the current one with this build plan (policy-package import). With no policy yet for the
   * doc type, the first version is created with the defaults, so a plan can arrive before anyone writes a policy.
   */
  async newVersionWithPlan(docType: string, buildPlan: object, buildPlanSource: object, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.documentTypePolicy.findFirst({ where: { docType, isCurrent: true, retiredAt: null } })
      if (!current) {
        const last = await tx.documentTypePolicy.findFirst({ where: { docType }, orderBy: { version: 'desc' }, select: { version: true } })
        return tx.documentTypePolicy.create({
          data: {
            docType,
            version:      (last?.version ?? 0) + 1,
            isCurrent:    true,
            smePrompt:    defaultPlaceholderSmePrompt(docType),
            requirements: DEFAULT_POLICY_REQUIREMENTS as unknown as object,
            buildPlan,
            buildPlanSource,
            createdBy:    actorId,
            updatedBy:    actorId,
          },
        })
      }
      const next = await tx.documentTypePolicy.create({
        data: {
          docType,
          version:             current.version + 1,
          isCurrent:           true,
          smePrompt:           current.smePrompt,
          bestPracticeDigest:  current.bestPracticeDigest as object,
          sectionRules:        current.sectionRules as object,
          templateId:          current.templateId,
          checklistTemplateId: current.checklistTemplateId,
          ichFramework:        current.ichFramework,
          ichFrameworkNames:   current.ichFrameworkNames,
          requirements:        current.requirements as object,
          referenceStyle:      current.referenceStyle,
          costEstimateEnabled: current.costEstimateEnabled,
          costLimitEnabled:    current.costLimitEnabled,
          buildPlan,
          buildPlanSource,
          createdBy:           actorId,
          updatedBy:           actorId,
        },
      })
      await tx.documentTypePolicy.update({ where: { id: current.id }, data: { isCurrent: false, supersededBy: next.id } })
      return next
    })
  }

  /** In-place edit of the current version. Fails 409 if any Document
   *  has pinned policyVersionAtCreate to this version — once used, it's
   *  immutable; call bumpVersion for further changes. */
  async updateCurrent(docType: string, input: UpdatePolicyInput, actorId: string) {
    const current = await this.getCurrent(docType)
    if (!current) {
      throw new PolicyServiceError('no_current_policy', `No current policy for docType '${docType}'.`)
    }
    const usedCount = await this.prisma.document.count({
      where: { type: docType.replace(/-/g, '_'), policyVersionAtCreate: current.version },
    })
    if (usedCount > 0) {
      throw new PolicyServiceError('version_in_use', `Policy version ${current.version} has been pinned by ${usedCount} document(s). Use bumpVersion to create a new editable version.`)
    }
    return this.prisma.documentTypePolicy.update({
      where: { id: current.id },
      data: {
        ...(input.smePrompt           !== undefined && { smePrompt: input.smePrompt }),
        ...(input.bestPracticeDigest  !== undefined && { bestPracticeDigest:  input.bestPracticeDigest  as unknown as object }),
        ...(input.sectionRules        !== undefined && { sectionRules:        input.sectionRules        as unknown as object }),
        ...(input.templateId          !== undefined && { templateId:          input.templateId }),
        ...(input.checklistTemplateId !== undefined && { checklistTemplateId: input.checklistTemplateId }),
        ...(input.ichFramework        !== undefined && { ichFramework:        input.ichFramework }),
        ...(input.ichFrameworkNames   !== undefined && { ichFrameworkNames:   input.ichFrameworkNames }),
        ...(input.requirements        !== undefined && { requirements:        input.requirements        as unknown as object }),
        ...(input.referenceStyle      !== undefined && { referenceStyle:      input.referenceStyle }),
        ...(input.costEstimateEnabled !== undefined && { costEstimateEnabled: input.costEstimateEnabled }),
        ...(input.costLimitEnabled    !== undefined && { costLimitEnabled:    input.costLimitEnabled }),
        updatedBy: actorId,
      },
    })
  }

  /** Retire the current policy. isCurrent flips to false; retiredAt +
   *  retiredBy + retireReason set. A later create() for the same docType
   *  is treated as a fresh re-introduction (starts at version 1). */
  async retire(docType: string, reason: string, actorId: string) {
    const current = await this.getCurrent(docType)
    if (!current) {
      throw new PolicyServiceError('no_current_policy', `No current policy for docType '${docType}'.`)
    }
    return this.prisma.documentTypePolicy.update({
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

// --- typed error ---------------------------------------------------------

export type PolicyServiceErrorCode =
  | 'already_exists'
  | 'no_current_policy'
  | 'version_in_use'

/** Thrown by the service for 409 / 422 conditions. Routes map
 *  `code` onto the response; message goes into details. */
export class PolicyServiceError extends Error {
  constructor(public readonly code: PolicyServiceErrorCode, message: string) {
    super(message)
    this.name = 'PolicyServiceError'
  }
}

// Shape helper for bestPracticeDigest reads. Prisma returns Json as
// Prisma's JsonValue; routes + consumers want the structured type.
export function digestOf(row: { bestPracticeDigest: unknown }): BestPracticeDigest {
  return row.bestPracticeDigest as BestPracticeDigest
}

export function sectionRulesOf(row: { sectionRules: unknown }): SectionRules {
  return row.sectionRules as SectionRules
}

/** The build plan fields of a policy row, to copy onto its next version (nothing when it has none). */
function carriedBuildPlan(row: { buildPlan?: unknown; buildPlanSource?: unknown }): { buildPlan?: object; buildPlanSource?: object } {
  if (row.buildPlan == null) return {}
  return { buildPlan: row.buildPlan as object, ...(row.buildPlanSource != null ? { buildPlanSource: row.buildPlanSource as object } : {}) }
}
