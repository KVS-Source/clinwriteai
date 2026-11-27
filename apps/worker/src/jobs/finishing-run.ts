// Runs the code finishing (finishing.ts) on a drafted document once its checking passes are done: loads the
// document's plan, policy, template, sections and (for references) its sources, applies the result, and records it.
// Never fails the draft: anything that goes wrong is logged and the document stays as drafted.

import type { JobHandler } from './types.js'
import { createBlobReaderFromEnv } from '../blob-reader.js'
import { asBuildPlan } from './build-plan.js'
import { asFactSheet, indexSources, type IndexedSource } from './fact-sheet.js'
import { finishDocument, type FinishReport, type ReferenceStyle } from './finishing.js'
import { isExample, readSourceText, sourceKind } from './source-files.js'

type Ctx = Parameters<JobHandler>[1]
type Steps = { emit: (kind: 'prompt_assembled' | 'warning', message: string, opts?: { details?: Record<string, unknown> }) => Promise<void> }

const PLACEHOLDER = /\[\s*(?:TBD\b[^\]]*|TBC\b[^\]]*|X+|PLACEHOLDER|REF|INSERT\b[^\]]*|STUB_[^\]]*)\s*\]/gi

export async function runFinishing(
  ctx: Pick<Ctx, 'prisma' | 'log'>,
  args: { documentId: string; versionId: string; docType: string; actorId: string; steps: Steps },
): Promise<FinishReport | null> {
  const { prisma, log } = ctx
  const docType = args.docType.replace(/-/g, '_')
  const doc = await prisma.document.findUnique({ where: { id: args.documentId }, select: { policyVersionAtCreate: true, factSheet: true } })
  if (doc?.policyVersionAtCreate == null) return null
  const policy = await prisma.documentTypePolicy.findUnique({
    where: { docType_version: { docType, version: doc.policyVersionAtCreate } },
    select: { buildPlan: true, referenceStyle: true },
  })
  const plan = asBuildPlan(policy?.buildPlan ?? null)
  if (!plan?.finishing) return null

  const template = await prisma.documentTemplate.findFirst({
    where: { type: { in: [args.docType, docType, docType.replace(/_/g, '-')] }, isCurrent: true, retiredAt: null },
    select: { sections: true },
  })
  const templateSections = (Array.isArray(template?.sections) ? template!.sections : []) as Array<{ id: string; number: string; title: string }>
  const rows = await prisma.sectionContent.findMany({
    where: { documentVersionId: args.versionId },
    select: { id: true, sectionId: true, contentHtml: true, aiFlags: true },
  })
  const rowBySection = new Map(rows.map(r => [r.sectionId, r]))
  const sections = templateSections
    .filter(s => rowBySection.has(s.id))
    .map(s => ({ id: s.id, number: s.number, title: s.title, html: rowBySection.get(s.id)!.contentHtml ?? '' }))

  const sources = plan.finishing.references ? await loadIndexedSources(ctx, args.documentId) : []

  const result = finishDocument({
    sections,
    sources,
    referenceStyle: (policy?.referenceStyle === 'author_year' ? 'author_year' : 'numbered') as ReferenceStyle,
    factSheet: asFactSheet(doc.factSheet),
    builtByCode: plan.builtByCode,
    options: plan.finishing,
  })

  const changed = new Set([...result.html.keys(), ...result.flags.keys()])
  if (changed.size > 0) {
    await prisma.$transaction(async (tx) => {
      for (const sectionId of changed) {
        const row = rowBySection.get(sectionId)!
        const html = result.html.get(sectionId)
        const flags = [...new Set([...(row.aiFlags ?? []), ...(result.flags.get(sectionId) ?? [])])]
        await tx.sectionContent.update({
          where: { id: row.id },
          data: {
            aiFlags: flags,
            ...(html !== undefined ? {
              contentHtml: html,
              wordCount: html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
              ichStatus: (html.replace(/<[^>]*>/g, ' ').match(PLACEHOLDER) ?? []).length > 0 ? 'in_progress' : 'complete',
              lastEditedBy: args.actorId,
              lastEditedAt: new Date(),
            } : {}),
          },
        })
        if (html !== undefined) {
          await tx.editHistory.create({
            data: {
              entityType: 'clinical_section', entityId: args.documentId, subUnitId: sectionId, actorId: args.actorId, origin: 'ai',
              beforeHtml: null, afterHtml: html, documentId: args.documentId, sectionId, documentVersionId: args.versionId,
            },
          })
        }
      }
    })
  }

  const r = result.report
  const problems = r.crossReferences.broken.length + r.references.notFound.length + r.abbreviations.undefined.length + r.mismatches.length
  log.info({ documentId: args.documentId, changed: result.html.size, problems }, 'finishing: done')
  await args.steps.emit(problems ? 'warning' : 'prompt_assembled',
    `Finished by code: ${r.crossReferences.resolved} cross-reference${r.crossReferences.resolved === 1 ? '' : 's'} resolved`
    + `, ${r.references.listed} reference${r.references.listed === 1 ? '' : 's'} listed from ${r.references.cited} citation${r.references.cited === 1 ? '' : 's'}`
    + `, ${r.abbreviations.defined} abbreviation${r.abbreviations.defined === 1 ? '' : 's'} defined`
    + (r.abbreviations.fromGlossary.length ? ` (${r.abbreviations.fromGlossary.length} spelled out from the standard glossary)` : '')
    + (problems
      ? `. To check: ${[
        r.crossReferences.broken.length && `${r.crossReferences.broken.length} broken cross-reference(s)`,
        r.references.notFound.length && `${r.references.notFound.length} reference(s) not found in the evidence`,
        r.abbreviations.undefined.length && `${r.abbreviations.undefined.length} undefined abbreviation(s) (${r.abbreviations.undefined.slice(0, 8).map(u => u.acronym).join(', ')})`,
        r.mismatches.length && `${r.mismatches.length} value(s) that differ from the fact sheet`,
      ].filter(Boolean).join(', ')}. The sections are flagged.`
      : '. Nothing to check.'),
    { details: { finishing: r } })
  return r
}

