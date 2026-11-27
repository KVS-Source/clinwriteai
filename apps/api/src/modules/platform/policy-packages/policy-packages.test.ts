// Policy packages (docs/policy-packages.md): a GenBioCa-signed file carrying a document type's AI build plan. The
// tenant admin previews and imports it; the drafting worker follows the plan of the policy version a document was
// created with.

import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { DEV_PRIVATE_KEY_PEM, DEV_PUBLIC_KEY_PEM } from '../licensing/keys.js'
import { checkPlanAgainstTemplate, headingNumbers, numbersNotDraftedByAi, parseBuildPlan, type BuildPlan } from './build-plan.js'
import { PolicyPackageService, verifyPolicyPackage } from './package.js'
import { packagePayload, signPayload } from './sign.js'
import { policyPackageRoutes } from './routes.js'
import { asBuildPlan, earlierSectionsFor, orderByPlan, planPromptBlock } from '../../../../../worker/src/jobs/build-plan.js'

const MANIFEST = fileURLToPath(new URL('../../../../../../policy-packages/protocol-build-plan/package.json', import.meta.url))
const PLAN = JSON.parse(readFileSync(new URL('../../../../../../policy-packages/protocol-build-plan/build-plan.json', import.meta.url), 'utf8')) as BuildPlan

/** The Protocol template as it is today: the plan's sections, the References section and main headings 1–11. */
const TEMPLATE = [
  ...Array.from({ length: 11 }, (_, i) => ({ number: String(i + 1), title: `Heading ${i + 1}` })),
  ...PLAN.stages.flatMap(s => s.sections),
  { number: '12', title: 'References' },
].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }))

const VERSION = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { packageVersion: number }).packageVersion

const signed = (over: Record<string, unknown> = {}, key = DEV_PRIVATE_KEY_PEM) => signPayload({ ...packagePayload(MANIFEST), ...over }, key)

describe('the Protocol build plan file', () => {
  it('is a valid plan', () => {
    expect(parseBuildPlan(PLAN)).toMatchObject({ ok: true })
  })
  it('fits the current template: only the sections a protocol is expected to have are missing', () => {
    expect(checkPlanAgainstTemplate(PLAN, TEMPLATE)).toEqual([
      'The template has no title page section.',
      'The template has no signature page section.',
      'The template has no list of abbreviations section.',
      'The template has no table of contents section.',
    ])
  })
  it('reports a template section the plan does not place, a renamed one and one that is gone', () => {
    const changed = TEMPLATE.filter(s => s.number !== '4.4').map(s => (s.number === '3.3' ? { ...s, title: 'Estimand Framework' } : s))
    const warnings = checkPlanAgainstTemplate(PLAN, [...changed, { number: '9.5', title: 'Audits' }])
    expect(warnings).toContain('The plan drafts 4.4 Quality by Design, but the template has no section 4.4. It will be skipped.')
    expect(warnings).toContain('Section 3.3 is “Estimand Framework” in the template but “Estimands” in the plan. Check that the plan still fits.')
    expect(warnings).toContain('9.5 Audits is not in the build plan. It will be drafted after the plan’s stages, before the summary.')
  })
})

describe('build plan rules', () => {
  const base = (): BuildPlan => JSON.parse(JSON.stringify(PLAN)) as BuildPlan
  it('refuses a section placed twice, a dependency drafted later, and a dependency on a code-built section', () => {
    const twice = base(); twice.stages[1]!.sections.push({ number: '3.1', title: 'Primary Objective and Endpoint' })
    expect(parseBuildPlan(twice)).toMatchObject({ ok: false, errors: ['Section 3.1 is placed more than once.'] })
    const later = base(); later.dependsOn['3.1'] = ['4.1']
    expect(parseBuildPlan(later)).toMatchObject({ ok: false, errors: ['Section 3.1 depends on 4.1, which is drafted after it.'] })
    const code = base(); code.dependsOn['13'] = ['12']
    expect(parseBuildPlan(code)).toMatchObject({ ok: false, errors: ['Section 13 depends on 12, which is built by code after drafting.'] })
  })
  it('refuses an unknown field or a newer plan format', () => {
    expect(parseBuildPlan({ ...PLAN, extra: 1 })).toMatchObject({ ok: false })
    expect(parseBuildPlan({ ...PLAN, schemaVersion: 2 })).toMatchObject({ ok: false })
  })
  it('a number with sub-sections is a main heading', () => {
    expect([...headingNumbers(TEMPLATE)].sort()).toEqual(['1', '10', '11', '2', '3', '4', '5', '6', '7', '8', '9'])
  })
  it('drafting progress leaves out what the plan never drafts: main headings and References', () => {
    const numbers = TEMPLATE.map(s => s.number)
    expect(numbersNotDraftedByAi({ ...PLAN, headings: 'template_only' }, numbers).size).toBe(12)
    expect(numbersNotDraftedByAi({ ...PLAN, headings: 'template_only' }, numbers).has('12')).toBe(true)
    // With introductions (plan v4) only References is left out.
    expect([...numbersNotDraftedByAi(PLAN, numbers)]).toEqual(['12'])
    expect(numbersNotDraftedByAi(null, numbers).size).toBe(0)
  })
})

