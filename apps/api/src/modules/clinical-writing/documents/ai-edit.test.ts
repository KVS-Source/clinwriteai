// Editor prompt box: POST /documents/:id/sections/:sectionId/ai-suggest with intent 'edit'.
// Fastify inject() with a stubbed Prisma + AI gateway.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { documentsRoutes, stripCodeFence } = await import('./routes.js')

async function build(responseText = '<p>Revised.</p>') {
  const chat = vi.fn(async (args: { prompt: string }) => ({ responseText, model: 'claude-test', inputTokens: 1, outputTokens: 1, costUsd: 0, limitDecision: 'allowed', piiScrubbed: false, piiCategories: [], recordId: 'rec-1', _prompt: args.prompt }))
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: 'DOC-1', projectId: 'proj-1', type: 'dsur',
        currentVersion: { sections: [{ id: 'row-1', sectionId: 'd2', sectionNumber: '§2', sectionTitle: 'Worldwide Marketing Approval Status', contentHtml: '<p>Saved text.</p>' }] },
      })),
    },
  } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorate('audit', { append: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, chat }
}

const edit = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: '/documents/DOC-1/sections/d2/ai-suggest', payload: payload as never })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe("ai-suggest intent 'edit'", () => {
  it('sends the instruction with the unsaved editor content and returns the revised HTML', async () => {
    const { app, chat } = await build()
    const res = await edit(app, { intent: 'edit', customPrompt: 'Make it one sentence', currentContent: '<p>Unsaved draft.</p>' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ responseText: '<p>Revised.</p>', model: 'claude-test', recordId: 'rec-1' })
    const call = chat.mock.calls[0]![0] as { prompt: string; intent: string; module: string; maxOutputTokens: number }
    expect(call).toMatchObject({ intent: 'edit', module: 'A', maxOutputTokens: 4096 })
    expect(call.prompt).toContain('Make it one sentence')
    expect(call.prompt).toContain('<p>Unsaved draft.</p>')
    expect(call.prompt).not.toContain('Saved text.')
    expect(call.prompt).toContain('"§2 Worldwide Marketing Approval Status"')   // no doubled §
    expect(call.prompt).toMatch(/Do not invent data/)
  })

  it('falls back to the saved content when the editor sends none', async () => {
    const { app, chat } = await build()
    await edit(app, { intent: 'edit', customPrompt: 'Fix grammar' })
    expect((chat.mock.calls[0]![0] as { prompt: string }).prompt).toContain('<p>Saved text.</p>')
  })

  it('needs an instruction', async () => {
    const { app, chat } = await build()
    expect((await edit(app, { intent: 'edit', customPrompt: '   ' })).statusCode).toBe(400)
    expect((await edit(app, { intent: 'edit' })).statusCode).toBe(400)
    expect(chat).not.toHaveBeenCalled()
  })

  it('strips a code fence the model wrapped around the HTML', async () => {
    const { app } = await build('```html\n<p>Fenced.</p>\n```')
    expect((await edit(app, { intent: 'edit', customPrompt: 'x' })).json().responseText).toBe('<p>Fenced.</p>')
  })
})

describe('stripCodeFence', () => {
  it('leaves unfenced text alone', () => {
    expect(stripCodeFence('  <p>a</p> ')).toBe('<p>a</p>')
    expect(stripCodeFence('```\n<p>b</p>```')).toBe('<p>b</p>')
  })
})
