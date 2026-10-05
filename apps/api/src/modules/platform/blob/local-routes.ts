// HTTP endpoints that back LocalBlobStorage.presignUpload/presignDownload.
//
// Mounted at /blob/local/ only when BLOB_PROVIDER=local. In S3 mode these
// routes don't exist — the presigned URLs point at S3 directly.
//
// PUT /blob/local/:bucket/:keyB64?token=<hmac>&expires=<ts>
// GET /blob/local/:bucket/:keyB64?token=<hmac>&expires=<ts>
//
// Both verify the HMAC + expiry before touching the filesystem.

import type { FastifyPluginAsync } from 'fastify'
import { createHash } from 'node:crypto'
import { LocalBlobStorage } from './local-storage.js'
import type { BlobBucket } from './storage.js'

const VALID_BUCKETS: ReadonlySet<string> = new Set(['documents', 'voice', 'exports', 'ectd'])

export const registerLocalBlobRoutes: FastifyPluginAsync = async (app) => {
  // Register support for arbitrary content types — the client picks what
  // they're uploading, we just stream it through.
  app.addContentTypeParser(/.*/, { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.put('/:bucket/:keyB64', async (request, reply) => {
    const { bucket, keyB64 } = request.params as { bucket: string; keyB64: string }
    const { token, expires, contentType } = request.query as { token?: string; expires?: string; contentType?: string }
    if (!token || !expires) return reply.code(400).send({ error: 'missing_token' })
    if (!VALID_BUCKETS.has(bucket)) return reply.code(400).send({ error: 'bad_bucket' })

    const key = Buffer.from(keyB64, 'base64url').toString('utf8')
    const expiresTs = Number(expires)
    if (Number.isNaN(expiresTs)) return reply.code(400).send({ error: 'bad_expires' })

    const storage = app.blob as LocalBlobStorage
    if (!storage.verifyToken('PUT', bucket as BlobBucket, key, token, expiresTs)) {
      return reply.code(403).send({ error: 'invalid_token' })
    }

    const body = request.body as Buffer | undefined
    if (!body || !Buffer.isBuffer(body)) return reply.code(400).send({ error: 'missing_body' })

    const result = await storage.put({
      bucket: bucket as BlobBucket,
      key,
      body,
      contentType: contentType ?? (request.headers['content-type'] as string | undefined) ?? 'application/octet-stream',
    })

    return reply.code(201).send({
      ok: true,
      bucket: result.bucket,
      key: result.key,
      size: result.size,
      etag: result.etag,
    })
  })

  app.get('/:bucket/:keyB64', async (request, reply) => {
    const { bucket, keyB64 } = request.params as { bucket: string; keyB64: string }
    const { token, expires } = request.query as { token?: string; expires?: string }
    if (!token || !expires) return reply.code(400).send({ error: 'missing_token' })
    if (!VALID_BUCKETS.has(bucket)) return reply.code(400).send({ error: 'bad_bucket' })

    const key = Buffer.from(keyB64, 'base64url').toString('utf8')
    const expiresTs = Number(expires)
    if (Number.isNaN(expiresTs)) return reply.code(400).send({ error: 'bad_expires' })

    const storage = app.blob as LocalBlobStorage
    if (!storage.verifyToken('GET', bucket as BlobBucket, key, token, expiresTs)) {
      return reply.code(403).send({ error: 'invalid_token' })
    }

    try {
      const { body, contentType } = await storage.get(bucket as BlobBucket, key)
      reply.header('Content-Type', contentType ?? 'application/octet-stream')
      reply.header('ETag', createHash('sha256').update(body).digest('hex'))
      return reply.send(body)
    } catch (err) {
      return reply.code(404).send({ error: 'not_found', message: err instanceof Error ? err.message : 'unknown' })
    }
  })
}
