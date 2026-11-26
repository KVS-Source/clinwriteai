// The New Document source check: before a document is created and drafted, are the chosen source files fit to
// draft from? It runs in the wizard (POST …/documents/source-check) and again when the document is created with AI
// drafting, so a draft never starts from sources that would leave it wrong or empty without anyone being told.
//
// Each source is linked as
//   evidence — this study's own material; facts may come from it;
//   example  — a sample, template or another study's document; used for structure and wording only.
//
// Blocking (the document can't be created for AI drafting until fixed):
//   - a file the AI can't read (damaged, password-protected, PowerPoint / Excel / image, too many scanned pages);
//   - sources chosen, but none of them is evidence.
// Everything else is a warning: the writer may go ahead, and whatever the sources don't hold is drafted as [TBD].

import type { FastifyInstance } from 'fastify'
import { SOURCE_CATEGORY_LABEL, type SourceCategory } from './source-categories.js'
import { inspectSource, type SourceInspection } from './source-inspect.js'
import type { SourceStudy } from './source-classifier.js'

export const SOURCE_ROLES = ['evidence', 'example'] as const
export type SourceRole = (typeof SOURCE_ROLES)[number]

/** What the upload-time checks found about one file (from its `classification` JSON); null for a file uploaded before them. */
export interface SourceFileCheck {
  usable:           boolean | null
  problem:          string | null
  scannedPages:     number | null
  looksLikeExample: boolean
  exampleReason:    string | null
  study:            SourceStudy | null
  duplicateOf:      { id: string; title: string } | null
}

export function fileCheckOf(classification: unknown): SourceFileCheck | null {
  const c = (classification && typeof classification === 'object' ? classification : {}) as Record<string, unknown>
  const inspection = c.inspection as SourceInspection | undefined
  if (!inspection && c.looksLikeExample === undefined) return null
  const study = c.study as SourceStudy | undefined
  return {
    usable:           inspection ? inspection.usable : null,
    problem:          inspection?.problem ?? null,
    scannedPages:     inspection?.scannedPages ?? null,
    looksLikeExample: c.looksLikeExample === true,
    exampleReason:    typeof c.exampleReason === 'string' ? c.exampleReason : null,
    study:            study ?? null,
    duplicateOf:      (c.duplicateOf as SourceFileCheck['duplicateOf']) ?? null,
  }
}

export interface CheckedSource {
  id:         string
  title:      string
  category:   string | null
  version:    string | null
  role:       SourceRole
  inspection: SourceInspection
  looksLikeExample: boolean
  exampleReason:    string | null
  study:      SourceStudy | null
}

export type SourceIssueCode =
  | 'unreadable'
  | 'no_evidence'
  | 'looks_like_example'
  | 'different_studies'
  | 'several_versions'
  | 'duplicate'
  | 'scanned_pages'
  | 'missing_protocol_input'
  | 'missing_ib'

export interface SourceIssue {
  code:      SourceIssueCode
  severity:  'block' | 'warn'
  message:   string
  uploadIds: string[]
}

export interface SourceCheckResult {
  ok:     boolean
  issues: SourceIssue[]
}

// Kinds of document a study has one current version of; two evidence files of one kind usually means an old one
// was left in.
const SINGLE_VERSION_KINDS = new Set(['protocol', 'ib', 'sap', 'icf'])

