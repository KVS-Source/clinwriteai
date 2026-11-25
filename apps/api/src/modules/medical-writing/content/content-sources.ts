// Load source documents attached to a MedContentItem as PDF blobs for
// the Claude call. Used by the ai-suggest route (Package C-4) so the
// "Rewrite" path has the same source grounding the initial-draft worker
// does. Mirrors the auto-attach pattern Clinical uses for
// SourceReference / Publication uses for Publication.sourceDocumentId.
//
// Shape is the SAME the aiGateway.chat accepts as its `documents` param:
// `{ mediaType, data, label }[]`. Caller passes it through directly.

import type { FastifyBaseLogger } from 'fastify'
import type { PrismaClient } from '@prisma/client'

export interface AttachedDocument {
  mediaType: string
  data:      Buffer
  label?:    string
}

/** The subset of app.blob the loader needs. Matches the shape the
 *  Clinical ai-suggest route uses (`app.blob.get(bucket, key)`). */
export interface BlobReader {
  get(bucket: string, key: string): Promise<{ body: Buffer } | Buffer | { body: Buffer; metadata?: unknown }>
}

export interface LoadMedContentDocumentsOptions {
  /** Hard cap on how many PDFs are attached. Default 3 — mirrors the
   *  Clinical ai-suggest cap; keeps token footprint bounded on a
   *  synchronous user-facing call. */
  maxDocs?:  number
  /** Per-file cap. Default 25 MB — matches the Clinical ai-suggest
   *  attachment limit. Larger files are dropped (logged) rather than
   *  truncated to avoid shipping a partial PDF to the model. */
  maxBytes?: number
}

/** Load ContentUpload PDFs for a MedContentItem, filtered to
 *  application/pdf + size-capped, ready to attach to the aiGateway.chat
 *  call. Returns the list + the ids of the uploads that made it into
 *  the attachment set (for audit). Soft failure — missing table /
 *  blob read error returns an empty list, doesn't throw. */
export async function loadMedContentDocuments(
  prisma: PrismaClient,
  blob:   BlobReader,
  contentItemId: string,
  log: Pick<FastifyBaseLogger, 'warn'>,
  options: LoadMedContentDocumentsOptions = {},
): Promise<{ documents: AttachedDocument[]; attachedUploadIds: string[] }> {
  const maxDocs  = options.maxDocs  ?? 3
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024
  const documents: AttachedDocument[] = []
  const attachedUploadIds: string[] = []
  try {
    const uploads = await prisma.contentUpload.findMany({
      where:   { contentItemId },
      select:  { id: true, fileName: true, blobKey: true, contentType: true },
      orderBy: { createdAt: 'asc' },
    })
    if (uploads.length === 0) return { documents, attachedUploadIds }

    for (const u of uploads) {
      if (documents.length >= maxDocs) break
      if ((u.contentType ?? '').toLowerCase() !== 'application/pdf') continue
      try {
        const raw = await blob.get('documents', u.blobKey)
        // app.blob.get returns either a Buffer or { body: Buffer }; handle both.
        const bytes = Buffer.isBuffer(raw)
          ? raw
          : (raw.body as Buffer)
        if (!Buffer.isBuffer(bytes)) {
          log.warn({ contentItemId, uploadId: u.id }, 'med ai-suggest: blob returned non-Buffer body — dropped')
          continue
        }
        if (bytes.length > maxBytes) {
          log.warn({ contentItemId, uploadId: u.id, size: bytes.length }, 'med ai-suggest: source exceeds cap — dropped')
          continue
        }
        documents.push({
          mediaType: 'application/pdf',
          data:      bytes,
          label:     u.fileName,
        })
        attachedUploadIds.push(u.id)
      } catch (err) {
        log.warn({ contentItemId, uploadId: u.id, err: err instanceof Error ? err.message : String(err) }, 'med ai-suggest: blob read failed — dropped')
      }
    }
  } catch (err) {
    log.warn({ contentItemId, err: err instanceof Error ? err.message : String(err) }, 'med ai-suggest: ContentUpload lookup failed')
  }
  return { documents, attachedUploadIds }
}
