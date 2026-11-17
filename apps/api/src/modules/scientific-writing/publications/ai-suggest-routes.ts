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

    const section = await app.prisma.publicationSectionContent.findFirst({
      where:  { publicationVersionId: pub.currentVersionId, sectionId },
      select: { id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true },
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

    const composedPrompt = [
      scaffold,
      authorBlock,
      policyBlock ? `\n${policyBlock}\n` : '',
      '---',
      promptBody,
      textExcerpts.length > 0 ? `\n---\nAttachments metadata:\n${textExcerpts.join('\n')}` : '',
    ].filter(Boolean).join('\n')

    // Fire the Claude call.
    const model = parsed.data.model || undefined
    try {
      const result = await app.aiGateway.chat({
        tenantId:          request.user!.tenantId,
        projectId:         pub.projectId,
        actorId:           request.user!.id,
        module:            'B',
        intent:            parsed.data.intent,
        model:             model || 'claude-sonnet-4-5',
        prompt:            composedPrompt,
        maxOutputTokens:   parsed.data.intent === 'edit' ? 4096 : 2048,
        documents:         documentAttachments.length > 0 ? documentAttachments : undefined,
        documentId:        id,                     // reuse the field for publicationId — chat records are polymorphic by entityId
        sectionId:         section.sectionId,
        preCallSectionHtml: currentContent,
        promptText:        parsed.data.customPrompt ?? parsed.data.intent,
      })

      const responseText = parsed.data.intent === 'edit' ? stripCodeFence(result.responseText) : result.responseText

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
}