/** runFinishing that never throws: a failure is logged and the document stays as drafted, markers and all. */
export async function finishSafely(ctx: Pick<Ctx, 'prisma' | 'log'>, args: Parameters<typeof runFinishing>[1]): Promise<void> {
  try {
    await runFinishing(ctx, args)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.log.warn({ documentId: args.documentId, err: message }, 'finishing failed — document left as drafted')
    await args.steps.emit('warning', `Finishing by code failed (${message.slice(0, 200)}). Cross-references and references are left as markers.`).catch(() => undefined)
  }
}

async function loadIndexedSources(ctx: Pick<Ctx, 'prisma' | 'log'>, documentId: string): Promise<IndexedSource[]> {
  const links = await ctx.prisma.documentSource.findMany({ where: { documentId }, select: { uploadId: true, role: true } })
  if (links.length === 0) return []
  const uploads = await ctx.prisma.documentUpload.findMany({
    where: { id: { in: links.map(l => l.uploadId) } },
    select: { id: true, title: true, fileName: true, blobKey: true, contentType: true },
  })
  const reader = createBlobReaderFromEnv()
  const files: Array<{ id: string; title: string; bytes: Buffer; text?: string; example: boolean }> = []
  for (const u of uploads) {
    const kind = sourceKind(u.fileName, u.contentType)
    if (kind === 'other') continue
    try {
      const { bytes } = await reader.read('documents', u.blobKey)
      files.push({
        id: u.id, title: u.title ?? u.fileName, bytes,
        text: kind === 'pdf' ? undefined : await readSourceText(bytes, kind),
        example: isExample(links.find(l => l.uploadId === u.id)?.role),
      })
    } catch (err) {
      ctx.log.warn({ uploadId: u.id, err: err instanceof Error ? err.message : String(err) }, 'finishing: could not read a source')
    }
  }
  return indexSources(files)
}
