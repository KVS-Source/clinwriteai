// QA regression — an author could not upload a source document ("Only an author (R) ... can change its source
// documents"): the upload is an XMLHttpRequest and didn't say who was asking, so the API answered as someone else.
// It must carry the same identity headers as every other call.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/58-source-upload-identity.spec.ts
//
// Everything is answered inside the page; nothing reaches the API.

import { test, expect } from '@playwright/test'

test.setTimeout(120_000)

const ME = {
  id: 'u-dual', email: 'dual@example.com', name: 'Dual Role', role: 'contributor', roles: ['contributor'],
  allRoles: ['contributor', 'pm'], modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null,
}

test('the source upload says who is uploading and in which role', async ({ page }) => {
  await page.addInitScript(({ me }) => {
    sessionStorage.setItem('clinwrite.demo.currentUserId', me.id)
    localStorage.setItem('clinwrite.activeRole', JSON.stringify({ [me.id]: 'contributor' }))
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const p = new URL(url, location.origin).pathname
      if (p.startsWith('/src/') || p.startsWith('/node_modules/') || p.startsWith('/@')) return real(input, init)
      if (p.endsWith('/auth/me')) return json(me)
      if (/\/projects\/p-e2e$/.test(p)) return json({ id: 'p-e2e', name: 'E2E', status: 'ongoing', team: [], documents: [] })
      if (p.endsWith('/source-documents/access')) return json({ canView: true, canUpload: true })
      if (p.endsWith('/source-documents')) return json({ items: [], total: 0, summary: { files: 0 } })
      return json([])
    }
    const w = window as unknown as { __upload: { url: string; headers: Record<string, string> } | null }
    w.__upload = null
    const proto = XMLHttpRequest.prototype
    const seen = new WeakMap<XMLHttpRequest, { url: string; headers: Record<string, string> }>()
    const open = proto.open
    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
      seen.set(this, { url: String(url), headers: {} })
      open.call(this, method, url, true)
    }
    proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) { seen.get(this)!.headers[name] = value }
    proto.send = function (this: XMLHttpRequest) { w.__upload = seen.get(this)! }
  }, { me: ME })

  await page.goto('/projects/p-e2e/clinical-writing')
  await page.getByRole('button', { name: 'Upload source document' }).first().click({ timeout: 60_000 })
  await page.locator('[data-form="upload-document"] input[type="file"]')
    .setInputFiles({ name: 'protocol.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })

  await expect.poll(() => page.evaluate(() => (window as unknown as { __upload: unknown }).__upload)).toMatchObject({
    url: expect.stringContaining('/projects/p-e2e/documents/upload'),
    headers: { 'X-Demo-Persona': 'u-dual', 'X-Active-Role': 'contributor' },
  })
})
