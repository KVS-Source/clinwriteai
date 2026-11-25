// Phase M-B.4 — publication section AI-suggest endpoint.
//
// Mirror of clinical-writing's /ai-suggest scoped to publication
// sections. Accepts an intent (tighten / explain / edit / custom /
// draft_from_source), composes the system prompt from
// SECTION_GROUNDING_RULES + author aiInstructions + publication
// policy block (SME prompt + reporting guideline + BP digest + section
// rules for THIS section), optionally attaches source PDFs from the
// publication's linked source document, and calls Claude via the
// shared aiGateway. Returns the revised HTML.
//
// Source auto-attach rule (mirrors Module A's SourceReference
// auto-attach): the linked source document's uploads are always made
// available as PDF attachments on the Claude call. Caller can also
// explicitly attach uploads via `attachedSourceIds`. The two sets are
// de-duplicated.
//
// No lock gate here — AI-suggest only READS the section (currentContent
// is passed in the body), it doesn't write to PublicationSectionContent.
// The caller writes the accepted result via PATCH /sections/:id,
// which runs the lock gate.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { requireAuth } from '../../../auth/rbac.js'
import {
  resolveForPublication,
  renderPubPolicyPromptBlock,
  SECTION_GROUNDING_RULES,
} from '../policy/resolve.js'
import { actorCanEditPublicationContent, PUBLICATION_EDIT_FORBIDDEN } from './access/publication-raci.js'
// Migration 105 Package B-5 — shared manifest + validators + retry
// wrapper (Clinical), plus the publication-aware attached-context
// helper (B-3) for Vancouver [N] grounding.
import { extractManifest, renderForPrompt as renderMustPreserve } from '../../clinical-writing/documents/must-preserve.js'
import { callWithValidation, type StepEmitter } from '../../clinical-writing/documents/ai-suggest-retry.js'
import { scoreSection } from '../../clinical-writing/documents/ai-confidence.js'
import { buildPublicationAttachedContext } from './must-preserve-pub.js'

const writeGate = requireAuth({ modules: ['B'] })

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

