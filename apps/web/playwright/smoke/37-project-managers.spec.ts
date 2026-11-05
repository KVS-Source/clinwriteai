// QA regression — the Project managers field: on New Project the creator is the first PM and can pick
// others from the list or invite them by email; on Project Settings each change applies straight away.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/37-project-managers.spec.ts
//
// Everything is answered inside the page, so no account, invitation or project is created. The rules
// themselves are in apps/api/src/modules/projects/project-managers.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-PMS'

type Stub = { noManagers?: boolean; role?: string; language?: string; refuseEmail?: boolean; emailQueued?: boolean; lastPm?: boolean }
type Sent = { created: Array<{ projectManagers: { userIds: string[]; inviteEmails: string[] } }>; added: string[]; invited: string[]; resent: string[]; removed: string[] }

async function open(page: Page, path: string, stub: Stub = {}) {
  await page.addInitScript(({ project, stub }) => {
    localStorage.setItem('clinwrite.uiLanguage', stub.language ?? 'en')
    if ((stub.role ?? 'pm') === 'pm') localStorage.setItem('clinwrite.demo.currentUserId', 'user-sa')
    const sent: Sent = { created: [], added: [], invited: [], resent: [], removed: [] }
    ;(window as unknown as { __sent: Sent }).__sent = sent
    const me = { id: 'user-sa', email: 'me@x.test', name: 'Mia Manager', role: stub.role ?? 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const dir = [
      { id: 'user-sa', name: 'Mia Manager', email: 'me@x.test', status: 'active' },
      { id: 'u-boss', name: 'Bo Boss', email: 'bo@x.test', status: 'active' },
      { id: 'u-new', name: 'Nia New', email: 'nia@x.test', status: 'invited' },
    ]
    const row = (d: { id: string; name: string; email: string; status: string }, isCreator = false) => ({ ...d, addedBy: isCreator ? d.id : 'user-sa', addedAt: '2026-11-01T00:00:00Z', isCreator })
    let managers = stub.noManagers ? [] : [row(dir[0]!, true)]
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    const project_ = { id: project, name: 'PM Project', shortTitle: 'PMP', status: 'ongoing', phase: 'Phase 1', therapeuticArea: 'Oncology', tenantId: null, activeModules: ['A'], submissionCountries: ['US'], client: '', indication: 'x', team: [], startDate: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' }
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : {}
      if (/\/auth\/me(\?.*)?$/.test(url)) return json(me)
      if (url.includes('/projects/pm-directory')) return me.role === 'pm' ? json(dir) : json({ error: 'forbidden' }, 403)
      if (url.includes(`/projects/${project}/managers/invite`)) {
        sent.invited.push(body.email!)
        if (stub.refuseEmail) return json({ error: 'pm_email_not_pm', message: 'server words' }, 422)
        managers = [...managers, row({ id: 'u-x', name: 'Xi Invited', email: body.email!, status: 'invited' })]
        return json({ managers, emailQueued: stub.emailQueued ?? true }, 201)
      }
      const resend = url.match(/\/managers\/([^/]+)\/resend/)
      if (resend) { sent.resent.push(resend[1]!); return json({ emailQueued: true }) }
      const del = url.match(/\/managers\/([^/?]+)$/)
      if (del && method === 'DELETE') {
        sent.removed.push(del[1]!)
        if (stub.lastPm) return json({ error: 'last_project_manager', message: 'server words' }, 409)
        managers = managers.filter(m => m.id !== del[1])
        return json({ managers })
      }
      if (url.includes(`/projects/${project}/managers`)) {
        if (method === 'POST') {
          sent.added.push(body.userId!)
          const d = dir.find(x => x.id === body.userId)!
          managers = [...managers, row(d)]
          return json({ managers, emailQueued: d.status === 'invited' ? true : null }, 201)
        }
        return json(managers)
      }
      if (url.includes(`/projects/${project}/status`)) return json({ status: 'ongoing', next: [], history: [] })
      if (new RegExp(`/projects/${project}(\\?.*)?$`).test(url)) return json(project_)
      if (/\/projects(\?.*)?$/.test(url)) {
        if (method === 'POST') {
          sent.created.push(body as never)
          if (stub.refuseEmail) return json({ error: 'pm_email_not_pm', message: 'server words', email: 'x' }, 422)
          return json({ ...body, status: 'initiated', pmInvites: (body as unknown as Sent['created'][0]).projectManagers.inviteEmails.map(email => ({ email, emailQueued: stub.emailQueued ?? true })) }, 201)
        }
        return json([project_])
      }
      if (url.includes('/taxonomy') || url.includes('therapeutic')) return json([{ id: 't1', label: 'Oncology', active: true, status: 'active' }])
      const path = new URL(url, location.href).pathname
      if (!path.startsWith('/src/') && !path.startsWith('/node_modules/') && !path.startsWith('/@')) return json([], 200)
      return real(input, init)
    }
  }, { project: PROJECT, stub })
  await page.goto(path, { waitUntil: 'domcontentloaded' })
}

const sent = (page: Page) => page.evaluate(() => (window as unknown as { __sent: Sent }).__sent)
const shot = (page: Page, name: string) => (process.env.E2E_SCREENSHOT_DIR ? page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png` }) : Promise.resolve())

async function openNewProject(page: Page, stub: Stub = {}) {
  await open(page, '/projects', stub)
  await page.locator('[data-action="new-project"]').click({ timeout: 60_000 })
  await expect(page.locator('[data-form="new-project"]')).toBeVisible()
}

test.describe('New Project', () => {
  test('the creator is the first PM, and is not offered again in the list', async ({ page }) => {
    await openNewProject(page)
    const chosen = page.locator('[data-pm-chosen]')
    await expect(chosen.locator('[data-pm-row="user-sa"]')).toContainText('Mia Manager (you)')
    await expect(chosen.locator('[data-pm-creator]')).toHaveText('Creator')
    await expect(page.locator('[data-pm-remove="user-sa"]')).toHaveCount(0)
    await expect(page.locator('[data-pm-option="u-boss"]')).toContainText('bo@x.test')
    await expect(page.locator('[data-pm-option="u-new"] [data-pm-invited]')).toHaveText('Invited')
    await expect(page.locator('[data-pm-option="user-sa"]')).toHaveCount(0)
    await page.locator('[data-section="new-project-managers"]').scrollIntoViewIfNeeded()
    await shot(page, 'pm-create')
  })

  test('the list can be searched, and picking someone moves them across', async ({ page }) => {
    await openNewProject(page)
    await page.locator('[data-pm-search]').fill('nia')
    await expect(page.locator('[data-pm-option="u-boss"]')).toHaveCount(0)
    await page.locator('[data-pm-add="u-new"]').click()
    await expect(page.locator('[data-pm-chosen] [data-pm-row="u-new"]')).toBeVisible()
    await expect(page.locator('[data-pm-option="u-new"]')).toHaveCount(0)
    await expect(page.locator('[data-pm-list-empty]')).toBeVisible()
    await page.locator('[data-pm-remove="u-new"]').click()
    await expect(page.locator('[data-pm-option="u-new"]')).toBeVisible()
  })

  test('an email has to look like one, and can\'t be added twice', async ({ page }) => {
    await openNewProject(page)
    const box = page.locator('[data-pm-invite-email]')
    const go = page.locator('[data-pm-invite-submit]')
    await box.fill('not-an-email')
    await expect(go).toBeDisabled()
    await box.fill(' Boss@Company.com ')
    await go.click()
    await expect(page.locator('[data-pm-row="boss@company.com"]')).toContainText('Will be invited')
    await expect(box).toHaveValue('')
    await box.fill('boss@company.com')
    await expect(go).toBeDisabled()
    await box.fill('me@x.test')
    await expect(go).toBeDisabled()
  })

  // The dev-only MSW badge can sit over the button, so the click is sent to the button itself.
  async function submit(page: Page) {
    const button = page.locator('[data-form="new-project"] button[type="submit"]')
    await expect(button).toBeEnabled()
    await button.dispatchEvent('click')
  }

  async function fillBasics(page: Page) {
    const form = page.locator('[data-form="new-project"]')
    await form.locator('input').first().fill('Velora Study')
    await form.locator('select').first().selectOption({ index: 1 })
  }

  test('creating sends the PMs with the project', async ({ page }) => {
    await openNewProject(page)
    await fillBasics(page)
    await page.locator('[data-pm-add="u-boss"]').click()
    await page.locator('[data-pm-invite-email]').fill('new.boss@company.com')
    await page.locator('[data-pm-invite-email]').press('Enter')
    await expect(page.locator('[data-form="new-project"]')).toBeVisible() // Enter in the box doesn't submit the form
    await submit(page)
    await expect(page).toHaveURL(/\/projects\/PROJ-VELORA-STUDY$/, { timeout: 30_000 })
    const { created } = await sent(page)
    expect(created[0]!.projectManagers).toEqual({ userIds: ['u-boss'], inviteEmails: ['new.boss@company.com'] })
  })

  test('an email that belongs to someone who isn\'t a PM is explained, and the form stays open', async ({ page }) => {
    await openNewProject(page, { refuseEmail: true })
    await fillBasics(page)
    await page.locator('[data-pm-invite-email]').fill('writer@company.com')
    await page.locator('[data-pm-invite-submit]').click()
    await submit(page)
    const alert = page.locator('[data-form="new-project"] [role="alert"]')
    await expect(alert).toContainText('Ask your tenant admin to change their role')
    await expect(page.locator('[data-form="new-project"]')).toBeVisible()
  })

  test('if an invitation can\'t be sent, it opens the project settings so it can be resent', async ({ page }) => {
    await openNewProject(page, { emailQueued: false })
    await fillBasics(page)
    await page.locator('[data-pm-invite-email]').fill('boss@company.com')
    await page.locator('[data-pm-invite-submit]').click()
    await submit(page)
    await expect(page).toHaveURL(/\/projects\/PROJ-VELORA-STUDY\/settings$/, { timeout: 30_000 })
  })
})

test.describe('Project Settings', () => {
  const settings = `/projects/${PROJECT}/settings`

  test('shows the managers, and adding from the list applies at once', async ({ page }) => {
    await open(page, settings)
    const section = page.locator('[data-section="project-managers"]')
    await expect(section.locator('[data-pm-row="user-sa"] [data-pm-creator]')).toBeVisible({ timeout: 60_000 })
    await section.locator('[data-pm-add="u-boss"]').click()
    await expect(section.locator('[data-pm-row="u-boss"]')).toBeVisible()
    await expect(section.locator('[data-pm-option="u-boss"]')).toHaveCount(0)
    expect((await sent(page)).added).toEqual(['u-boss'])
    await shot(page, 'pm-settings')
  })

  test('inviting by email says the email went, shows them as invited, and offers resend', async ({ page }) => {
    await open(page, settings)
    const section = page.locator('[data-section="project-managers"]')
    await section.locator('[data-pm-invite-email]').fill('boss@company.com', { timeout: 60_000 })
    await section.locator('[data-pm-invite-submit]').click()
    await expect(section.locator('[data-pm-notice]')).toHaveText('Invitation email sent to boss@company.com.')
    const row = section.locator('[data-pm-row="u-x"]')
    await expect(row.locator('[data-pm-invited]')).toBeVisible()
    await row.locator('[data-pm-resend="u-x"]').click()
    await expect.poll(async () => (await sent(page)).resent).toEqual(['u-x'])
  })

  test('says so when the invitation email could not be sent', async ({ page }) => {
    await open(page, settings, { emailQueued: false })
    const section = page.locator('[data-section="project-managers"]')
    await section.locator('[data-pm-invite-email]').fill('boss@company.com', { timeout: 60_000 })
    await section.locator('[data-pm-invite-submit]').click()
    await expect(section.locator('[data-pm-notice]')).toContainText('could not be sent')
  })

  test('a refused email is explained', async ({ page }) => {
    await open(page, settings, { refuseEmail: true })
    const section = page.locator('[data-section="project-managers"]')
    await section.locator('[data-pm-invite-email]').fill('writer@company.com', { timeout: 60_000 })
    await section.locator('[data-pm-invite-submit]').click()
    await expect(section.locator('[data-pm-error]')).toContainText('Ask your tenant admin to change their role')
  })

  test('removing asks first, and removing the last PM is explained', async ({ page }) => {
    await open(page, settings, { lastPm: true })
    page.on('dialog', d => void d.accept())
    const section = page.locator('[data-section="project-managers"]')
    await section.locator('[data-pm-remove="user-sa"]').click({ timeout: 60_000 })
    await expect(section.locator('[data-pm-error]')).toContainText('at least one active project manager')
    await expect(section.locator('[data-pm-row="user-sa"]')).toBeVisible()
  })

  test('a project with no PMs listed says so, and the PM can add themselves', async ({ page }) => {
    await open(page, settings, { noManagers: true })
    const section = page.locator('[data-section="project-managers"]')
    await expect(section.locator('[data-pm-none]')).toBeVisible({ timeout: 60_000 })
    await section.locator('[data-pm-add="user-sa"]').click()
    await expect(section.locator('[data-pm-row="user-sa"]')).toBeVisible()
    await expect(section.locator('[data-pm-none]')).toHaveCount(0)
  })

  test('someone who isn\'t a PM doesn\'t see the section', async ({ page }) => {
    await open(page, settings, { role: 'contributor' })
    await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}$`), { timeout: 60_000 })
    await expect(page.locator('[data-section="project-managers"]')).toHaveCount(0)
  })

  test('the section is Japanese when the language is Japanese', async ({ page }) => {
    await open(page, settings, { language: 'ja' })
    const section = page.locator('[data-section="project-managers"]')
    await expect(section.locator('[data-pm-creator]')).toHaveText('作成者', { timeout: 60_000 })
    await expect(section).toContainText('プロジェクト マネージャー')
    await expect(section.locator('[data-pm-invite-submit]')).toHaveText('招待')
  })
})
