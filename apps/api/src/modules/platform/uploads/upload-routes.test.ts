// Source-document uploads through the real Module A and Module C routes
// (multipart parsing, type check, blob write, DB row, audit) with the DB and
// blob storage stubbed. Pins that Excel and image files are accepted and that
// unsafe types are still refused.

import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsUploadRoutes } from '../../clinical-writing/documents/upload-routes.js'
import { medContentUploadRoutes } from '../../medical-writing/content/upload-routes.js'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function multipartBody(filename: string, mimetype: string, content: Buffer) {
  const boundary = '----testboundary7d1'
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { payload: Buffer.concat([head, content, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

async function build() {
  const blobPut = vi.fn(async () => undefined)
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'up-1', ...data }))
  const app = Fastify()
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } })
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1' })) },
    documentUpload: { create },
    contentUpload: { create },
  } as never)
  app.decorate('blob', { put: blobPut } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'a@b.c', role: 'super-admin', modules: ['A', 'C'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  // enabledModules() reads FEATURE_MODULES_ENABLED lazily; both modules on.
  await app.register(documentsUploadRoutes, { prefix: '/projects' })
  await app.register(medContentUploadRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, blobPut, create }
}

const ENDPOINTS = [
  { module: 'A', url: '/projects/proj-1/documents/upload' },
  { module: 'C', url: '/projects/proj-1/med-content/upload' },
] as const

describe.each(ENDPOINTS)('Module $module upload', ({ url }) => {
  beforeEach(() => {
    process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E'
  })

  it.each([
    ['listing.xlsx', XLSX],
    ['legacy.xls', 'application/vnd.ms-excel'],
    ['listing.csv', 'text/csv'],
    ['scan.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['crf-page.tif', 'image/tiff'],
    ['protocol.pdf', 'application/pdf'],
  ])('accepts %s', async (name, mime) => {
    const { app, blobPut, create } = await build()
    const { payload, headers } = multipartBody(name, mime, Buffer.from('file-bytes'))
    const res = await app.inject({ method: 'POST', url, payload, headers })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ uploadId: 'up-1', fileName: name })
    expect(blobPut).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['tool.exe', 'application/octet-stream'],
    ['page.html', 'text/html'],
    ['logo.svg', 'image/svg+xml'],
    ['invoice.pdf', 'text/html'],            // disguised
  ])('rejects %s without storing anything', async (name, mime) => {
    const { app, blobPut, create } = await build()
    const { payload, headers } = multipartBody(name, mime, Buffer.from('x'))
    const res = await app.inject({ method: 'POST', url, payload, headers })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'unsupported_mime' })
    expect(res.json().message).toMatch(/Excel/)
    expect(blobPut).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
