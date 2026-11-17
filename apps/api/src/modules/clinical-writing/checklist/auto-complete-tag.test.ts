// CW-030: the template editor can set Q as an item's owner and any tagged auto-complete rule the
// engine understands; anything it wouldn't understand is refused instead of silently never firing.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { autoCompleteTagError, normaliseAutoCompleteTag } from './auto-complete-tag.js'
import { parseAutoCompleteTag } from './autocheck/content-strategies.js'
import { checklistTemplateAdminRoutes } from './routes.js'

describe('autoCompleteTagError', () => {
  it.each([
    'submit_for_review', 'crm_complete', 'document_signed',
    'content-min-words:200', 'content-min-words:50:§11.4',
    'content-no-placeholders', 'content-no-placeholders:§5',
    'references-complete', 'references-complete:§14',
    'signal:tlf-validated', 'signal:crm-resolved', 'signal:esig-captured', 'signal:esig-captured:Medical approval',
    'ai-pass:consistency', 'ai-pass:terminology-check',
  ])('accepts %s', tag => {
    expect(autoCompleteTagError(tag)).toBeNull()
  })

  it.each([
    ['', /Unknown/],
    ['whenever', /Unknown/],
    ['content-min-words', /word count/],
    ['content-min-words:abc', /word count/],
    ['content-min-words:0', /word count/],
    ['content-min-words:200:§1:extra', /at most one section/],
    ['content-no-placeholders:a:b', /at most one section/],
    ['signal', /Unknown signal/],
    ['signal:made-up', /Unknown signal/],
    ['signal:tlf-validated:x', /no further part/],
    ['ai-pass', /profile/],
    ['ai-pass:Has Spaces', /profile/],
    ['ai-pass:a:b', /profile/],
  ])('refuses %j', (tag, why) => {
    expect(autoCompleteTagError(tag)).toMatch(why)
  })

  it('stores a tag the engine parses back to the same strategy and arguments', () => {
    expect(normaliseAutoCompleteTag('  Content-Min-Words:200:§11.4 ')).toBe('content-min-words:200:§11.4')
    expect(normaliseAutoCompleteTag('SIGNAL:TLF-Validated')).toBe('signal:tlf-validated')
    expect(normaliseAutoCompleteTag('signal:esig-captured:Medical approval')).toBe('signal:esig-captured:Medical approval')
    expect(normaliseAutoCompleteTag('document_signed')).toBe('document_signed')
    expect(parseAutoCompleteTag(normaliseAutoCompleteTag('Content-Min-Words:200:§11.4'))).toEqual({ strategy: 'content-min-words', args: ['200', '§11.4'] })
  })
})

const PM: AuthenticatedUser = { id: 'u-pm', email: 'pm@x.io', role: 'pm', capabilities: [], modules: ['A'], tenantId: null }

async function build(status: 'draft' | 'locked' = 'draft') {
  const created: Array<Record<string, unknown>> = []
  const updated: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    checklistTemplate: { findUnique: vi.fn(async () => ({ id: 'T-1', deliverableType: 'csr_full', templateStatus: status })) },
    checklistTemplateItem: {
      aggregate: vi.fn(async () => ({ _max: { sortOrder: 40 } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'I-new', ...data } }),
      findUnique: vi.fn(async () => ({ id: 'I-1', templateId: 'T-1', template: { deliverableType: 'csr_full', templateStatus: status } })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { updated.push(data); return { id: 'I-1', ...data } }),
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = PM })
  await app.register(checklistTemplateAdminRoutes, { prefix: '/checklist-templates' })
  await app.ready()
  return { app, created, updated }
}

const item = { text: 'Title page reviewed', framework: 'ICH E3', stage: 'reporting' }

describe('template item routes accept Q and tagged rules', () => {
  it('adds an item owned by Q with a tagged rule, stored normalised', async () => {
    const t = await build()
    const res = await t.app.inject({ method: 'POST', url: '/checklist-templates/T-1/items', payload: { ...item, ownerRaci: 'Q', autoCompleteOn: 'Content-Min-Words:200:§11.4' } })
    expect(res.statusCode).toBe(201)
    expect(t.created[0]).toMatchObject({ ownerRaci: 'Q', autoCompleteOn: 'content-min-words:200:§11.4', sortOrder: 50 })
    await t.app.close()
  })

  it('edits an item to Q and to a signal rule, and can clear the rule', async () => {
    const t = await build()
    expect((await t.app.inject({ method: 'PATCH', url: '/checklist-templates/items/I-1', payload: { ownerRaci: 'Q', autoCompleteOn: 'signal:crm-resolved' } })).statusCode).toBe(200)
    expect(t.updated[0]).toMatchObject({ ownerRaci: 'Q', autoCompleteOn: 'signal:crm-resolved' })
    expect((await t.app.inject({ method: 'PATCH', url: '/checklist-templates/items/I-1', payload: { autoCompleteOn: null } })).statusCode).toBe(200)
    expect(t.updated[1]).toMatchObject({ autoCompleteOn: null })
    await t.app.close()
  })

  it('refuses a rule the engine would not understand, with the reason, and writes nothing', async () => {
    const t = await build()
    const add = await t.app.inject({ method: 'POST', url: '/checklist-templates/T-1/items', payload: { ...item, autoCompleteOn: 'content-min-words' } })
    expect(add.statusCode).toBe(400)
    expect(add.json().issues[0].message).toMatch(/word count/)
    const patch = await t.app.inject({ method: 'PATCH', url: '/checklist-templates/items/I-1', payload: { autoCompleteOn: 'ai-pass:Bad Name' } })
    expect(patch.statusCode).toBe(400)
    const owner = await t.app.inject({ method: 'POST', url: '/checklist-templates/T-1/items', payload: { ...item, ownerRaci: 'Z' } })
    expect(owner.statusCode).toBe(400)
    expect(t.created).toHaveLength(0)
    expect(t.updated).toHaveLength(0)
    await t.app.close()
  })

  it('still refuses to change a locked template', async () => {
    const t = await build('locked')
    expect((await t.app.inject({ method: 'POST', url: '/checklist-templates/T-1/items', payload: { ...item, ownerRaci: 'Q' } })).statusCode).toBe(409)
    await t.app.close()
  })
})