describe('verifying a package', () => {
  it('a package signed with the GenBioCa key for every install is accepted', () => {
    const r = verifyPolicyPackage(signed(), DEV_PUBLIC_KEY_PEM, 'install-1')
    expect(r).toMatchObject({ ok: true, value: { pkg: { packageId: 'protocol-build-plan', packageVersion: VERSION } } })
  })
  it('refuses another key, a changed file, a license key, a newer format and another install', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(verifyPolicyPackage(signed({}, other), DEV_PUBLIC_KEY_PEM, null)).toMatchObject({ ok: false, reason: 'invalid_signature' })
    const [h, , s] = signed().split('.')
    const forged = Buffer.from(JSON.stringify({ ...packagePayload(MANIFEST), packageVersion: 99 })).toString('base64url')
    expect(verifyPolicyPackage(`${h}.${forged}.${s}`, DEV_PUBLIC_KEY_PEM, null)).toMatchObject({ ok: false, reason: 'invalid_signature' })
    expect(verifyPolicyPackage(signed({ typ: undefined }), DEV_PUBLIC_KEY_PEM, null)).toMatchObject({ ok: false, reason: 'not_a_policy_package' })
    expect(verifyPolicyPackage(signed({ formatVersion: 2 }), DEV_PUBLIC_KEY_PEM, null)).toMatchObject({ ok: false, reason: 'format_too_new' })
    const forOne = signed({ audience: { installIds: ['customer-a'] } })
    expect(verifyPolicyPackage(forOne, DEV_PUBLIC_KEY_PEM, 'customer-b')).toMatchObject({ ok: false, reason: 'not_for_this_install' })
    expect(verifyPolicyPackage(forOne, DEV_PUBLIC_KEY_PEM, 'customer-a')).toMatchObject({ ok: true })
  })
})

type PolicyRow = Record<string, unknown> & { id: string; docType: string; version: number; isCurrent: boolean; retiredAt: Date | null }

