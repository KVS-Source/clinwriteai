// S3BlobStorage — AWS S3 + MinIO (S3-compatible) implementation.
//
// Prod path (ADR 0007). Backs by @aws-sdk/client-s3 so the same object
// works for MinIO on the standalone VPS (endpoint = http://localhost:9000,
// forcePathStyle=true) and real S3 after cloud migration.

import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { BlobBucket, BlobStorage, PresignedUrlOptions, PutObjectArgs, PutObjectResult } from './storage.js'

export interface S3Config {
  endpoint?: string              // undefined for AWS; http://localhost:9000 for MinIO
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean         // true for MinIO; false for AWS virtual-host-style
  bucketMap: Record<BlobBucket, string>
}

export class S3BlobStorage implements BlobStorage {
  private readonly client: S3Client
  private readonly bucketMap: Record<BlobBucket, string>

  constructor(config: S3Config) {
    this.client = new S3Client({
      ...(config.endpoint && { endpoint: config.endpoint }),
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
    this.bucketMap = config.bucketMap
  }

  private resolveBucket(logical: BlobBucket): string {
    const physical = this.bucketMap[logical]
    if (!physical) throw new Error(`S3BlobStorage: no bucket mapped for logical name '${logical}'`)
    return physical
  }

  async put(args: PutObjectArgs): Promise<PutObjectResult> {
    const Bucket = this.resolveBucket(args.bucket)
    const body = args.body instanceof Readable
      ? await streamToBuffer(args.body)
      : (args.body instanceof Buffer ? args.body : Buffer.from(args.body as Uint8Array))

    const res = await this.client.send(new PutObjectCommand({
      Bucket,
      Key: args.key,
      Body: body,
      ContentType: args.contentType,
      Metadata: args.metadata,
    }))

    // S3's ETag is MD5-based for simple PUT; we also compute sha256 for
    // our integrity story. Return sha256 as the etag so callers don't
    // depend on provider specifics.
    const sha256 = createHash('sha256').update(body).digest('hex')
    void res
    return { bucket: args.bucket, key: args.key, size: body.length, etag: sha256 }
  }

  async get(bucket: BlobBucket, key: string) {
    const Bucket = this.resolveBucket(bucket)
    const res = await this.client.send(new GetObjectCommand({ Bucket, Key: key }))
    const body = await streamToBuffer(res.Body as Readable)
    return {
      body,
      contentType: res.ContentType ?? null,
      size: body.length,
    }
  }

  async del(bucket: BlobBucket, key: string): Promise<boolean> {
    const Bucket = this.resolveBucket(bucket)
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket, Key: key }))
      return true
    } catch (err) {
      // DeleteObject is idempotent — if the key doesn't exist, S3 still
      // returns 204. Only genuine errors throw.
      if (err instanceof Error && err.name === 'NoSuchKey') return false
      throw err
    }
  }

  async presignUpload(bucket: BlobBucket, key: string, opts: PresignedUrlOptions = {}): Promise<string> {
    const Bucket = this.resolveBucket(bucket)
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket, Key: key, ContentType: opts.contentType }),
      { expiresIn: opts.expiresInSeconds ?? 900 },
    )
  }

  async presignDownload(bucket: BlobBucket, key: string, opts: { expiresInSeconds?: number } = {}): Promise<string> {
    const Bucket = this.resolveBucket(bucket)
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket, Key: key }),
      { expiresIn: opts.expiresInSeconds ?? 900 },
    )
  }

  async close(): Promise<void> {
    this.client.destroy()
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
