// CSR / source-document indexer (Package RD-1).
//
// Closes the "CanonicalJsonEntry extractor is vendor-blocked" item
// from the Module D plan — turns out we can do it ourselves with a
// slim regex pass over the document's section bodies. No Claude call,
// no new dependency, deterministic.
//
// Given a RegulatorySubmission + one source Document (CSR, protocol,
// IB, SAP, etc.), the worker:
//   1. Loads the document's current version + all section_contents
//   2. Walks all section bodies and aggregates structural identifiers
//      (tables, sections, figures, study IDs, citation markers) via
//      a pure regex pass
//   3. Writes a single CanonicalJsonEntry row with content shaped
//      as { tables, sections, figures, studyIds, citations,
//      sectionCount, indexedFrom }
//
// The Regulatory ai-suggest's CSR grounding helper (Package R-4's
// buildRegulatoryAttachedContext) walks CanonicalJsonEntry rows for
// the submission and extracts identifiers for its allowedTokens list.
// Before this worker shipped the index was almost always empty →
// grounding was informational-only. Now it fires as a real hard-retry
// allow-list when the submission has indexed sources.
//
// Idempotency: each (submissionId, sourceDocId) pair uniquely
// identifies an entry; re-running the indexer deletes any prior
// entry for that pair first, then inserts the fresh one.
//
// The regex library below is a deliberate slim copy of the subset of
// apps/api/src/modules/clinical-writing/documents/must-preserve.ts we
// need here. The TS rootDir constraint prevents a cross-package
// import; promoting these ~40 lines to a shared package for a single
// consumer would be premature. If a second worker needs the same
// regex, extract then.

/* eslint-disable security/detect-non-literal-regexp */

import type { PrismaClient } from '@prisma/client'
import type { JobHandler } from './types.js'

interface IndexCsrSourcePayload {
  submissionId:   string
  sourceDocId:    string                   // source Document.id
  actorId:        string
}

interface Report {
  status:        'ok' | 'failed'
  reason?:       string
  sectionCount?: number
  identifiers?: {
    tables:    number
    sections:  number
    figures:   number
    studyIds:  number
    citations: number
  }
}

/** Shape stored in CanonicalJsonEntry.content. The Regulatory
 *  grounding helper walks this with walkContent() which recurses
 *  into arrays + strings — this shape works out of the box. */
interface CanonicalIndexContent {
  tables:       string[]
  sections:     string[]
  figures:      string[]
  studyIds:     string[]
  citations:    string[]
  sectionCount: number
  indexedFrom:  { documentId: string; documentType: string; versionNumber: string }
}

// ────────────────────────────────────────────────────────────────────────
// Slim regex library (see module doc comment above for rationale).

const CITATION_PATTERNS: readonly RegExp[] = [
  /\[cite:[a-zA-Z0-9_-]+\]/g,
  /\[Ref-[A-Za-z0-9]+\]/g,
  /\[[A-Z][a-zA-Z]+(?: et al\.?)?,? ?\d{4}[a-z]?\]/g,
  /\([A-Z][a-zA-Z]+(?: et al\.?)?,? ?\d{4}[a-z]?\)/g,
  /\[\d{1,3}(?:[,–—-]\s*\d{1,3})*\]/g,
]

const CROSS_REF_PATTERNS: readonly RegExp[] = [
  /§\s?\d+(?:\.\d+)*[a-z]?/g,
  /\bSection\s+\d+(?:\.\d+)*[a-z]?/g,
  /\b(?:Table|Figure|Appendix|Annex|Exhibit|Fig\.?)\s+[A-Z0-9]+(?:[.-][A-Z0-9]+)*/g,
  /\b(?:Attachment|Supplement|Addendum)\s+[A-Z0-9]+/g,
]

