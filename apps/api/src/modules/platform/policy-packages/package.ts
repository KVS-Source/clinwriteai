// Signed policy packages from GenBioCa (docs/policy-packages.md).
//
// A package is one file: an RS256-signed JWT whose payload carries the contents for one or more document types
// (today: their AI build plans). It is signed with the same GenBioCa key as the install's license, so it is checked
// with LICENSE_PUBLIC_KEY. The tenant admin previews it (what changes, what doesn't fit the templates) and imports it;
// each document type it covers gets a new policy version, and documents already created keep the version they had.
//
// Signed, not encrypted: the contents are not secret, the signature proves they came from GenBioCa unchanged.

import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { verifyJwtRS256 } from '../licensing/jwt-verify.js'
import { EXPECTED_ISSUER } from '../licensing/keys.js'
import { DocumentTypePolicyService } from '../document-type-policy/service.js'
import { checkPlanAgainstTemplate, parseBuildPlan, type BuildPlan, type TemplateSection } from './build-plan.js'

export const PACKAGE_TYPE = 'clinwrite.policy-package'
export const PACKAGE_FORMAT_VERSION = 1

/** What a package can carry for a document type. Only build plans can be applied by this version of the app. */
const contentSchema = z.object({
  docType:      z.string().trim().min(1).max(60),
  buildPlan:    z.unknown().optional(),
  aiPrompt:     z.unknown().optional(),
  bestPractice: z.unknown().optional(),
  checklist:    z.unknown().optional(),
}).strict()

const packageSchema = z.object({
  iss:            z.literal(EXPECTED_ISSUER),
  typ:            z.literal(PACKAGE_TYPE),
  formatVersion:  z.number().int().min(1),
  packageId:      z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/).max(80),
  packageVersion: z.number().int().min(1),
  description:    z.string().max(500).optional(),
  iat:            z.number().optional(),
  /** Which installs may import it: ['*'] for every customer, or install ids. */
  audience:       z.object({ installIds: z.array(z.string().min(1).max(120)).min(1).max(500) }).strict(),
  contents:       z.array(contentSchema).min(1).max(30),
}).passthrough()

export type PolicyPackage = z.infer<typeof packageSchema>

/** Where a policy's build plan came from (document_type_policies.buildPlanSource). */
export interface BuildPlanSource {
  packageId:      string
  packageVersion: number
  sha256:         string
  importedAt:     string
  importedBy:     string
}

export type PackageFailure =
  | 'malformed' | 'unsupported_algorithm' | 'invalid_signature' | 'expired' | 'not_yet_valid' | 'issuer_mismatch'
  | 'not_a_policy_package' | 'format_too_new' | 'not_for_this_install'

export interface PreviewItem {
  docType: string
  /** The policy now, and the version the import creates. */
  currentVersion: number | null
  newVersion:     number
  /** The template the plan was checked against, or null when the doc type has none. */
  template:       { id: string; label: string; version: number } | null
  stages:         Array<{ label: string; sections: number }>
  /** Make this document type's contents impossible to import. */
  errors:   string[]
  warnings: string[]
}

export interface PackagePreview {
  ok:             boolean
  packageId:      string
  packageVersion: number
  description:    string | null
  issuedAt:       string | null
  sha256:         string
  items:          PreviewItem[]
}

export type PackageResult<T> = { ok: true; value: T } | { ok: false; reason: PackageFailure; message: string }

/** Checks the signature and the envelope; says why the file can't be used. */
export function verifyPolicyPackage(token: string, publicKeyPem: string, installId: string | null): PackageResult<{ pkg: PolicyPackage; sha256: string }> {
  const trimmed = token.trim()
  const verified = verifyJwtRS256<Record<string, unknown>>(trimmed, { publicKeyPem, issuer: EXPECTED_ISSUER })
  if (!verified.ok) return { ok: false, reason: verified.reason, message: verified.message }
  if (verified.payload.typ !== PACKAGE_TYPE) {
    return { ok: false, reason: 'not_a_policy_package', message: 'This file is signed by GenBioCa but is not a policy package (a license key goes under Licensing).' }
  }
  const parsed = packageSchema.safeParse(verified.payload)
  if (!parsed.success) {
    return { ok: false, reason: 'malformed', message: `The package is not in the expected form: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 400)}` }
  }
  const pkg = parsed.data
  if (pkg.formatVersion > PACKAGE_FORMAT_VERSION) {
    return { ok: false, reason: 'format_too_new', message: `The package needs a newer version of the app (package format ${pkg.formatVersion}; this app reads up to ${PACKAGE_FORMAT_VERSION}).` }
  }
  const ids = pkg.audience.installIds
  if (!ids.includes('*') && !(installId && ids.includes(installId))) {
    return { ok: false, reason: 'not_for_this_install', message: `The package was issued for another install${installId ? ` (this install is ${installId})` : ''}.` }
  }
  return { ok: true, value: { pkg, sha256: createHash('sha256').update(trimmed).digest('hex') } }
}

const NOT_YET = ['aiPrompt', 'bestPractice', 'checklist'] as const
const KIND_LABEL: Record<(typeof NOT_YET)[number], string> = { aiPrompt: 'AI prompts', bestPractice: 'best-practice rules', checklist: 'checklists' }