function fakePrisma(policies: PolicyRow[], template: { id: string; label: string; version: number; sections: unknown } | null = { id: 'tpl', label: 'Protocol', version: 2, sections: TEMPLATE }) {
  const current = (docType: string) => policies.find(p => p.docType === docType && p.isCurrent && !p.retiredAt) ?? null
  const tx = {
    documentTypePolicy: {
      findFirst: vi.fn(async ({ where, orderBy }: { where: { docType: string; isCurrent?: boolean }; orderBy?: unknown }) =>
        orderBy ? [...policies].filter(p => p.docType === where.docType).sort((a, b) => b.version - a.version)[0] ?? null : current(where.docType)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `pol-${policies.length + 1}`, retiredAt: null, ...data } as PolicyRow
        policies.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(policies.find(p => p.id === where.id)!, data)),
    },
  }
  return {
    ...tx,
    documentTemplate: { findUnique: vi.fn(async () => template), findFirst: vi.fn(async () => template) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
}

const PROTOCOL_V1: PolicyRow = {
  id: 'pol-1', docType: 'protocol', version: 1, isCurrent: true, retiredAt: null, smePrompt: 'SME prompt', bestPracticeDigest: { principles: [] },
  sectionRules: { s1: [] }, templateId: null, checklistTemplateId: 'cl-1', ichFramework: null, ichFrameworkNames: ['ICH M11'],
  requirements: { requireSources: true, requireTemplate: true, requirePurpose: false }, buildPlan: null, buildPlanSource: null,
}

describe('previewing and importing', () => {
  const service = (prisma: ReturnType<typeof fakePrisma>) => new PolicyPackageService(prisma as never, { publicKeyPem: DEV_PUBLIC_KEY_PEM, installId: null })

  it('the preview says what changes and warns about the template, without writing anything', async () => {
    const prisma = fakePrisma([{ ...PROTOCOL_V1 }])
    const r = await service(prisma).preview(signed())
    expect(r.ok && r.value).toMatchObject({
      ok: true, packageId: 'protocol-build-plan', packageVersion: VERSION,
      items: [{ docType: 'protocol', currentVersion: 1, newVersion: 2, template: { id: 'tpl' }, errors: [], stages: expect.arrayContaining([{ label: 'Summary (last)', sections: 2 }]) }],
    })
    expect(r.ok && r.value.items[0]!.warnings).toHaveLength(4)
    expect(prisma.documentTypePolicy.create).not.toHaveBeenCalled()
  })

  it('import makes a new policy version that keeps everything else and records where the plan came from', async () => {
    const policies = [{ ...PROTOCOL_V1 }]
    const r = await service(fakePrisma(policies)).importPackage(signed(), 'admin-1')
    expect(r.ok && r.value.applied).toEqual([{ docType: 'protocol', version: 2, policyId: 'pol-2' }])
    expect(policies[0]).toMatchObject({ isCurrent: false, supersededBy: 'pol-2' })
    expect(policies[1]).toMatchObject({
      version: 2, isCurrent: true, smePrompt: 'SME prompt', checklistTemplateId: 'cl-1', ichFrameworkNames: ['ICH M11'],
      requirements: { requirePurpose: false }, buildPlan: { label: PLAN.label },
      buildPlanSource: { packageId: 'protocol-build-plan', packageVersion: VERSION, importedBy: 'admin-1', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    })
  })

  it('a document type without a policy gets one, so a plan can arrive before the policy is written', async () => {
    const policies: PolicyRow[] = []
    const r = await service(fakePrisma(policies, null)).importPackage(signed(), 'admin-1')
    expect(r.ok && r.value.items[0]!.warnings).toEqual(['There is no protocol template yet. The plan is checked against it when one is added.'])
    expect(policies).toMatchObject([{ docType: 'protocol', version: 1, isCurrent: true, buildPlan: { label: PLAN.label } }])
  })

  it('the same or an older package version is not imported again; nothing is written', async () => {
    const prisma = fakePrisma([{ ...PROTOCOL_V1, buildPlanSource: { packageId: 'protocol-build-plan', packageVersion: VERSION } }])
    const r = await service(prisma).importPackage(signed(), 'admin-1')
    expect(r.ok && r.value).toMatchObject({ ok: false, applied: [] })
    expect(r.ok && r.value.items[0]!.errors[0]).toMatch(new RegExp(`Version ${VERSION} of this package is already imported`))
    expect(prisma.documentTypePolicy.create).not.toHaveBeenCalled()
  })

  it('contents this version can’t apply, or a broken plan, stop the whole import', async () => {
    const prisma = fakePrisma([{ ...PROTOCOL_V1 }])
    const withPrompt = signed({ contents: [{ docType: 'protocol', buildPlan: PLAN, aiPrompt: { text: 'x' } }] })
    expect((await service(prisma).preview(withPrompt) as { value: { items: Array<{ errors: string[] }> } }).value.items[0]!.errors)
      .toEqual(['This version of the app can’t import AI prompts yet.'])
    const broken = signed({ contents: [{ docType: 'protocol', buildPlan: { ...PLAN, dependsOn: { '3.1': ['4.1'] } } }] })
    expect((await service(prisma).preview(broken) as { value: { items: Array<{ errors: string[] }> } }).value.items[0]!.errors)
      .toEqual(['Build plan: Section 3.1 depends on 4.1, which is drafted after it.'])
  })
})

describe('the import routes', () => {
  async function build(role: string) {
    const policies = [{ ...PROTOCOL_V1 }]
    const append = vi.fn(async () => undefined)
    const app = Fastify()
    app.decorate('prisma', { ...fakePrisma(policies), license: { findFirst: vi.fn(async () => null) } } as never)
    app.decorate('audit', { append } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (r) => {
      const user: AuthenticatedUser = { id: 'admin-1', email: 'a@x', role, modules: ['A'], tenantId: 't1' }
      Object.assign(r, { user })
    })
    await app.register(policyPackageRoutes, { prefix: '/policy-packages' })
    await app.ready()
    return { app, append, policies }
  }

  it('the admin previews, then imports; both are audited and a PM may do neither', async () => {
    const { app, append, policies } = await build('tenant-admin')
    const preview = await app.inject({ method: 'POST', url: '/policy-packages/preview', payload: { package: signed() } })
    expect(preview.statusCode).toBe(200)
    expect(policies).toHaveLength(1)
    const res = await app.inject({ method: 'POST', url: '/policy-packages/import', payload: { package: signed() } })
    expect(res.statusCode).toBe(200)
    expect(policies).toHaveLength(2)
    expect(append.mock.calls.map(c => (c as unknown as [{ action: string }])[0].action)).toEqual(['policy_package.imported', 'document_type_policy.build_plan_imported'])
    const again = await app.inject({ method: 'POST', url: '/policy-packages/import', payload: { package: signed() } })
    expect(again.statusCode).toBe(422)
    expect((append.mock.calls.at(-1) as unknown as [{ action: string }])[0].action).toBe('policy_package.import_failed')

    const pm = await build('pm')
    expect((await pm.app.inject({ method: 'POST', url: '/policy-packages/preview', payload: { package: signed() } })).statusCode).toBe(403)
  })

  it('a policy change at the same moment (same new version number) asks to preview again', async () => {
    const { app } = await build('tenant-admin')
    const prisma = app.prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }
    prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
    const res = await app.inject({ method: 'POST', url: '/policy-packages/import', payload: { package: signed() } })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'policy_changed' })
  })

  it('a tampered file is refused with the reason', async () => {
    const { app } = await build('tenant-admin')
    const res = await app.inject({ method: 'POST', url: '/policy-packages/preview', payload: { package: `${signed()}x` } })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: 'invalid_signature' })
  })
})