export const publicationAiSuggestRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:id/sections/:sectionId/ai-suggest', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const parsed = aiSuggestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({
      where: { id },
      select: {
        id: true, projectId: true, type: true, subtype: true, deletedAt: true,
        sourceDocumentId: true, aiInstructions: true,
        pubTypePolicyVersionAtCreate:           true,
        publicationAiPromptRecordId:            true,
        publicationBestPracticeRecordId:        true,
        currentVersionId: true,
      },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })
    if (!pub.currentVersionId) return reply.code(409).send({ error: 'no_current_version' })
    if (!(await actorCanEditPublicationContent(app.prisma, request.user!, id))) {
      return reply.code(403).send(PUBLICATION_EDIT_FORBIDDEN)
    }

    const section = await app.prisma.publicationSectionContent.findFirst({
      where:  { publicationVersionId: pub.currentVersionId, sectionId },
      select: {
        id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true,
        // Migration 105 Package B-5 — read the snapshot fields so the
        // prompt assembly below can render a TEMPLATE GUIDANCE block
        // without a second query.
        templateInstructions: true, templateGuidance: true,
      },
    })
    if (!section) return reply.code(404).send({ error: 'section_not_found' })

    const sectionHeader = `§${section.sectionNumber} ${section.sectionTitle}`
    const currentContent = (parsed.data.intent === 'edit' ? parsed.data.currentContent : undefined)
      ?? section.contentHtml ?? ''

    // Resolve policy (SME + guideline + BP digest + section rules).
    const docType = (pub.subtype ? `${pub.type}_${pub.subtype}` : pub.type).toLowerCase().replace(/-/g, '_')
    const policy = await resolveForPublication(app.prisma, {
      docType,
      pubTypePolicyVersionAtCreate:     pub.pubTypePolicyVersionAtCreate,
      publicationAiPromptRecordId:      pub.publicationAiPromptRecordId,
      publicationBestPracticeRecordId:  pub.publicationBestPracticeRecordId,
    }).catch(err => {
      request.log.warn({ err, publicationId: id }, 'pub ai-suggest: policy resolve failed — continuing with no-policy block')
      return null
    })
    const policyBlock = renderPubPolicyPromptBlock(policy, section.sectionId)

    // --- Source auto-attach ------------------------------------------------
    // Uploads linked to Publication.sourceDocumentId (via DocumentSource)
    // are the primary references for the publication. Always attached
    // regardless of the Scope toggle so AI can pull from primary sources
    // when revising a sentence. Explicit attachedSourceIds also merge in
    // (de-duped by uploadId).
    const explicitAttachedIds = parsed.data.attachedSourceIds ?? []
    let autoAttachedUploadIds: string[] = []
    if (pub.sourceDocumentId) {
      try {
        const links = await app.prisma.documentSource.findMany({
          where:  { documentId: pub.sourceDocumentId },
          select: { uploadId: true },
        })
        autoAttachedUploadIds = Array.from(new Set(links.map(l => l.uploadId)))
      } catch (err) {
        request.log.warn({ err, publicationId: id }, 'pub ai-suggest: source auto-attach lookup failed')
      }
    }
    const effectiveAttachedIds = Array.from(new Set([...explicitAttachedIds, ...autoAttachedUploadIds]))

    // Load + extract source PDFs. Budget: 60 KB text total across all
    // text-extractable sources; PDFs oversized for text extraction get
    // attached as document blocks (Anthropic reads them natively).
    const MAX_PDF_DOCS = 3
    const MAX_PDF_BYTES = 25 * 1024 * 1024
    const documentAttachments: Array<{ mediaType: string; data: Buffer; label?: string }> = []
    const textExcerpts: string[] = []
    const scope = effectiveAttachedIds.length > 0 ? 'source' : (parsed.data.scope ?? 'section')
    if (scope === 'source' && effectiveAttachedIds.length > 0) {
      try {
        const uploads = await app.prisma.documentUpload.findMany({
          where:  { id: { in: effectiveAttachedIds } },
          select: { id: true, title: true, fileName: true, blobKey: true, contentType: true },
        })
        for (const u of uploads) {
          if ((u.contentType ?? '').toLowerCase() !== 'application/pdf') continue
          if (documentAttachments.length >= MAX_PDF_DOCS) break
          try {
            const blob = await app.blob.get('documents', u.blobKey)
            const bytes = blob.body as Buffer
            if (bytes.length > MAX_PDF_BYTES) {
              textExcerpts.push(`--- ${u.title ?? u.fileName} (too large to attach: ${(bytes.length / (1024*1024)).toFixed(1)} MB) ---`)
              continue
            }
            documentAttachments.push({
              mediaType: 'application/pdf',
              data:      bytes,
              label:     u.title ?? u.fileName,
            })
          } catch (err) {
            request.log.warn({ err, uploadId: u.id }, 'pub ai-suggest: blob read failed — source dropped')
          }
        }
      } catch (err) {
        request.log.warn({ err }, 'pub ai-suggest: source upload fetch failed')
      }
    }

    // Build the intent-templated prompt.
    let promptBody: string
    switch (parsed.data.intent) {
      case 'draft_from_source':
        promptBody = `You are drafting the "${sectionHeader}" section of a scientific manuscript (${docType}). Draft the section body using the attached source documents. Preserve numeric values and reference markers from the sources verbatim.`
        break
      case 'tighten':
        promptBody = `Rewrite the following section for clarity and concision. Preserve every data point and reference marker. Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}`
        break
      case 'explain':
        promptBody = `Rewrite the following section in plain English for a non-specialist reader. Keep all numeric values and reference markers. Section: ${sectionHeader}\n\nContent:\n${currentContent}`
        break
      case 'custom':
        promptBody = `Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}\n\nUser request:\n${parsed.data.customPrompt ?? ''}`
        break
      case 'edit':
        if (parsed.data.selectionText && parsed.data.selectionText.trim().length > 0) {
          promptBody = [
            `You are editing a highlighted passage inside the "${sectionHeader}" section of a scientific manuscript (${docType}).`,
            `Apply the instruction below to the passage and return ONLY the revised passage (not the whole section).`,
            `Return only HTML using these tags: p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td. No attributes, no explanations, no code fences.`,
            `Do not invent data, numbers, dates, names or references not in the passage or the surrounding section. Insert [TBD: what is needed] for gaps.`,
            '',
            `Instruction:\n${parsed.data.customPrompt!.trim()}`,
            '',
            `Highlighted passage:\n${parsed.data.selectionText}`,
            '',
            `Full section (for context only — do not return):\n${currentContent || '(empty)'}`,
          ].join('\n')
        } else {
          promptBody = [
            `You are editing the "${sectionHeader}" section of a scientific manuscript (${docType}).`,
            `Apply the instruction below to the current section content and return the COMPLETE revised section.`,
            `Return only HTML using these tags: p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td.`,
            `Do not invent data, numbers, dates, names or references. Insert [TBD: what is needed] for gaps.`,
            '',
            `Instruction:\n${parsed.data.customPrompt!.trim()}`,
            '',
            `Current section content (HTML):\n${currentContent || '(empty)'}`,
          ].join('\n')
        }
        break
    }

    // Compose final prompt: scaffolding + grounding + author instructions + policy + ask.
    const authorBlock = pub.aiInstructions?.trim()
      ? [``, `Author's instructions (follow in addition to the rules above):`, pub.aiInstructions.trim(), ``].join('\n')
      : ''

    const scaffold = [
      `You are revising a single section of a scientific-writing deliverable (${docType}).`,
      `Section id: ${section.sectionId} · number ${section.sectionNumber} · title ${section.sectionTitle}.`,
      '',
      SECTION_GROUNDING_RULES,
    ].join('\n')

    // --- Template content guidance (migration 105, Package B-5) ----------
    // Rendered from the snapshotted templateInstructions + templateGuidance
    // on the section row (Package B-4 populated them). Same block shape
    // Clinical uses so the AI sees identical "authored intent" framing
    // across both modules.
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

    // --- Must-preserve manifest (migration 105, Package B-5) -------------
    // Extracted fresh from currentContent so the manifest matches what
    // the model is about to rewrite. The retry wrapper uses the SAME
    // manifest downstream to diff the model's output and catch dropped
    // cross-refs / invented citations.
    const manifestBefore = extractManifest(currentContent)
    const mustPreserveBlock = renderMustPreserve(manifestBefore)

    // Vancouver-aware attached context (Package B-3). Every [N] the AI
    // introduces is checked against the publication's Citation rows; any
    // out-of-range index trips 'invented_citation' → hard retry.
    const attachedSources = await buildPublicationAttachedContext(app.prisma, id)

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

    // Fire the Claude call wrapped in the shared validator + retry loop.
    const model = parsed.data.model || undefined
    try {
      // Step-log emitter — writes to ai_draft_steps keyed by the
      // publicationId (documentId is a plain string on that table, no
      // FK, so publication ids slot in without schema changes). Package
      // B-7's AiDebugPanel reads these rows.
      const stepsEmitter: StepEmitter = {
        async emit(kind, message, opts) {
          await app.prisma.aiDraftStep.create({
            data: {
              documentId: id,
              versionId:  pub.currentVersionId ?? null,
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
            tenantId:          request.user!.tenantId,
            projectId:         pub.projectId,
            actorId:           request.user!.id,
            module:            'B',
            intent:            parsed.data.intent,
            model:             model || 'claude-sonnet-4-5',
            prompt:            effectivePrompt,
            maxOutputTokens:   parsed.data.intent === 'edit' ? 4096 : 2048,
            documents:         documentAttachments.length > 0 ? documentAttachments : undefined,
            documentId:        id,                     // reuse the field for publicationId — chat records are polymorphic by entityId
            sectionId:         section.sectionId,
            preCallSectionHtml: currentContent,
            promptText:        parsed.data.customPrompt ?? parsed.data.intent,
          })
          lastGatewayResult = r
          return { html: parsed.data.intent === 'edit' ? stripCodeFence(r.responseText) : r.responseText }
        },
      })
      const result = lastGatewayResult!

      // Persist aiConfidence + aiFlags on the publication section row so
      // the Module B badge + report panel reflect the retry outcome.
      try {
        const score = scoreSection(validation.flags)
        await app.prisma.publicationSectionContent.update({
          where: { id: section.id },
          data:  { aiConfidence: score, aiFlags: validation.flags },
        })
      } catch (err) {
        app.log.warn({ err, publicationId: id, sectionId: section.sectionId }, 'pub section confidence update failed (non-fatal)')
      }

      const responseText = validation.html

      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_ai_suggestion_requested',
        entityType: 'publication',
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
          guidelineUsed:         policy?.guidelineKey ?? null,
          autoAttachedSources:   autoAttachedUploadIds.length,
          explicitAttachedSources: explicitAttachedIds.length,
          outcome:               'completed',
          // Post-generation validator outcome (migration 105 Package B-5).
          validatorFlags:        validation.flags,
          validatorRetried:      validation.retried,
          validatorTrace:        validation.trace.map(t => ({
            attempt: t.attempt,
            flags:   t.flags.map(f => ({ code: f.code, severity: f.severity })),
            retriedBecause: t.retriedBecause,
          })),
        },
        ipAddress: request.ip ?? null,
      }).catch(err => request.log.error({ err }, 'pub_ai_suggestion_requested audit failed'))

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

  // GET /publications/:id/ai-debug-steps (migration 105 Package B-7)
  //
  // Returns the per-publication step log the ai-suggest retry wrapper
  // writes via Package B-5's step emitter. Scoped subset of Clinical's
  // GET /documents/:id/ai-debug — only the draftSteps field, because
  // Module B doesn't have Clinical's full ai-debug rollup
  // infrastructure yet (sources, pass summary, build summary are all
  // Module A-specific today). Any future PublicationAiDebugPanel reads
  // from this endpoint.
  //
  // Read gate: same as ai-suggest (module B access).
  app.get('/:id/ai-debug-steps', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const pub = await app.prisma.publication.findUnique({
      where:  { id },
      select: { id: true, projectId: true, deletedAt: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })

    const steps = await app.prisma.aiDraftStep.findMany({
      where:   { documentId: id },
      orderBy: { timestamp: 'asc' },
      select:  { id: true, kind: true, message: true, sectionId: true, details: true, elapsedMs: true, timestamp: true },
      take:    500,
    })
    // BigInt id doesn't serialise through JSON.stringify — stringify
    // here so the client's useQuery can hold the shape without
    // wrestling with BigInt errors.
    return {
      publicationId: id,
      draftSteps:    steps.map(s => ({ ...s, id: String(s.id) })),
    }
  })
}