const label = (category: string | null) => SOURCE_CATEGORY_LABEL[(category ?? 'other') as SourceCategory] ?? category ?? 'Other'
const names = (files: CheckedSource[]) => files.map(f => `“${f.title}”`).join(', ')
const norm = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function checkSources(docType: string, files: CheckedSource[]): SourceCheckResult {
  const issues: SourceIssue[] = []
  const evidence = files.filter(f => f.role === 'evidence')

  for (const f of files.filter(f => !f.inspection.usable)) {
    issues.push({
      code: 'unreadable', severity: 'block', uploadIds: [f.id],
      message: `“${f.title}” can’t be read by the AI: ${f.inspection.problem ?? 'unknown reason'} Remove it from the list.`,
    })
  }
  if (files.length > 0 && evidence.length === 0) {
    issues.push({
      code: 'no_evidence', severity: 'block', uploadIds: [],
      message: 'Every source is marked as an example, so the AI would have no facts about this study to draft from. Mark this study’s own documents as evidence.',
    })
  }

  for (const f of evidence.filter(f => f.looksLikeExample)) {
    issues.push({
      code: 'looks_like_example', severity: 'warn', uploadIds: [f.id],
      message: `“${f.title}” looks like a sample or template${f.exampleReason ? ` (${f.exampleReason.replace(/\.$/, '')})` : ''}. If it is not this study’s document, mark it as an example so its details are not used as facts.`,
    })
  }

  // Evidence files that name different studies: likely one belongs to another study.
  for (const field of ['protocolNumber', 'drug'] as const) {
    const groups = new Map<string, CheckedSource[]>()
    for (const f of evidence) {
      const v = norm(f.study?.[field])
      if (v) groups.set(v, [...(groups.get(v) ?? []), f])
    }
    if (groups.size > 1) {
      const what = field === 'protocolNumber' ? 'study numbers' : 'drugs'
      const parts = [...groups.values()].map(g => `${g[0]!.study![field]} in ${names(g)}`)
      issues.push({
        code: 'different_studies', severity: 'warn', uploadIds: [...groups.values()].flat().map(f => f.id),
        message: `The evidence files name different ${what}: ${parts.join('; ')}. Mark the files from other studies as examples.`,
      })
    }
  }

  const byKind = new Map<string, CheckedSource[]>()
  for (const f of evidence) {
    if (f.category && SINGLE_VERSION_KINDS.has(f.category)) byKind.set(f.category, [...(byKind.get(f.category) ?? []), f])
  }
  for (const [kind, group] of byKind) {
    if (group.length < 2) continue
    issues.push({
      code: 'several_versions', severity: 'warn', uploadIds: group.map(f => f.id),
      message: `${group.length} evidence files are a ${label(kind)}: ${group.map(f => `“${f.title}”${f.version ? ` (${f.version})` : ''}`).join(', ')}. If they are versions of one document, keep only the current one, or the AI may mix old and new details.`,
    })
  }

  const bySha = new Map<string, CheckedSource[]>()
  for (const f of files) bySha.set(f.inspection.sha256, [...(bySha.get(f.inspection.sha256) ?? []), f])
  for (const group of bySha.values()) {
    if (group.length < 2) continue
    issues.push({
      code: 'duplicate', severity: 'warn', uploadIds: group.map(f => f.id),
      message: `${names(group)} are the same file. Keep one.`,
    })
  }

  for (const f of files.filter(f => f.inspection.usable && (f.inspection.scannedPages ?? 0) > 0)) {
    issues.push({
      code: 'scanned_pages', severity: 'warn', uploadIds: [f.id],
      message: `“${f.title}”: ${f.inspection.problem}`,
    })
  }

  // What a protocol is drafted from. Without it the sections that need it come out as [TBD].
  if (docType.replace(/-/g, '_') === 'protocol' && evidence.length > 0) {
    if (!evidence.some(f => f.category === 'protocol')) {
      issues.push({
        code: 'missing_protocol_input', severity: 'warn', uploadIds: [],
        message: 'No evidence file is a protocol, synopsis or concept for this study, so its design, population, treatment and endpoints will mostly be [TBD].',
      })
    }
    if (!evidence.some(f => f.category === 'ib')) {
      issues.push({
        code: 'missing_ib', severity: 'warn', uploadIds: [],
        message: 'No Investigator’s Brochure is marked as evidence, so the background, rationale and benefit/risk sections will mostly be [TBD].',
      })
    }
  }

  return { ok: !issues.some(i => i.severity === 'block'), issues }
}

/**
 * Loads the chosen uploads, inspects any file not inspected yet (and keeps the result on the upload), and runs the
 * check. Uploads not in this project or not saved to the library are reported as unknown ids.
 */
export async function runSourceCheck(
  app: FastifyInstance,
  args: { projectId: string; docType: string; sources: Array<{ uploadId: string; role: SourceRole }> },
): Promise<SourceCheckResult & { unknownIds: string[] }> {
  const ids = args.sources.map(s => s.uploadId)
  const uploads = ids.length
    ? await app.prisma.documentUpload.findMany({ where: { id: { in: ids }, projectId: args.projectId, status: 'confirmed' } })
    : []
  const byId = new Map(uploads.map(u => [u.id, u]))
  const unknownIds = ids.filter(id => !byId.has(id))

  const files: CheckedSource[] = []
  for (const s of args.sources) {
    const u = byId.get(s.uploadId)
    if (!u) continue
    const c = (u.classification && typeof u.classification === 'object' ? u.classification : {}) as Record<string, unknown>
    let inspection = c.inspection as SourceInspection | undefined
    if (!inspection) {
      try {
        const { body } = await app.blob.get('documents', u.blobKey)
        inspection = await inspectSource(body, u.fileName, u.contentType)
        // Kept so the next check doesn't read the file again. Derived from the file itself, so not audited.
        await app.prisma.documentUpload.update({ where: { id: u.id }, data: { classification: { ...c, inspection } as object } })
      } catch (err) {
        app.log.warn({ err, uploadId: u.id }, 'source check: could not read the file')
        inspection = { sha256: `unread-${u.id}`, kind: 'other', pages: null, scannedPages: null, chars: 0, usable: false, problem: 'The file could not be read from storage.' }
      }
    }
    files.push({
      id: u.id,
      title: u.title ?? u.fileName,
      category: u.sourceCategory,
      version: u.version,
      role: s.role,
      inspection,
      looksLikeExample: c.looksLikeExample === true,
      exampleReason: typeof c.exampleReason === 'string' ? c.exampleReason : null,
      study: (c.study as SourceStudy | undefined) ?? null,
    })
  }
  return { ...checkSources(args.docType, files), unknownIds }
}