describe('drafting follows the plan', () => {
  // Headings kept as headings only (plans before v4); the introductions are tested below.
  const plan = asBuildPlan({ ...PLAN, headings: 'template_only' })!
  const sections = TEMPLATE.map(s => ({ ...s, id: `s${s.number}` }))
  const planned = orderByPlan(sections, plan)

  it('objectives first, the synopsis last; headings and References are not drafted', () => {
    const drafted = planned.filter(p => p.mode === 'draft').map(p => p.section.number)
    expect(drafted.slice(0, 4)).toEqual(['3.1', '3.2', '3.3', '4.1'])
    expect(drafted.slice(-2)).toEqual(['1.1', '1.2'])
    expect(drafted.indexOf('1.3')).toBeGreaterThan(drafted.indexOf('7.5'))
    expect(drafted).toHaveLength(50)
    expect(planned.filter(p => p.mode === 'heading').map(p => p.section.number)).toHaveLength(11)
    expect(planned.filter(p => p.mode === 'code').map(p => p.section.number)).toEqual(['12'])
  })

  it('a template section the plan does not place is drafted before the summary', () => {
    const order = orderByPlan([...sections, { id: 's9.5', number: '9.5', title: 'Audits' }], plan).filter(p => p.mode === 'draft').map(p => p.section.number)
    expect(order.slice(-3)).toEqual(['9.5', '1.1', '1.2'])
  })

  it('each section is given the drafted sections it depends on; the synopsis gets all, and adds no new facts', () => {
    const text = new Map(sections.map(s => [s.id, `<p>Text of ${s.number}</p>`]))
    const at = (n: string) => planned.findIndex(p => p.section.number === n)
    expect(earlierSectionsFor(planned, at('6.4'), id => text.get(id)).map(s => s.number)).toEqual(['5.4', '6.1'])
    expect(earlierSectionsFor(planned, at('1.1'), id => text.get(id))).toHaveLength(48)
    const block = planPromptBlock({ earlier: earlierSectionsFor(planned, at('1.1'), id => text.get(id)), rules: planned[at('1.1')]!.rules })
    expect(block).toContain('--- 3.1 Primary Objective and Endpoint ---\n<p>Text of 3.1</p>')
    expect(block).toContain('THIS SECTION SUMMARISES THE DOCUMENT')
    expect(earlierSectionsFor(planned, at('3.1'), id => text.get(id))).toEqual([])
    expect(planPromptBlock({ earlier: [], rules: {} })).toBe('')
  })
})

describe('main headings as introductions (plan v4)', () => {
  const plan = asBuildPlan(PLAN)!
  const sections = TEMPLATE.map(s => ({ ...s, id: `s${s.number}` }))
  const planned = orderByPlan(sections, plan)
  it('each heading right after the last of its own sub-sections, given those, adding no new facts', () => {
    const drafted = planned.filter(p => p.mode === 'draft').map(p => p.section.number)
    expect(drafted).toHaveLength(61)
    for (const h of ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11']) {
      const children = drafted.filter(n => n.startsWith(`${h}.`))
      expect(drafted.indexOf(h)).toBeGreaterThan(Math.max(...children.map(c => drafted.indexOf(c))))
    }
    const five = planned.find(p => p.section.number === '5')!
    expect(five).toMatchObject({ mode: 'draft', dependsOn: ['5.1', '5.2', '5.3', '5.4'], rules: { sectionIntro: true, noNewFacts: true } })
    expect(planned.find(p => p.section.number === '12')!.mode).toBe('code')
  })
  it('a deeper heading comes before its parent', () => {
    const deep = orderByPlan([...sections, { id: 's7.1.1', number: '7.1.1', title: 'Primary efficacy' }], plan).filter(p => p.mode === 'draft').map(p => p.section.number)
    expect(deep.indexOf('7.1')).toBeGreaterThan(deep.indexOf('7.1.1'))
    expect(deep.indexOf('7')).toBeGreaterThan(deep.indexOf('7.1'))
  })
  it('the template check no longer says headings keep the heading only', () => {
    expect(checkPlanAgainstTemplate(PLAN, TEMPLATE)).toHaveLength(4)
    expect(PLAN.headings).toBe('lead_in')
  })
})
