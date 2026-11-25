// Slide-level AI rewrite endpoint for HCP decks (migration 105 Package C-7).
//
// POST /med-content/:id/slides/:slideId/ai-suggest
//
// Wraps the shared callWithValidation retry wrapper around a single-
// slide rewrite. Slide content lives in MedSlide rows (not
// MedContentSection), so the section-level ai-suggest route can't
// reach them. This endpoint fills the gap.
//
// Shape of the request/response mirrors Module C section ai-suggest —
// intent + currentContent + prompt. On success, writes the new
// bodyHtml + aiModel + aiGeneratedAt + aiPrompt onto the MedSlide row.
//
// Scope note: per-slide aiConfidence + aiFlags columns don't exist on
// MedSlide today. Validator results land in the audit chain + the
// ai_draft_steps timeline (keyed by contentId) instead. Adding those
// columns is a separate schema change out of this plan's scope.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { requireAuth } from '../../../auth/rbac.js'
import { chooseModel } from '../../platform/config/ai-engine-settings.js'
import {
  extractManifest,
  renderForPrompt as renderMustPreserve,
} from '../../clinical-writing/documents/must-preserve.js'
import {
  callWithValidation,
  type StepEmitter,
} from '../../clinical-writing/documents/ai-suggest-retry.js'
import { scoreSection } from '../../clinical-writing/documents/ai-confidence.js'
import {
  resolveForMedContent,
  renderMedPolicyPromptBlock,
  SECTION_GROUNDING_RULES,
} from '../policy/resolve.js'
import { loadMedContentDocuments, type BlobReader } from './content-sources.js'

const slideSuggestSchema = z.object({
  prompt:         z.string().min(1).max(2_000).optional(),
  currentContent: z.string().max(200_000).optional(),
})

