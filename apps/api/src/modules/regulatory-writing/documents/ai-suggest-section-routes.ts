// Phase M-D.4 — regulatory document section AI-suggest endpoint.
// Mirror of med-content /ai-suggest scoped to RegulatoryDocumentSection
// rows. Composes the Claude call from grounding rules + policy +
// attached source PDFs.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { requireAuth } from '../../../auth/rbac.js'
import {
  resolveForRegulatoryDocument,
  renderRegPolicyPromptBlock,
  SECTION_GROUNDING_RULES,
} from '../policy/resolve.js'
import {
  actorCanEditRegulatoryDocument,
  REG_DOC_EDIT_FORBIDDEN,
} from '../access/regulatory-document-raci.js'
// Migration 105 Package R-4 — shared validators + retry wrapper + the
// three regulatory-specific helpers (CSR grounding, source auto-attach,
// Module 5 gate).
import { extractManifest, renderForPrompt as renderMustPreserve } from '../../clinical-writing/documents/must-preserve.js'
import { callWithValidation, type StepEmitter } from '../../clinical-writing/documents/ai-suggest-retry.js'
import { scoreSection } from '../../clinical-writing/documents/ai-confidence.js'
import { buildRegulatoryAttachedContext } from './must-preserve-reg.js'
// loadRegulatoryDocumentSources exists in ./document-sources.js for
// shared use by R-5 and future code paths; the existing inline PDF
// loader below already covers this route's needs (same upload-filter +
// cap logic the helper encapsulates).
import { checkModule5Gate, MODULE_5_READONLY_FORBIDDEN } from './ectd-gate.js'
import { validateHaResponseStructure, isHaGatedType } from './ha-structure-validator.js'
import { validateCtdStructure, isCtdGatedType } from './ctd-structure-validator.js'

const writeGate = requireAuth({ modules: ['D'] })

const aiSuggestSchema = z.object({
  intent:         z.enum(['draft_from_source', 'tighten', 'explain', 'custom', 'edit']),
  customPrompt:   z.string().min(1).max(2000).optional(),
  currentContent: z.string().max(200_000).optional(),
  selectionText:  z.string().max(50_000).optional(),
  scope:          z.enum(['section', 'document', 'source']).optional(),
  attachedSourceIds: z.array(z.string().min(1)).max(20).optional(),
  model:          z.string().optional(),
}).refine(b => b.intent !== 'edit' || !!b.customPrompt?.trim(), {
  message: 'Tell the AI what to change',
  path:    ['customPrompt'],
})