const STUDY_ID_PATTERNS: readonly RegExp[] = [
  /\bNCT\d{8}\b/g,
  /\bEudraCT\s+\d{4}-\d{6}-\d{2}\b/g,
  /\bEUDAMED\s+[A-Z0-9-]+/gi,
  /\bIND\s+\d+\b/g,
  /\bCTIS\s+\d+\b/g,
  /\b(?:ISRCTN|ChiCTR|UMIN|CTRI)\s?\d+\b/g,
  /\b(?:Protocol|Study)\s+(?:No\.?|Number|ID|#)\s?[A-Z0-9][A-Z0-9-]*\b/gi,
]

function htmlToText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/(li|h[1-6]|tr|td|th|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
}

function matchAll(text: string, patterns: readonly RegExp[], into: Set<string>): void {
  for (const re of patterns) {
    for (const m of text.matchAll(re)) into.add(m[0].trim())
  }
}

/** Partition the cross-ref bucket into tables / figures / sections by
 *  prefix. Matches how the Regulatory grounding helper looks for
 *  allowed tokens. */
function partitionCrossRef(ref: string, tables: Set<string>, figures: Set<string>, sections: Set<string>) {
  if (/^(Table|Appendix|Annex|Exhibit|Supplement|Addendum|Attachment)\b/i.test(ref)) tables.add(ref)
  else if (/^(Figure|Fig\.?)\b/i.test(ref))                                          figures.add(ref)
  else                                                                                sections.add(ref)
}

function indexSection(html: string, tables: Set<string>, figures: Set<string>, sections: Set<string>, studyIds: Set<string>, citations: Set<string>): void {
  const text = htmlToText(html)
  const refs = new Set<string>()
  matchAll(text, CROSS_REF_PATTERNS, refs)
  for (const r of refs) partitionCrossRef(r, tables, figures, sections)
  matchAll(text, STUDY_ID_PATTERNS,  studyIds)
  matchAll(text, CITATION_PATTERNS,  citations)
}

/** Resolve a stable sourceType for CanonicalJsonEntry from the
 *  source Document.type. Comment hints "csr|ib|sap|tlf|cmc|nonclin"
 *  on the schema — we pick the closest match. */
function docTypeToSourceType(docType: string): string {
  const t = docType.toLowerCase()
  if (t.includes('csr'))              return 'csr'
  if (t === 'ib' || t.includes('investigator_brochure') || t.includes('investigator-brochure')) return 'ib'
  if (t.includes('protocol'))         return 'protocol'
  if (t.includes('sap'))              return 'sap'
  if (t.includes('tlf'))              return 'tlf'
  if (t.includes('cmc'))              return 'cmc'
  if (t.includes('nonclin'))          return 'nonclin'
  return t
}

export const handleIndexCsrSource: JobHandler<IndexCsrSourcePayload, Report> = async (job, { prisma, log }) => {
  const { submissionId, sourceDocId, actorId } = job.data

  // 1. Resolve the source document + its current version.
  const doc = await (prisma as PrismaClient).document.findUnique({
    where:  { id: sourceDocId },
    select: { id: true, type: true, currentVersionId: true, deletedAt: true },
  })
  if (!doc) return { status: 'failed', reason: 'document_not_found' }
  if (doc.deletedAt) return { status: 'failed', reason: 'document_deleted' }
  if (!doc.currentVersionId) return { status: 'failed', reason: 'no_current_version' }

  const version = await (prisma as PrismaClient).documentVersion.findUnique({
    where:  { id: doc.currentVersionId },
    select: { id: true, versionNumber: true },
  })
  if (!version) return { status: 'failed', reason: 'version_missing' }

  // 2. Walk all section bodies and aggregate structural identifiers.
  const sections = await (prisma as PrismaClient).sectionContent.findMany({
    where:  { documentVersionId: version.id },
    select: { contentHtml: true },
  })

  const tables    = new Set<string>()
  const figures   = new Set<string>()
  const refs      = new Set<string>()
  const studyIds  = new Set<string>()
  const citations = new Set<string>()
  for (const s of sections) indexSection(s.contentHtml ?? '', tables, figures, refs, studyIds, citations)

  const content: CanonicalIndexContent = {
    tables:       [...tables],
    sections:     [...refs],
    figures:      [...figures],
    studyIds:     [...studyIds],
    citations:    [...citations],
    sectionCount: sections.length,
    indexedFrom:  {
      documentId:    doc.id,
      documentType:  doc.type,
      versionNumber: version.versionNumber,
    },
  }

  // 3. Write (replace any prior entry for this submissionId + sourceDocId).
  try {
    await (prisma as PrismaClient).$transaction([
      (prisma as PrismaClient).canonicalJsonEntry.deleteMany({
        where: { submissionId, sourceDocId },
      }),
      (prisma as PrismaClient).canonicalJsonEntry.create({
        data: {
          submissionId,
          sourceDocId,
          sourceType: docTypeToSourceType(doc.type),
          content:    content as unknown as object,
          version:    version.versionNumber,
        },
      }),
    ])
  } catch (err) {
    log.warn({ err, submissionId, sourceDocId }, 'index_csr_source: canonical entry write failed')
    return { status: 'failed', reason: 'write_failed' }
  }

  const identifiers = {
    tables:    content.tables.length,
    sections:  content.sections.length,
    figures:   content.figures.length,
    studyIds:  content.studyIds.length,
    citations: content.citations.length,
  }
  log.info({ submissionId, sourceDocId, actorId, sectionCount: sections.length, ...identifiers }, 'index_csr_source: indexed')
  return { status: 'ok', sectionCount: sections.length, identifiers }
}
