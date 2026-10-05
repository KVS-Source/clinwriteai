// Blob storage Fastify plugin — picks local vs S3 based on env.
//
// Env:
//   BLOB_PROVIDER=local | s3    (default: local in dev, s3 in prod)
//   BLOB_LOCAL_ROOT_DIR         (default: ./var/blob — relative to cwd)
//   BLOB_LOCAL_SIGNING_KEY      (required for local; dev-only HMAC)
//   S3_* (existing env config from Phase 0)

import type { FastifyPluginAsync } from 'fastify'
import { resolve } from 'node:path'
import fp from 'fastify-plugin'
import { LocalBlobStorage } from './local-storage.js'
import { S3BlobStorage } from './s3-storage.js'
import type { BlobBucket, BlobStorage } from './storage.js'

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
    // S3 bucket mapping — one physical bucket per logical name. Falls back
    // to the Phase 0 S3_DOCUMENTS_BUCKET when the specific vars aren't set.
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
  // Only mounted when the provider is 'local'. They implement the equivalent
  // of S3 presigned-URL PUT + GET using HMAC tokens.
  if (storage instanceof LocalBlobStorage) {
    const { registerLocalBlobRoutes } = await import('./local-routes.js')
    await app.register(registerLocalBlobRoutes, { prefix: '/blob/local' })
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
