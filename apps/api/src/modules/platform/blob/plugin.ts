// Blob storage Fastify plugin — picks local vs S3 based on env.
//
// Env:
//   BLOB_PROVIDER=local | s3    (default: local in dev, s3 in prod)
//   BLOB_LOCAL_ROOT_DIR         (default: ./var/blob — relative to cwd)
//   BLOB_LOCAL_SIGNING_KEY      (required for local; dev-only HMAC)
//   S3_* (existing env config from Phase 0)
//
// For the local path we also wire the /blob/local/:bucket/:keyB64
// HTTP endpoints inline (they implement the presigned-URL contract).
// S3 mode never mounts these — URLs point at S3 directly.

import type { FastifyPluginAsync } from 'fastify'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import fp from 'fastify-plugin'
import { LocalBlobStorage } from './local-storage.js'
import { S3BlobStorage } from './s3-storage.js'
import type { BlobBucket, BlobStorage } from './storage.js'

const VALID_BUCKETS: ReadonlySet<string> = new Set(['documents', 'voice', 'exports', 'ectd'])

async function readRawBody(req: { raw: NodeJS.ReadableStream }): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req.raw) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk as string))
  }
  return Buffer.concat(chunks)
}

const blobPlugin: FastifyPluginAsync = async (app) => {
  const provider = (process.env.BLOB_PROVIDER ?? (app.env.NODE_ENV === 'production' ? 's3' : 'local')).toLowerCase()

  let storage: BlobStorage
  if (provider === 'local') {
    const rootDir = resolve(process.env.BLOB_LOCAL_ROOT_DIR ?? './var/blob')
    const signingKey = process.env.BLOB_LOCAL_SIGNING_KEY
      ?? (app.env.NODE_ENV === 'production'
            ? (() => { throw new Error('BLOB_LOCAL_SIGNING_KEY required when BLOB_PROVIDER=local in production') })()
            : 'dev-local-blob-signing-key-change-me')
    storage = new LocalBlobStorage(rootDir, signingKey)
    app.log.warn({ rootDir, provider: 'local' }, 'BlobStorage: using local filesystem — NOT for production')
  } else {
    const bucketMap: Record<BlobBucket, string> = {
      documents: process.env.S3_DOCUMENTS_BUCKET ?? 'platform-documents',
      voice:     process.env.S3_VOICE_BUCKET     ?? 'platform-voice',
      exports:   process.env.S3_EXPORTS_BUCKET   ?? 'platform-exports',
      ectd:      process.env.S3_ECTD_BUCKET      ?? 'platform-ectd',
    }
    storage = new S3BlobStorage({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      accessKeyId: await app.secrets.getSecret('S3_ACCESS_KEY_ID'),
      secretAccessKey: await app.secrets.getSecret('S3_SECRET_ACCESS_KEY'),
      bucketMap,
    })
    app.log.info({ provider: 's3', endpoint: process.env.S3_ENDPOINT ?? '(aws default)' }, 'BlobStorage: using S3-compatible')
  }

  app.decorate('blob', storage)

  // --- Local-storage HTTP endpoints ---------------------------------------
  // Registered inline (not as a sub-plugin) so route registration happens
  // against the top-level app with the same lifecycle guarantees as other
  // routes in server.ts. Mounted only when provider=local; in S3 mode the
  // presigned URLs point directly at S3.
  if (storage instanceof LocalBlobStorage) {
    const local = storage
    app.log.info({}, 'BlobStorage: registering /blob/local/* HTTP endpoints')

    app.put('/blob/local/:bucket/:keyB64', async (request, reply) => {
      const { bucket, keyB64 } = request.params as { bucket: string; keyB64: string }
      const { token, expires, contentType } = request.query as { token?: string; expires?: string; contentType?: string }
      if (!token || !expires) return reply.code(400).send({ error: 'missing_token' })
      if (!VALID_BUCKETS.has(bucket)) return reply.code(400).send({ error: 'bad_bucket' })

      const key = Buffer.from(keyB64, 'base64url').toString('utf8')
      const expiresTs = Number(expires)
      if (Number.isNaN(expiresTs)) return reply.code(400).send({ error: 'bad_expires' })

      if (!local.verifyToken('PUT', bucket as BlobBucket, key, token, expiresTs)) {
        return reply.code(403).send({ error: 'invalid_token' })
      }

      const buf = await readRawBody(request)
      if (buf.length === 0) return reply.code(400).send({ error: 'missing_body' })

      const result = await local.put({
        bucket: bucket as BlobBucket,
        key,
        body: buf,
        contentType: contentType ?? (request.headers['content-type'] as string | undefined) ?? 'application/octet-stream',
      })
      return reply.code(201).send({ ok: true, bucket: result.bucket, key: result.key, size: result.size, etag: result.etag })
    })

    app.get('/blob/local/:bucket/:keyB64', async (request, reply) => {
      const { bucket, keyB64 } = request.params as { bucket: string; keyB64: string }
      const { token, expires } = request.query as { token?: string; expires?: string }
      if (!token || !expires) return reply.code(400).send({ error: 'missing_token' })
      if (!VALID_BUCKETS.has(bucket)) return reply.code(400).send({ error: 'bad_bucket' })

      const key = Buffer.from(keyB64, 'base64url').toString('utf8')
      const expiresTs = Number(expires)
      if (Number.isNaN(expiresTs)) return reply.code(400).send({ error: 'bad_expires' })

      if (!local.verifyToken('GET', bucket as BlobBucket, key, token, expiresTs)) {
        return reply.code(403).send({ error: 'invalid_token' })
      }

      try {
        const { body, contentType } = await local.get(bucket as BlobBucket, key)
        reply.header('Content-Type', contentType ?? 'application/octet-stream')
        reply.header('ETag', createHash('sha256').update(body).digest('hex'))
        return reply.send(body)
      } catch (err) {
        return reply.code(404).send({ error: 'not_found', message: err instanceof Error ? err.message : 'unknown' })
      }
    })
  }

  app.addHook('onClose', async () => {
    await storage.close()
  })
}

declare module 'fastify' {
  interface FastifyInstance {
    blob: BlobStorage
  }
}

export default fp(blobPlugin, { name: 'blob', dependencies: ['prisma'] })
