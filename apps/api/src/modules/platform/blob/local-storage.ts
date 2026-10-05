// LocalBlobStorage — filesystem-backed BlobStorage for dev + testing.
//
// Why: the dev box has no Docker / MinIO running. Instead of making every
// contributor install MinIO just to click through the upload UI, we write
// to a local directory and serve "presigned URLs" as short-lived HMAC
// tokens the API validates in-process.
//
// Layout:
//   <root>/<bucket>/<keyPath>              — the actual bytes
//   <root>/<bucket>/<keyPath>.meta.json    — contentType + sha256 + size
//
// Not for production. Loud startup log so no one ships it unintentionally.
//
// Presigned URL format: `/blob/local/:bucket/:keyB64?token=<hmac>&expires=<ts>`
// The /blob/local/ Fastify route (storage/routes.ts) validates and streams.

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import type { BlobBucket, BlobStorage, PresignedUrlOptions, PutObjectArgs, PutObjectResult } from './storage.js'

interface MetaFile {
  contentType: string
  sha256: string
  size: number
  metadata?: Record<string, string>
}

export class LocalBlobStorage implements BlobStorage {
  private readonly signingKey: Buffer

  constructor(
    private readonly rootDir: string,
    signingKeyRaw: string,
  ) {
    // Dev-only signing key — short reject on obviously-wrong configs.
    if (!signingKeyRaw || signingKeyRaw.length < 16) {
      throw new Error('LocalBlobStorage: BLOB_LOCAL_SIGNING_KEY must be >=16 chars (dev-only)')
    }
    this.signingKey = Buffer.from(signingKeyRaw, 'utf8')
  }

  private pathFor(bucket: BlobBucket, key: string): string {
    // Sanitise key: no absolute paths, no `..` traversal.
    const safeKey = key.replace(/^\/+/, '').replace(/\.\.(?:\/|\\)/g, '')
    return resolve(this.rootDir, bucket, safeKey)
  }

  async put(args: PutObjectArgs): Promise<PutObjectResult> {
    const target = this.pathFor(args.bucket, args.key)
    await mkdir(dirname(target), { recursive: true })

    const buf = args.body instanceof Buffer
      ? args.body
      : (args.body as Buffer | Uint8Array) instanceof Uint8Array
        ? Buffer.from(args.body as Uint8Array)
        : await streamToBuffer(args.body as Readable)

    await writeFile(target, buf)
    const sha256 = createHash('sha256').update(buf).digest('hex')
    const meta: MetaFile = {
      contentType: args.contentType,
      sha256,
      size: buf.length,
      metadata: args.metadata,
    }
    await writeFile(`${target}.meta.json`, JSON.stringify(meta))

    return { bucket: args.bucket, key: args.key, size: buf.length, etag: sha256 }
  }

  async get(bucket: BlobBucket, key: string) {
    const target = this.pathFor(bucket, key)
    const body = await readFile(target)
    const metaRaw = await readFile(`${target}.meta.json`, 'utf8').catch(() => null)
    const meta = metaRaw ? (JSON.parse(metaRaw) as MetaFile) : null
    return {
      body,
      contentType: meta?.contentType ?? null,
      size: body.length,
    }
  }

  async del(bucket: BlobBucket, key: string): Promise<boolean> {
    const target = this.pathFor(bucket, key)
    try {
      await stat(target)
    } catch {
      return false
    }
    await rm(target, { force: true })
    await rm(`${target}.meta.json`, { force: true })
    return true
  }

  async presignUpload(bucket: BlobBucket, key: string, opts: PresignedUrlOptions = {}): Promise<string> {
    const expires = Date.now() + (opts.expiresInSeconds ?? 900) * 1000
    const token = this.sign('PUT', bucket, key, expires)
    const keyB64 = Buffer.from(key, 'utf8').toString('base64url')
    const ct = opts.contentType ? `&contentType=${encodeURIComponent(opts.contentType)}` : ''
    return `/blob/local/${bucket}/${keyB64}?token=${token}&expires=${expires}${ct}`
  }

  async presignDownload(bucket: BlobBucket, key: string, opts: { expiresInSeconds?: number } = {}): Promise<string> {
    const expires = Date.now() + (opts.expiresInSeconds ?? 900) * 1000
    const token = this.sign('GET', bucket, key, expires)
    const keyB64 = Buffer.from(key, 'utf8').toString('base64url')
    return `/blob/local/${bucket}/${keyB64}?token=${token}&expires=${expires}`
  }

  verifyToken(method: 'PUT' | 'GET', bucket: BlobBucket, key: string, token: string, expires: number): boolean {
    if (Date.now() > expires) return false
    const expected = this.sign(method, bucket, key, expires)
    // Timing-safe compare — tokens are hex, so straight comparison would
    // leak via timing.
    return token.length === expected.length &&
      createHmac('sha256', this.signingKey).update(token).digest('hex') ===
      createHmac('sha256', this.signingKey).update(expected).digest('hex')
  }

  private sign(method: 'PUT' | 'GET', bucket: BlobBucket, key: string, expires: number): string {
    return createHmac('sha256', this.signingKey)
      .update(method).update('|').update(bucket).update('|').update(key).update('|').update(String(expires))
      .digest('hex')
  }

  async close(): Promise<void> {
    // No persistent handles — noop.
  }
}

/** Generate a key suitable for a new upload (random + readable prefix). */
export function generateBlobKey(prefix: string, extension?: string): string {
  const ts = new Date().toISOString().slice(0, 10)
  const rand = randomBytes(8).toString('hex')
  const ext = extension ? `.${extension.replace(/^\./, '')}` : ''
  return `${prefix}/${ts}/${rand}${ext}`
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