function stripCodeFence(text: string): string {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return (m ? m[1]! : text).trim()
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export const medSlideAiSuggestRoutes: FastifyPluginAsync = async (app) => {
  const writeGate = requireAuth({ modules: ['C'] })

  app.post('/:id/slides/:slideId/ai-suggest', { preHandler: writeGate }, async (request, reply) => {
    const { id: contentId, slideId } = request.params as { id: string; slideId: string }
    const parsed = slideSuggestSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({
      where:  { id: contentId },
      select: {
        id: true, projectId: true, type: true, aiInstructions: true, currentVersionId: true,
        medContentTypePolicyVersionAtCreate:   true,
        medContentAiPromptRecordId:            true,
        medContentBestPracticeRecordId:        true,
      },
    })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    // Resolve the slide via deck → must belong to this content item.
    const slide = await app.prisma.medSlide.findUnique({
      where:   { id: slideId },
      select:  {
        id: true, position: true, title: true, bodyHtml: true, speakerNotes: true,
        deckJob: { select: { id: true, contentItemId: true } },
      },
    })
    if (!slide || slide.deckJob.contentItemId !== contentId) {
      return reply.code(404).send({ error: 'slide_not_found' })
    }

    const instruction  = (parsed.data.prompt ?? '').trim() || 'Rewrite this slide for clarity. Preserve every data point and citation.'
    const currentBody  = (parsed.data.currentContent ?? slide.bodyHtml ?? '').trim()
    const sectionIdForLog = `slide_${slide.position}`

    // Policy + guideline framing (same resolver the initial-draft worker uses).
    const policy = await resolveForMedContent(app.prisma, {
      docType:                              item.type,
      medContentTypePolicyVersionAtCreate:  item.medContentTypePolicyVersionAtCreate,
      medContentAiPromptRecordId:           item.medContentAiPromptRecordId,
      medContentBestPracticeRecordId:       item.medContentBestPracticeRecordId,
    }).catch((err: unknown) => {
      request.log.warn({ err, contentId, slideId }, 'med slide ai-suggest: policy resolve failed — continuing with no-policy block')
      return null
    })
    const policyBlock = renderMedPolicyPromptBlock(policy, sectionIdForLog)

    // Pre-call manifest.
    const manifestBefore    = extractManifest(currentBody)
    const mustPreserveBlock = renderMustPreserve(manifestBefore)

    // Auto-attach ContentUploads (same helper the section route uses).
    const { documents: attachedDocs, attachedUploadIds } = await loadMedContentDocuments(
      app.prisma, app.blob as unknown as BlobReader, contentId, app.log,
    )

    const systemPrompt = [
      `You are rewriting a single slide of a Medical Writing deliverable (${item.type}).`,
      `Slide ${slide.position}: "${slide.title}".`,
      ``,
      SECTION_GROUNDING_RULES,
      policyBlock ? `\n${policyBlock}\n` : '',
      mustPreserveBlock,
      ``,
      `Return clean HTML for the slide body ONLY (no speaker notes, no headings, no title — just the body paragraphs / lists / tables).`,
      `Return only HTML using these tags: p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td. No attributes, no explanations, no code fences.`,
      `Do not invent data, numbers, dates, names or references. Insert [TBD: what is needed] for gaps.`,
    ].filter(Boolean).join('\n')

    const userPrompt = [
      `Instruction: ${instruction}`,
      '',
      `Current slide body:\n${currentBody || '(empty)'}`,
    ].join('\n')

    const basePrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`

    try {
      const model = await chooseModel(app.prisma)

      // Step-log emitter — writes to ai_draft_steps keyed by contentId
      // so the existing timeline picks up slide rewrites too.
      const stepsEmitter: StepEmitter = {
        async emit(kind, message, opts) {
          await app.prisma.aiDraftStep.create({
            data: {
              documentId: contentId,
              versionId:  item.currentVersionId ?? null,
              kind,
              message:    message.slice(0, 1_000),
              sectionId:  opts?.sectionId ?? sectionIdForLog,
              details:    (opts?.details ?? {}) as unknown as object,
              elapsedMs:  0,
            },
          })
        },
      }

      let lastGatewayResult: Awaited<ReturnType<typeof app.aiGateway.chat>> | null = null
      const validation = await callWithValidation({
        manifestBefore,
        attachedSources: {},
        steps:     stepsEmitter,
        sectionId: sectionIdForLog,
        call: async ({ prependPrompt }) => {
          const effectivePrompt = prependPrompt
            ? `${prependPrompt}\n\n----\n\n${basePrompt}`
            : basePrompt
          const r = await app.aiGateway.chat({
            tenantId:         request.user!.tenantId,
            projectId:        item.projectId ?? 'unknown',
            actorId:          request.user!.id,
            module:           'C',
            intent:           'slide_suggest',
            model,
            prompt:           effectivePrompt,
            maxOutputTokens:  1_500,
            documents:        attachedDocs.length > 0 ? attachedDocs : undefined,
          })
          lastGatewayResult = r
          return { html: stripCodeFence(r.responseText) }
        },
      })
      const result = lastGatewayResult!

      // Persist the new slide body + AI provenance + confidence score
      // (migration 106 added aiConfidence + aiFlags to MedSlide, so the
      // slide-level badge now reflects the retry outcome just like
      // MedContentSection does for section-level rewrites).
      try {
        const score = scoreSection(validation.flags)
        await app.prisma.medSlide.update({
          where: { id: slideId },
          data:  {
            bodyHtml:      validation.html,
            aiGenerated:   true,
            aiModel:       result.model,
            aiGeneratedAt: new Date(),
            aiPrompt:      parsed.data.prompt ?? instruction,
            aiConfidence:  score,
            aiFlags:       validation.flags,
          },
        })
      } catch (err) {
        app.log.warn({ err, contentId, slideId }, 'med slide update failed (non-fatal)')
      }

      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_slide_ai_suggest_generated',
        entityType: 'med_slide',
        entityId:   slideId,
        details: {
          contentItemId:         contentId,
          deckJobId:             slide.deckJob.id,
          slidePosition:         slide.position,
          model:                 result.model,
          aiCallRecordId:        result.recordId,
          promptSha256:          sha256(basePrompt),
          autoAttachedUploadIds: attachedUploadIds,
          documentCount:         attachedDocs.length,
          validatorFlags:        validation.flags,
          validatorRetried:      validation.retried,
          validatorTrace:        validation.trace.map(t => ({
            attempt: t.attempt,
            flags:   t.flags.map(f => ({ code: f.code, severity: f.severity })),
            retriedBecause: t.retriedBecause,
          })),
        },
        ipAddress: request.ip ?? null,
      }).catch(err => request.log.error({ err }, 'med_slide_ai_suggest_generated audit failed'))

      return {
        responseText: validation.html,
        aiModel:      result.model,
        recordId:     result.recordId,
        generatedAt:  new Date().toISOString(),
        flags:        validation.flags,
        retried:      validation.retried,
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'RateLimitedError') {
        return reply.code(429).send({ error: 'quota_reached', message: err.message })
      }
      throw err
    }
  })
}