function stripCodeFence(text: string): string {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return (m ? m[1]! : text).trim()
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export const regulatoryDocumentAiSuggestSectionRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:id/sections/:sectionId/ai-suggest', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const parsed = aiSuggestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id },
      select: {
        id: true, projectId: true, docType: true, regulatoryTrack: true, archivedAt: true,
        aiInstructions: true, currentVersionId: true,
        regTypePolicyVersionAtCreate: true,
        regAiPromptRecordId:          true,
        regBestPracticeRecordId:      true,
      },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })
    if (!doc.currentVersionId) return reply.code(409).send({ error: 'no_current_version' })

    if (!(await actorCanEditRegulatoryDocument(app.prisma, request.user!, id))) {
      return reply.code(403).send(REG_DOC_EDIT_FORBIDDEN)
    }

    // Module 5 read-only gate (Package R-4). DD-D-001: Module 5 (CSR)
    // sections are sourced from Clinical Writing documents in Module A
    // and are read-only here. Refuse BEFORE any AI call.
    const module5 = await checkModule5Gate(app.prisma, id)
    if (module5.readOnly) {
      return reply.code(403).send({ ...MODULE_5_READONLY_FORBIDDEN, message: module5.message, moduleSections: module5.moduleSections })
    }

    const section = await app.prisma.regulatoryDocumentSection.findFirst({
      where:  { regulatoryDocumentVersionId: doc.currentVersionId, sectionId },
      select: {
        id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true,
        // Package R-4: read snapshotted guidance for the TEMPLATE
        // GUIDANCE prompt block.
        templateInstructions: true, templateGuidance: true,
      },
    })
    if (!section) return reply.code(404).send({ error: 'section_not_found' })

    const sectionHeader = `§${section.sectionNumber} ${section.sectionTitle}`
    const currentContent = (parsed.data.intent === 'edit' ? parsed.data.currentContent : undefined)
      ?? section.contentHtml ?? ''

    const docType = doc.docType.toLowerCase().replace(/-/g, '_')
    const policy = await resolveForRegulatoryDocument(app.prisma, {
      docType,
      regTypePolicyVersionAtCreate: doc.regTypePolicyVersionAtCreate,
      regAiPromptRecordId:          doc.regAiPromptRecordId,
      regBestPracticeRecordId:      doc.regBestPracticeRecordId,
    }).catch(err => {
      request.log.warn({ err, regulatoryDocumentId: id }, 'reg ai-suggest: policy resolve failed — continuing with no-policy block')
      return null
    })
    const policyBlock = renderRegPolicyPromptBlock(policy, section.sectionId)

    // --- Source auto-attach ------------------------------------------------
    // DocumentUpload rows scoped to the parent project are the primary
    // references; narrow to the ones the caller flagged plus any PDFs in
    // the project. (Regulatory doesn't have a per-document upload
    // scoping yet; the auto-attach refines when that lands.)
    const explicitAttachedIds = parsed.data.attachedSourceIds ?? []
    let autoAttachedUploadIds: string[] = []
    try {
      const uploads = await app.prisma.documentUpload.findMany({
        where:  { projectId: doc.projectId, contentType: 'application/pdf', status: 'confirmed' },
        select: { id: true },
        take:   10,
      })
      autoAttachedUploadIds = uploads.map(u => u.id)
    } catch (err) {
      request.log.warn({ err, regulatoryDocumentId: id }, 'reg ai-suggest: DocumentUpload lookup failed')
    }
    const effectiveAttachedIds = Array.from(new Set([...explicitAttachedIds, ...autoAttachedUploadIds]))

    const MAX_PDF_DOCS = 3
    const MAX_PDF_BYTES = 25 * 1024 * 1024
    const documentAttachments: Array<{ mediaType: string; data: Buffer; label?: string }> = []
    const textExcerpts: string[] = []
    const scope = effectiveAttachedIds.length > 0 ? 'source' : (parsed.data.scope ?? 'section')
    if (scope === 'source' && effectiveAttachedIds.length > 0) {
      try {
        const uploads = await app.prisma.documentUpload.findMany({
          where:  { id: { in: effectiveAttachedIds } },
          select: { id: true, fileName: true, blobKey: true, contentType: true },
        })
        for (const u of uploads) {
          if ((u.contentType ?? '').toLowerCase() !== 'application/pdf') continue
          if (documentAttachments.length >= MAX_PDF_DOCS) break
          try {
            const blob = await app.blob.get('documents', u.blobKey)
            const bytes = blob.body as Buffer
            if (bytes.length > MAX_PDF_BYTES) {
              textExcerpts.push(`--- ${u.fileName} (too large to attach: ${(bytes.length / (1024*1024)).toFixed(1)} MB) ---`)
              continue
            }
            documentAttachments.push({
              mediaType: 'application/pdf',
              data:      bytes,
              label:     u.fileName,
            })
          } catch (err) {
            request.log.warn({ err, uploadId: u.id }, 'reg ai-suggest: blob read failed')
          }
        }
      } catch (err) {
        request.log.warn({ err }, 'reg ai-suggest: source upload fetch failed')
      }
    }

    // Build the intent-templated prompt.
    let promptBody: string
    switch (parsed.data.intent) {
      case 'draft_from_source':
        promptBody = `You are drafting the "${sectionHeader}" section of a regulatory submission narrative document (${docType}). Draft the section body using the attached source documents. Preserve numeric values and reference markers verbatim.`
        break
      case 'tighten':
        promptBody = `Rewrite the following section for clarity and concision. Preserve every data point and reference marker. Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}`
        break
      case 'explain':
        promptBody = `Rewrite the following section in plain English. Keep all numeric values and reference markers. Section: ${sectionHeader}\n\nContent:\n${currentContent}`
        break
      case 'custom':
        promptBody = `Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}\n\nUser request:\n${parsed.data.customPrompt ?? ''}`
        break
      case 'edit':
        if (parsed.data.selectionText && parsed.data.selectionText.trim().length > 0) {
          promptBody = [
            `You are editing a highlighted passage inside the "${sectionHeader}" section of a regulatory submission document (${docType}).`,
            `Apply the instruction below to the passage and return ONLY the revised passage (not the whole section).`,
            `Return only HTML using these tags: p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td. No attributes, no explanations, no code fences.`,
            `Do not invent data, numbers, dates, names, trial identifiers, or references not in the passage or the surrounding section. Insert [TBD: what is needed] for gaps.`,
            '',
            `Instruction:\n${parsed.data.customPrompt!.trim()}`,
            '',
            `Highlighted passage:\n${parsed.data.selectionText}`,
            '',
            `Full section (for context only — do not return):\n${currentContent || '(empty)'}`,
          ].join('\n')
        } else {
          promptBody = [
            `You are editing the "${sectionHeader}" section of a regulatory submission document (${docType}).`,
            `Apply the instruction below and return the COMPLETE revised section.`,
            `Return only HTML using these tags: p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td.`,
            `Do not invent data, numbers, dates, names, trial identifiers, or references. Insert [TBD: what is needed] for gaps.`,
            '',
            `Instruction:\n${parsed.data.customPrompt!.trim()}`,
            '',
            `Current section content (HTML):\n${currentContent || '(empty)'}`,
          ].join('\n')
        }
        break
    }

    const authorBlock = doc.aiInstructions?.trim()
      ? [``, `Author's instructions (follow in addition to the rules above):`, doc.aiInstructions.trim(), ``].join('\n')
      : ''

    const scaffold = [
      `You are revising a single section of a regulatory submission narrative document (${docType}).`,
      `Section id: ${section.sectionId} · number ${section.sectionNumber} · title ${section.sectionTitle}.`,
      '',
      SECTION_GROUNDING_RULES,
    ].join('\n')

    // Package R-4: TEMPLATE GUIDANCE block from the snapshotted
    // instructions + guidance on the section row.
    const tIns  = ((section as { templateInstructions?: string | null }).templateInstructions ?? '').trim()
    const tGuid = ((section as { templateGuidance?:     string | null }).templateGuidance     ?? '').trim()
    const templateGuidanceBlock = tIns || tGuid
      ? [
          ``,
          `TEMPLATE GUIDANCE for this section (from the template authored for ${docType}):`,
          tIns  ? `  Content requirements:\n    ${tIns.replace(/\n/g, '\n    ')}` : '',
          tGuid ? `  Writing guidance:\n    ${tGuid.replace(/\n/g, '\n    ')}` : '',
          `Follow these precisely — they are the template's authored intent for this section.`,
          ``,
        ].filter(Boolean).join('\n')
      : ''

    // Package R-4: MUST PRESERVE manifest extracted fresh from the
    // current body. Catches dropped CSR cross-refs (Table 14.2.1,
    // §14.3.2.1, Figure 2.1) + numbers + study ids via the shared
    // regex. The retry wrapper diffs this against the model output.
    const manifestBefore = extractManifest(currentContent)
    const mustPreserveBlock = renderMustPreserve(manifestBefore)

    // Package R-4: CSR grounding via CanonicalJsonEntry on the parent
    // submission. Degraded mode (no indexed entries) returns empty
    // allowedTokens → the citation-grounding check becomes
    // informational only; dropped-ref catches still fire.
    const attachedSources = await buildRegulatoryAttachedContext(app.prisma, id)

    const composedPrompt = [
      scaffold,
      authorBlock,
      policyBlock ? `\n${policyBlock}\n` : '',
      templateGuidanceBlock,
      mustPreserveBlock,
      '---',
      promptBody,
      textExcerpts.length > 0 ? `\n---\nAttachments metadata:\n${textExcerpts.join('\n')}` : '',
    ].filter(Boolean).join('\n')

    try {
      // Package R-4: step emitter writes to ai_draft_steps keyed by
      // regulatoryDocumentId (no FK on that column, so safe).
      const stepsEmitter: StepEmitter = {
        async emit(kind, message, opts) {
          await app.prisma.aiDraftStep.create({
            data: {
              documentId: id,
              versionId:  doc.currentVersionId ?? null,
              kind,
              message:    message.slice(0, 1_000),
              sectionId:  opts?.sectionId ?? null,
              details:    (opts?.details ?? {}) as unknown as object,
              elapsedMs:  0,
            },
          })
        },
      }

      let lastGatewayResult: Awaited<ReturnType<typeof app.aiGateway.chat>> | null = null
      const validation = await callWithValidation({
        manifestBefore,
        attachedSources,
        steps:     stepsEmitter,
        sectionId: section.sectionId,
        call: async ({ prependPrompt }) => {
          const effectivePrompt = prependPrompt
            ? `${prependPrompt}\n\n----\n\n${composedPrompt}`
            : composedPrompt
          const r = await app.aiGateway.chat({
            tenantId:           request.user!.tenantId ?? 'unknown',
            projectId:          doc.projectId,
            actorId:            request.user!.id,
            module:             'D',
            intent:             parsed.data.intent,
            model:              parsed.data.model || 'claude-sonnet-4-5',
            prompt:             effectivePrompt,
            maxOutputTokens:    parsed.data.intent === 'edit' ? 4096 : 2048,
            documents:          documentAttachments.length > 0 ? documentAttachments : undefined,
            documentId:         id,
            sectionId:          section.sectionId,
            preCallSectionHtml: currentContent,
            promptText:         parsed.data.customPrompt ?? parsed.data.intent,
          })
          lastGatewayResult = r
          return { html: parsed.data.intent === 'edit' ? stripCodeFence(r.responseText) : r.responseText }
        },
      })
      const result = lastGatewayResult!

      // Package R-5: HA response structural soft validator. Fires on
      // ha_response_narrative content when the rewrite dropped too
      // many of the conventional labels (Question / Response /
      // Rationale / Dossier Impact / References).
      const flagsWithExtra = [...validation.flags]
      let haStructureTrace: ReturnType<typeof validateHaResponseStructure> | null = null
      if (isHaGatedType(doc.docType)) {
        haStructureTrace = validateHaResponseStructure(validation.html)
        if (haStructureTrace.looksLikeHaResponse && !haStructureTrace.structurallyValid
            && !flagsWithExtra.includes('ha_response_structure_invalid')) {
          flagsWithExtra.push('ha_response_structure_invalid')
        }
      }

      // Package RD-2: CTD invented-cross-ref soft validator. Fires on
      // ctd_m2_* content when the AI invented a §X.Y.Z that shares
      // the document's module top but isn't on the ICH canonical
      // subsection list (e.g. §2.5.9 on a M2.5 doc).
      let ctdStructureTrace: ReturnType<typeof validateCtdStructure> | null = null
      if (isCtdGatedType(doc.docType)) {
        ctdStructureTrace = validateCtdStructure(validation.html, currentContent ?? '', doc.docType)
        if (ctdStructureTrace.gated && !ctdStructureTrace.structurallyValid
            && !flagsWithExtra.includes('ctd_invalid_cross_ref')) {
          flagsWithExtra.push('ctd_invalid_cross_ref')
        }
      }

      // Package R-4: persist aiConfidence + aiFlags on the section row
      // so the existing RegulatoryDocumentLiveEditor badge + flag
      // chips reflect the retry outcome + the HA soft flag.
      try {
        const score = scoreSection(flagsWithExtra)
        await app.prisma.regulatoryDocumentSection.update({
          where: { id: section.id },
          data:  { aiConfidence: score, aiFlags: flagsWithExtra },
        })
      } catch (err) {
        app.log.warn({ err, regulatoryDocumentId: id, sectionId: section.sectionId }, 'reg section confidence update failed (non-fatal)')
      }

      const responseText = validation.html

      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'regulatory_document_ai_suggestion_requested',
        entityType: 'regulatory_document',
        entityId:   id,
        details: {
          sectionId:             section.sectionId,
          sectionLabel:          sectionHeader,
          intent:                parsed.data.intent,
          scope,
          selectionScoped:       !!parsed.data.selectionText?.trim(),
          promptSha256:          sha256(composedPrompt),
          promptChars:           composedPrompt.length,
          aiModel:               result.model,
          aiCallRecordId:        result.recordId,
          policyVersionUsed:     policy?.version ?? null,
          regulatoryTrackUsed:   policy?.regulatoryTrack ?? doc.regulatoryTrack ?? null,
          autoAttachedSources:   autoAttachedUploadIds.length,
          explicitAttachedSources: explicitAttachedIds.length,
          outcome:               'completed',
          // Package R-4: CSR grounding + validator outcome audit.
          canonicalTokensCount: attachedSources.allowedTokens?.length ?? 0,
          validatorFlags:       flagsWithExtra,
          validatorRetried:     validation.retried,
          // Package R-5: HA structure trace (null for non-HA types).
          haStructureTrace:     haStructureTrace,
          // Package RD-2: CTD invented-cross-ref trace (null for non-CTD).
          ctdStructureTrace:    ctdStructureTrace,
          validatorTrace:       validation.trace.map(t => ({
            attempt: t.attempt,
            flags:   t.flags.map(f => ({ code: f.code, severity: f.severity })),
            retriedBecause: t.retriedBecause,
          })),
        },
        ipAddress: request.ip ?? null,
      }).catch(err => request.log.error({ err }, 'regulatory_document_ai_suggestion_requested audit failed'))

      return parsed.data.intent === 'edit'
        ? { ...result, responseText, scope: parsed.data.selectionText ? 'selection' : 'section' }
        : { ...result, responseText }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'RateLimitedError') {
        return reply.code(429).send({ error: 'quota_reached', message: err.message })
      }
      throw err
    }
  })
}
