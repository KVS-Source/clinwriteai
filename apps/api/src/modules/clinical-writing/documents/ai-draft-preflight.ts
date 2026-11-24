// AI-draft preflight.
//
// Before kicking off an initial draft, verify every input the worker
// needs is actually available. When anything is missing we return a
// structured issue list (code + human message + fix path) so the UI
// can open the AI Debug panel with actionable blockers instead of
// surfacing a generic modal / toast.
//
// Blockers (severity 'block' — Continue button stays disabled until fixed):
//   - ai_not_configured     → no Anthropic key + stub mode off
//   - no_policy_for_doctype → no current DocumentTypePolicy for this doc type
//   - no_template           → policy.requirements.requireTemplate but no template resolves
//   - no_checklist          → policy exists but no platform checklist resolves
//                             (pinned id missing OR no locked baseline for doc type)
//   - no_sources            → zero DocumentSource rows attached
//                             (only when policy.requirements.requireSources)
//   - all_sources_dropped   → sources attached but all would be dropped
//                             (non-PDF, exceeds cap, not confirmed, virus-failed)
//   - no_purpose            → policy.requirements.requirePurpose but
//                             document.aiInstructions is blank
//
// Pure read function: never writes. Callers (preflight route, start
// route, document-create flow) use the result to gate enqueue.

import type { PrismaClient } from '@prisma/client'
import { resolvePolicyAssets } from '../../platform/document-type-policy/resolve-assets.js'
import { resolveAnthropicKey } from '../../platform/ai-gateway/resolve-anthropic-key.js'
import { stubAllowed } from '../../platform/ai-gateway/service.js'
import { requirementsOf } from '../../platform/document-type-policy/schema.js'

export type PreflightIssueCode =
  | 'ai_not_configured'
  | 'no_policy_for_doctype'
  | 'no_template'
  | 'no_checklist'
  | 'no_sources'
  | 'all_sources_dropped'
  | 'no_purpose'

export interface PreflightIssue {
  code:     PreflightIssueCode
  severity: 'block'
  message:  string
  fixPath?: string
}

export interface PreflightResult {
  ok:     boolean
  issues: PreflightIssue[]
}

/** Matches the worker's size cap (ai-initial-draft.ts). */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024

export async function computeDraftPreflight(
  prisma:     PrismaClient,
  documentId: string,
): Promise<PreflightResult> {
  const doc = await prisma.document.findUnique({
    where:  { id: documentId },
    select: { id: true, type: true, projectId: true, aiInstructions: true, deletedAt: true },
  })
  if (!doc || doc.deletedAt) {
    return { ok: false, issues: [] }
  }

  const issues: PreflightIssue[] = []

  // 1. AI engine configured (or stub mode is on for dev/CI).
  const anthropicKey = await resolveAnthropicKey(prisma)
  if (!anthropicKey && !stubAllowed()) {
    issues.push({
      code:     'ai_not_configured',
      severity: 'block',
      message:  'No AI engine is configured for this deployment. Set up an engine in Admin before drafting.',
      fixPath:  '/admin/ai-engines',
    })
  }

  // 2. Policy exists for this doc type. Everything else is read from the
  //    policy's `requirements` block so PMs can switch each check off per
  //    doc type without re-deploying the server.
  const normalisedType = doc.type.replace(/-/g, '_')
  const policy = await prisma.documentTypePolicy.findFirst({
    where:  { docType: normalisedType, isCurrent: true, retiredAt: null },
    select: {
      id: true, docType: true,
      templateId: true, checklistTemplateId: true,
      ichFramework: true, ichFrameworkNames: true,
      requirements: true,
    },
  })
  if (!policy) {
    issues.push({
      code:     'no_policy_for_doctype',
      severity: 'block',
      message:  `No policy is anchored for doc type '${normalisedType}'. Anchor one in Master Library → Policies before drafting.`,
      fixPath:  '/master-library/policies',
    })
    // Without a policy we can't read requirements, so stop checking now;
    // the policy anchor is what unblocks the rest.
    return { ok: false, issues }
  }

  const requirements = requirementsOf(policy)
  const assets       = await resolvePolicyAssets(prisma, policy)

  // 3. Template resolves (pinned or auto-matched) — only when the PM
  //    requires it on this doc type.
  if (requirements.requireTemplate && assets.template.effective === 'none') {
    issues.push({
      code:     'no_template',
      severity: 'block',
      message:  `No template resolves for doc type '${normalisedType}'. Lock one in Master Library → Templates, or pin an existing template on the policy.`,
      fixPath:  '/master-library/templates',
    })
  }

  // 4. Checklist resolves. Always checked — the compliance appendix the
  //    final-PDF renderer stamps needs a baseline to measure against.
  if (assets.checklist.effective === 'none') {
    issues.push({
      code:     'no_checklist',
      severity: 'block',
      message:  `No platform checklist resolves for doc type '${normalisedType}'. Lock one in Master Library → Checklists before drafting.`,
      fixPath:  '/master-library/checklists',
    })
  }

  // 5. Sources attached + at least one usable — only when required.
  if (requirements.requireSources) {
    const sourceLinks = await prisma.documentSource.findMany({
      where:  { documentId },
      select: { uploadId: true },
    })
    if (sourceLinks.length === 0) {
      issues.push({
        code:     'no_sources',
        severity: 'block',
        message:  'No source documents are attached. The drafter grounds every section on the attached sources — add at least one before drafting.',
        fixPath:  `/projects/${doc.projectId}/clinical-writing/documents/${documentId}#sources`,
      })
    } else {
      const uploads = await prisma.documentUpload.findMany({
        where:  { id: { in: sourceLinks.map(l => l.uploadId) } },
        select: {
          id: true, contentType: true, fileSizeBytes: true,
          status: true, virusScanStatus: true,
        },
      })
      const usable = uploads.some(u => {
        const isPdf = (u.contentType ?? '').toLowerCase() === 'application/pdf'
        return u.status === 'confirmed'
            && u.virusScanStatus !== 'failed'
            && isPdf
            && u.fileSizeBytes <= MAX_SOURCE_BYTES
      })
      if (!usable) {
        issues.push({
          code:     'all_sources_dropped',
          severity: 'block',
          message:  'Every attached source was dropped by the drafter (non-PDF, too large, or not yet confirmed). Attach a usable PDF source before drafting.',
          fixPath:  `/projects/${doc.projectId}/clinical-writing/documents/${documentId}#sources`,
        })
      }
    }
  }

  // 6. Purpose (= Create wizard's "Instructions for the AI drafter"
  //    field) — only when the policy requires it. Stored on
  //    document.aiInstructions.
  if (requirements.requirePurpose && !doc.aiInstructions?.trim()) {
    issues.push({
      code:     'no_purpose',
      severity: 'block',
      message:  "The document's purpose is required for this doc type — fill in the Instructions for the AI field in the editor header.",
      fixPath:  `/projects/${doc.projectId}/clinical-writing/documents/${documentId}#purpose`,
    })
  }

  return { ok: issues.length === 0, issues }
}
