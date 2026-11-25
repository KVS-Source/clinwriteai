// Auto-attach source PDFs for the Regulatory ai-suggest route (Package
// R-4, migration 105). Regulatory documents inherit their source PDFs
// from the parent submission's project-scoped DocumentUpload rows —
// same pattern Medical uses in content-sources.ts.
//
// Returns the attachment list + the upload ids for the audit trail.
// Soft-fails on DB / blob errors.

import type { FastifyBaseLogger } from 'fastify'
import type { PrismaClient } from '@prisma/client'

export interface AttachedDocument {
  mediaType: string
  data:      Buffer
  label?:    string
}

export interface BlobReader {
  get(bucket: string, key: string): Promise<{ body: Buffer } | Buffer | { body: Buffer; metadata?: unknown }>
}

export interface LoadRegulatoryDocumentSourcesOptions {
  maxDocs?:  number
  maxBytes?: number
}

/** Load project-scoped DocumentUpload PDFs for the regulatory document
 *  (via the document's projectId), filtered to application/pdf, capped
 *  at (maxDocs × maxBytes). Returns the attachment list + the ids of
 *  the uploads that made it into the set for audit. */
export async function loadRegulatoryDocumentSources(
  prisma: PrismaClient,
  blob:   BlobReader,
  regulatoryDocumentId: string,
  log: Pick<FastifyBaseLogger, 'warn'>,
  options: LoadRegulatoryDocumentSourcesOptions = {},
): Promise<{ documents: AttachedDocument[]; attachedUploadIds: string[] }> {
  const maxDocs  = options.maxDocs  ?? 3
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024
  const documents: AttachedDocument[] = []
  const attachedUploadIds: string[] = []
  try {
    const doc = await prisma.regulatoryDocument.findUnique({
      where:  { id: regulatoryDocumentId },
      select: { projectId: true },
    })
    if (!doc) return { documents, attachedUploadIds }

    const uploads = await prisma.documentUpload.findMany({
      where:   { projectId: doc.projectId },
      select:  { id: true, fileName: true, title: true, blobKey: true, contentType: true },
      orderBy: { createdAt: 'asc' },
    })
    if (uploads.length === 0) return { documents, attachedUploadIds }

    for (const u of uploads) {
      if (documents.length >= maxDocs) break
      if ((u.contentType ?? '').toLowerCase() !== 'application/pdf') continue
      try {
        const raw = await blob.get('documents', u.blobKey)
        const bytes = Buffer.isBuffer(raw) ? raw : (raw.body as Buffer)
        if (!Buffer.isBuffer(bytes)) {
          log.warn({ regulatoryDocumentId, uploadId: u.id }, 'reg ai-suggest: blob returned non-Buffer body — dropped')
          continue
        }
        if (bytes.length > maxBytes) {
          log.warn({ regulatoryDocumentId, uploadId: u.id, size: bytes.length }, 'reg ai-suggest: source exceeds cap — dropped')
          continue
        }
        documents.push({
          mediaType: 'application/pdf',
          data:      bytes,
          label:     u.title ?? u.fileName,
        })
        attachedUploadIds.push(u.id)
      } catch (err) {
        log.warn({ regulatoryDocumentId, uploadId: u.id, err: err instanceof Error ? err.message : String(err) }, 'reg ai-suggest: blob read failed — dropped')
      }
    }
  } catch (err) {
    log.warn({ regulatoryDocumentId, err: err instanceof Error ? err.message : String(err) }, 'reg ai-suggest: DocumentUpload lookup failed')
  }
  return { documents, attachedUploadIds }
}
