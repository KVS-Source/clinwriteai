// Minimal blob reader for the worker — read-only access to the same object
// store the API writes to. Mirrors the provider selection in
// apps/api/src/modules/platform/blob/plugin.ts (local in dev, S3 in prod)
// but implements ONLY get-bytes. The worker never writes blobs today.
//
// The full BlobStorage interface (apps/api/.../blob/storage.ts) covers PUT,
// presign, delete; copying that whole surface here would duplicate ~500
// lines for one read path. Keeping this tiny on purpose.

import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

export type BlobBucket = 'documents' | 'voice' | 'exports' | 'ectd'

export interface BlobReadResult {
  bytes:       Buffer
  contentType: string | null
}

export interface BlobReader {
  read(bucket: BlobBucket, key: string): Promise<BlobReadResult>
}

// Local reader — matches LocalBlobStorage's on-disk layout:
//   <root>/<bucket>/<keyPath>              bytes
//   <root>/<bucket>/<keyPath>.meta.json    { contentType, sha256, size }
class LocalBlobReader implements BlobReader {
  constructor(private readonly rootDir: string) {}

  async read(bucket: BlobBucket, key: string): Promise<BlobReadResult> {
    const path = join(this.rootDir, bucket, key)
    const bytes = await readFile(path)
    let contentType: string | null = null
    try {
      const meta = JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as { contentType?: string }
      contentType = meta.contentType ?? null
    } catch {
      // Meta file missing — fine, caller can proceed with null content type.
    }
    return { bytes, contentType }
  }
}

// S3 reader — thin wrapper around GetObject. Imports the SDK dynamically
// so the local-dev worker (no AWS SDK installed) doesn't pay the cold-start
// cost or fail to boot.
class S3BlobReader implements BlobReader {
  constructor(
    private readonly config: {
      endpoint?:        string
      region:           string
      forcePathStyle:   boolean
      accessKeyId:      string
      secretAccessKey:  string
      bucketMap:        Record<BlobBucket, string>
    },
  ) {}

  async read(bucket: BlobBucket, key: string): Promise<BlobReadResult> {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3').catch(() => {
      throw new Error('S3 blob reader requires @aws-sdk/client-s3. Install it in apps/worker.')
    })
    const client = new S3Client({
      endpoint:        this.config.endpoint,
      region:          this.config.region,
      forcePathStyle:  this.config.forcePathStyle,
      credentials: {
        accessKeyId:     this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    })
    const out = await client.send(new GetObjectCommand({
      Bucket: this.config.bucketMap[bucket],
      Key:    key,
    }))
    const bytes = Buffer.from(await out.Body!.transformToByteArray())
    return { bytes, contentType: out.ContentType ?? null }
  }
}

/**
 * Build the reader from env, matching plugin.ts's provider selection:
 *   BLOB_PROVIDER=local → LocalBlobReader (dev)
 *   BLOB_PROVIDER=s3    → S3BlobReader   (prod)
 * Falls back to 's3' in production when the env var isn't set, 'local'
 * otherwise — same default as the API plugin.
 */
export function createBlobReaderFromEnv(): BlobReader {
  const provider = (process.env.BLOB_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 's3' : 'local')).toLowerCase()
  if (provider === 'local') {
    const rootDir = resolve(process.env.BLOB_LOCAL_ROOT_DIR ?? './var/blob')
    return new LocalBlobReader(rootDir)
  }
  const accessKeyId     = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('S3 blob reader requires S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY')
  }
  return new S3BlobReader({
    endpoint:        process.env.S3_ENDPOINT,
    region:          process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle:  process.env.S3_FORCE_PATH_STYLE !== 'false',
    accessKeyId,
    secretAccessKey,
    bucketMap: {
      documents: process.env.S3_DOCUMENTS_BUCKET ?? 'platform-documents',
      voice:     process.env.S3_VOICE_BUCKET     ?? 'platform-voice',
      exports:   process.env.S3_EXPORTS_BUCKET   ?? 'platform-exports',
      ectd:      process.env.S3_ECTD_BUCKET      ?? 'platform-ectd',
    },
  })
}
