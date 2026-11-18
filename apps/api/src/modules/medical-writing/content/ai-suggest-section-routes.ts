// Phase M-C.4 — med content section AI-suggest endpoint.
// Mirror of publications /ai-suggest scoped to MedContentSection rows.
//
// Sits alongside the existing content-level /ai-suggest (which takes a
// contentId and returns a general suggestion). This new one is
// section-scoped and composes the Claude call from grounding rules +
// policy + attached source PDFs, like Modules A + B.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { requireAuth } from '../../../auth/rbac.js'
import {
  resolveForMedContent,
  renderMedPolicyPromptBlock,
  SECTION_GROUNDING_RULES,
} from '../policy/resolve.js'

const writeGate = requireAuth({ modules: ['C'] })

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

export const medContentAiSuggestSectionRoutes: FastifyPluginAsync = async (app) => {
  // Different path from the existing content-level /ai-suggest: this one
  // is section-scoped. The content-level endpoint stays untouched.
  app.post('/:id/sections/:sectionId/ai-suggest', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const parsed = aiSuggestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({
      where: { id },
      select: {
        id: true, projectId: true, type: true, complianceTrack: true, archivedAt: true,
        aiInstructions: true, currentVersionId: true,
        medContentTypePolicyVersionAtCreate:   true,
        medContentAiPromptRecordId:            true,
        medContentBestPracticeRecordId:        true,
      },
    })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })
    if (!item.currentVersionId) return reply.code(409).send({ error: 'no_current_version' })

    const section = await app.prisma.medContentSection.findFirst({
      where:  { medContentVersionId: item.currentVersionId, sectionId },
      select: { id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true },
    })
    if (!section) return reply.code(404).send({ error: 'section_not_found' })

    const sectionHeader = `§${section.sectionNumber} ${section.sectionTitle}`
    const currentContent = (parsed.data.intent === 'edit' ? parsed.data.currentContent : undefined)
      ?? section.contentHtml ?? ''

    const docType = item.type.toLowerCase().replace(/-/g, '_')
    const policy = await resolveForMedContent(app.prisma, {
      docType,
      medContentTypePolicyVersionAtCreate:  item.medContentTypePolicyVersionAtCreate,
      medContentAiPromptRecordId:           item.medContentAiPromptRecordId,
      medContentBestPracticeRecordId:       item.medContentBestPracticeRecordId,
    }).catch(err => {
      request.log.warn({ err, contentId: id }, 'med ai-suggest: policy resolve failed — continuing with no-policy block')
      return null
    })
    const policyBlock = renderMedPolicyPromptBlock(policy, section.sectionId)

    // --- Source auto-attach ------------------------------------------------
    // ContentUpload rows scoped to this content item are the primary
    // references. Always attached regardless of Scope toggle.
    const explicitAttachedIds = parsed.data.attachedSourceIds ?? []
    let autoAttachedUploadIds: string[] = []
    try {
      const uploads = await app.prisma.contentUpload.findMany({
        where:  { contentItemId: id },
        select: { id: true },
      })
      autoAttachedUploadIds = uploads.map(u => u.id)
    } catch (err) {
      request.log.warn({ err, contentId: id }, 'med ai-suggest: ContentUpload lookup failed')
    }
    const effectiveAttachedIds = Array.from(new Set([...explicitAttachedIds, ...autoAttachedUploadIds]))

    const MAX_PDF_DOCS = 3
    const MAX_PDF_BYTES = 25 * 1024 * 1024
    const documentAttachments: Array<{ mediaType: string; data: Buffer; label?: string }> = []
    const textExcerpts: string[] = []
    const scope = effectiveAttachedIds.length > 0 ? 'source' : (parsed.data.scope ?? 'section')
    if (scope === 'source' && effectiveAttachedIds.length > 0) {
      try {
        const uploads = await app.prisma.contentUpload.findMany({
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
            request.log.warn({ err, uploadId: u.id }, 'med ai-suggest: blob read failed')
          }
        }
      } catch (err) {
        request.log.warn({ err }, 'med ai-suggest: source upload fetch failed')
      }
    }

    // Build the intent-templated prompt.
    let promptBody: string
    switch (parsed.data.intent) {
      case 'draft_from_source':
        promptBody = `You are drafting the "${sectionHeader}" section of a medical-communications deliverable (${docType}). Draft the section body using the attached source documents. Preserve numeric values and reference markers verbatim.`
        break
      case 'tighten':
        promptBody = `Rewrite the following section for clarity and concision. Preserve every data point and reference marker. Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}`
        break
      case 'explain':
        promptBody = `Rewrite the following section in plain English for a lay audience. Keep all numeric values and reference markers. Section: ${sectionHeader}\n\nContent:\n${currentContent}`
        break
      case 'custom':
        promptBody = `Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}\n\nUser request:\n${parsed.data.customPrompt ?? ''}`
        break
      case 'edit':
        if (parsed.data.selectionText && parsed.data.selectionText.trim().length > 0) {
          promptBody = [
            `You are editing a highlighted passage inside the "${sectionHeader}" section of a medical content item (${docType}).`,
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
            `You are editing the "${sectionHeader}" section of a medical content item (${docType}).`,
            `Apply the instruction below and return the COMPLETE revised section.`,
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

    const authorBlock = item.aiInstructions?.trim()
      ? [``, `Author's instructions (follow in addition to the rules above):`, item.aiInstructions.trim(), ``].join('\n')
      : ''

    const scaffold = [
      `You are revising a single section of a medical-communications deliverable (${docType}).`,
      `Section id: ${section.sectionId} · number ${section.sectionNumber} · title ${section.sectionTitle}.`,
      '',
      SECTION_GROUNDING_RULES,
    ].join('\n')

    const composedPrompt = [
      scaffold,
      authorBlock,
      policyBlock ? `\n${policyBlock}\n` : '',
      '---',
      promptBody,
      textExcerpts.length > 0 ? `\n---\nAttachments metadata:\n${textExcerpts.join('\n')}` : '',
    ].filter(Boolean).join('\n')

    try {
      const result = await app.aiGateway.chat({
        tenantId:          request.user!.tenantId,
        projectId:         item.projectId,
        actorId:           request.user!.id,
        module:            'C',
        intent:            parsed.data.intent,
        model:             parsed.data.model || 'claude-sonnet-4-5',
        prompt:            composedPrompt,
        maxOutputTokens:   parsed.data.intent === 'edit' ? 4096 : 2048,
        documents:         documentAttachments.length > 0 ? documentAttachments : undefined,
        documentId:        id,                     // reuse the field for contentItemId
        sectionId:         section.sectionId,
        preCallSectionHtml: currentContent,
        promptText:        parsed.data.customPrompt ?? parsed.data.intent,
      })

      const responseText = parsed.data.intent === 'edit' ? stripCodeFence(result.responseText) : result.responseText

      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_ai_suggestion_requested',
        entityType: 'med_content_item',
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
          complianceTrackUsed:   policy?.complianceTrack ?? item.complianceTrack ?? null,
          autoAttachedSources:   autoAttachedUploadIds.length,
          explicitAttachedSources: explicitAttachedIds.length,
          outcome:               'completed',
        },
        ipAddress: request.ip ?? null,
      }).catch(err => request.log.error({ err }, 'med_content_ai_suggestion_requested audit failed'))

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