export class PolicyPackageService {
  private readonly policies: DocumentTypePolicyService

  constructor(private readonly prisma: PrismaClient, private readonly key: { publicKeyPem: string; installId: string | null }) {
    this.policies = new DocumentTypePolicyService(prisma)
  }

  /** What importing the package would do, without changing anything. */
  async preview(token: string): Promise<PackageResult<PackagePreview & { plans: Map<string, BuildPlan> }>> {
    const verified = verifyPolicyPackage(token, this.key.publicKeyPem, this.key.installId)
    if (!verified.ok) return verified
    const { pkg, sha256 } = verified.value
    const items: PreviewItem[] = []
    const plans = new Map<string, BuildPlan>()

    for (const content of pkg.contents) {
      const docType = content.docType.replace(/-/g, '_')
      const errors: string[] = []
      const warnings: string[] = []
      if (items.some(i => i.docType === docType)) errors.push(`The package covers ${docType} more than once.`)
      for (const kind of NOT_YET) {
        if (content[kind] !== undefined) errors.push(`This version of the app can’t import ${KIND_LABEL[kind]} yet.`)
      }

      const [current, last] = await Promise.all([
        this.policies.getCurrent(docType),
        this.prisma.documentTypePolicy.findFirst({ where: { docType }, orderBy: { version: 'desc' }, select: { version: true } }),
      ])
      const template = await this.templateFor(docType, current?.templateId ?? null)
      let stages: PreviewItem['stages'] = []

      if (content.buildPlan === undefined) {
        errors.push('The package has nothing to import for this document type.')
      } else {
        const plan = parseBuildPlan(content.buildPlan)
        if (!plan.ok) {
          errors.push(...plan.errors.map(e => `Build plan: ${e}`))
        } else if (plan.plan.docType.replace(/-/g, '_') !== docType) {
          errors.push(`The build plan is for ${plan.plan.docType}, not ${docType}.`)
        } else {
          plans.set(docType, plan.plan)
          stages = plan.plan.stages.map(s => ({ label: s.label, sections: s.sections.length }))
          const source = current?.buildPlanSource as Partial<BuildPlanSource> | null | undefined
          if (source?.packageId === pkg.packageId && typeof source.packageVersion === 'number' && source.packageVersion >= pkg.packageVersion) {
            errors.push(`Version ${source.packageVersion} of this package is already imported; this file is version ${pkg.packageVersion}. To go back, reactivate an earlier policy version instead.`)
          }
          if (template) warnings.push(...checkPlanAgainstTemplate(plan.plan, template.sections))
          else warnings.push(`There is no ${docType} template yet. The plan is checked against it when one is added.`)
        }
      }

      items.push({
        docType,
        currentVersion: current?.version ?? null,
        newVersion: (last?.version ?? 0) + 1,
        template: template ? { id: template.id, label: template.label, version: template.version } : null,
        stages,
        errors,
        warnings,
      })
    }

    return {
      ok: true,
      value: {
        ok: items.every(i => i.errors.length === 0),
        packageId: pkg.packageId,
        packageVersion: pkg.packageVersion,
        description: pkg.description ?? null,
        issuedAt: pkg.iat ? new Date(pkg.iat * 1000).toISOString() : null,
        sha256,
        items,
        plans,
      },
    }
  }

  /** Applies the package: one new policy version per document type. Nothing is applied unless every item can be. */
  async importPackage(token: string, actorId: string): Promise<PackageResult<PackagePreview & { applied: Array<{ docType: string; version: number; policyId: string }> }>> {
    const preview = await this.preview(token)
    if (!preview.ok) return preview
    const { plans, ...view } = preview.value
    if (!view.ok) return { ok: true, value: { ...view, applied: [] } }
    const importedAt = new Date().toISOString()
    const applied: Array<{ docType: string; version: number; policyId: string }> = []
    for (const item of view.items) {
      const source: BuildPlanSource = { packageId: view.packageId, packageVersion: view.packageVersion, sha256: view.sha256, importedAt, importedBy: actorId }
      const row = await this.policies.newVersionWithPlan(item.docType, plans.get(item.docType)! as unknown as object, source as unknown as object, actorId)
      applied.push({ docType: item.docType, version: row.version, policyId: row.id })
    }
    return { ok: true, value: { ...view, applied } }
  }

  /** The template a doc type's documents are created from: the policy's pinned one, else the current one. */
  async templateFor(docType: string, pinnedId: string | null): Promise<{ id: string; label: string; version: number; sections: TemplateSection[] } | null> {
    const select = { id: true, label: true, version: true, sections: true } as const
    const row = (pinnedId ? await this.prisma.documentTemplate.findUnique({ where: { id: pinnedId }, select }) : null)
      ?? await this.prisma.documentTemplate.findFirst({
        where: { type: { in: [docType, docType.replace(/_/g, '-')] }, isCurrent: true, retiredAt: null },
        select,
      })
    if (!row) return null
    return { id: row.id, label: row.label, version: row.version, sections: templateSectionsOf(row.sections) }
  }
}

export function templateSectionsOf(raw: unknown): TemplateSection[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((s): s is { number: string; title: string } => !!s && typeof s.number === 'string' && typeof s.title === 'string')
    .map(s => ({ number: s.number, title: s.title }))
}
