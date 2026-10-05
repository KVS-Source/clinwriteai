// BlobStorage — cloud-portable object storage interface (ADR 0007).
//
// Default impl is S3-compatible (works for MinIO on standalone and AWS S3
// on year-2 cloud migration). Year-2 Azure migration would add an
// AzureBlobStorage implementation; the interface stays identical so
// feature code (document upload, voice notes, exports) doesn't change.
//
// Model:
//   - Objects are keyed by `(bucket, key)`. Buckets map to env vars
//     (S3_DOCUMENTS_BUCKET, S3_VOICE_BUCKET, …) so the app code picks
//     a logical bucket name and the deployment maps it.
//   - Writes return the stored key + a sha256 for integrity.
//   - Reads produce either an in-memory Buffer (small files) OR a
//     presigned URL (large files; client fetches directly).
//
// Why presigned URLs for large payloads:
//   - Streaming >100MB through the API node is a waste of its CPU
//   - It couples API uptime to upload/download throughput
//   - Signed URLs scope access to a specific (bucket, key) + time window.

import type { Readable } from 'node:stream'

export type BlobBucket =
  | 'documents'       // Module A — document binaries (uploaded PDFs, docx)
  | 'voice'           // Module A — voice notes audio
  | 'exports'         // Module A/B/E — rendered PDFs, congress packages
  | 'ectd'            // Module D — eCTD submission packages

export interface PutObjectArgs {
  bucket: BlobBucket
  key: string                     // path within the bucket, e.g. 'proj-velora/doc-123/raw.pdf'
  body: Buffer | Uint8Array | Readable
  contentType: string
  metadata?: Record<string, string>
}

export interface PutObjectResult {
  bucket: BlobBucket
  key: string
  size: number
  etag: string                     // provider-returned ETag (usually sha256 for simple PUT)
}

export interface PresignedUrlOptions {
  /** How long the URL is valid for. Default 15min. */
  expiresInSeconds?: number
  /** Content-Type the client MUST set on the PUT request (upload presign only). */
  contentType?: string
}

export interface BlobStorage {
  /** Upload directly from the API node (small payloads). */
  put(args: PutObjectArgs): Promise<PutObjectResult>

  /** Fetch an object into memory (small payloads only). */
  get(bucket: BlobBucket, key: string): Promise<{ body: Buffer; contentType: string | null; size: number }>

  /** Remove an object. Returns true if deleted, false if not found. */
  del(bucket: BlobBucket, key: string): Promise<boolean>

  /**
   * Signed URL for the client to PUT directly to object storage.
   * Caller must set Content-Type on the subsequent PUT.
   */
  presignUpload(bucket: BlobBucket, key: string, opts?: PresignedUrlOptions): Promise<string>

  /** Signed URL for client-side GET (temporary read access). */
  presignDownload(bucket: BlobBucket, key: string, opts?: Pick<PresignedUrlOptions, 'expiresInSeconds'>): Promise<string>

  /** Teardown hook. */
  close(): Promise<void>
}
