// QA regression — a project manager chairing a CRM can schedule, start and complete it.
//
// The admin user list answers 403 to a PM, and most projects have no legacy team rows, so the schedule
// form used to offer them only themselves. It now lists the project's real candidates.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-X \
//     npx playwright test playwright/smoke/21-pm-chairs-crm.spec.ts
//
// The people list is the real API. The document and meeting are answered inside the page; nothing is written.

import { test, expect } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'
const DOC = 'DOC-E2E-CRM'
test.setTimeout(120_000)

test('the PM schedules a CRM with themselves as chair, then starts and completes it', async ({ page }) => {
  await page.addInitScript(({ projectId, doc, persona }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const state: {
      status: string
      meeting: Record<string, unknown> | null
      scheduled?: { chairId: string; attendees: Array<{ userId: string }> }
      calls: string[]
    } = { status: 'in-review', meeting: null, calls: [] }
    ;(window as unknown as { __crm: typeof state }).__crm = state
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (new RegExp(`/projects/${projectId}/documents(\\?.*)?$`).test(url) && method === 'GET') {
        return json([{ id: doc, projectId, type: 'protocol', title: 'CRM test', status: state.status, stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-20T09:00:00Z', sections: [] }])
      }
      if (url.includes(`/documents/${doc}/crm/access`)) return json({ canSchedule: true })
      if (url.includes(`/documents/${doc}/crm`)) {
        if (method === 'GET') return json(state.meeting ? [state.meeting] : [])
        const body = JSON.parse(String(init?.body))
        state.scheduled = body
        state.calls.push('schedule')
        state.meeting = {
          id: 'm-e2e', documentId: doc, documentTitle: 'CRM test', meetingRef: 'CRM-E2E', version: 'v0.1',
          date: body.scheduledDate, startTime: body.startTime, endTime: body.endTime, status: 'scheduled',
          chair: { userId: body.chairId, name: 'Chair', initials: 'C', role: 'pm', raci: 'A' }, attendees: [],
          commentIds: [], resolvedIds: [], activeId: null, pendingIds: [],
        }
        return json(state.meeting, 201)
      }
      if (url.includes('/crm/m-e2e/start')) {
        state.calls.push('start')
        state.status = 'crm-in-progress'
        state.meeting!.status = 'in_progress'
        state.meeting!.startedAt = '2026-11-04T09:00:00Z'
        return json(state.meeting)
      }
      if (url.includes('/crm/m-e2e/complete')) {
        state.calls.push('complete')
        state.status = 'pending-signature'
        state.meeting!.status = 'complete'
        state.meeting!.endedAt = '2026-11-04T10:00:00Z'
        return json(state.meeting)
      }
      if (url.includes('/crm/m-e2e/ai-drafts')) return json({ meetingId: 'm-e2e', drafts: [], transcript: null })
      if (url.includes('/crm/m-e2e/resolutions')) return json([])
      if (url.includes(`/documents/${doc}/`)) return json([])
      return real(input, init)
    }
  }, { projectId: PROJECT_ID, doc: DOC, persona: PM_PERSONA })

  await page.goto(`/projects/${PROJECT_ID}/clinical-writing/crm`, { waitUntil: 'domcontentloaded' })
  const form = page.locator('[data-crm-schedule]')
  await expect(form).toBeVisible({ timeout: 60_000 })

  // The PM is the default chair, and has real people to choose from.
  const chair = page.locator('[data-crm-chair]')
  await expect(chair).toHaveValue(PM_PERSONA)
  await expect.poll(() => chair.locator('option').count(), { timeout: 30_000 }).toBeGreaterThan(1)
  const attendee = form.locator('input[type="checkbox"]').first()
  await expect(attendee).toBeVisible()
  await attendee.check()

  await page.locator('[data-crm-schedule-submit]').click()
  await expect(page.locator('[data-crm-start]')).toBeVisible({ timeout: 15_000 })
  const scheduled = await page.evaluate(() => (window as unknown as { __crm: { scheduled: { chairId: string; attendees: unknown[] } } }).__crm.scheduled)
  expect(scheduled.chairId).toBe(PM_PERSONA)
  expect(scheduled.attendees).toHaveLength(2)

  await page.locator('[data-crm-start]').click()
  await expect(page.locator('[data-screen="crm-module"]')).toHaveAttribute('data-meeting-status', 'in_progress', { timeout: 15_000 })

  await page.locator('[data-crm-end]').click()
  await expect(page.locator('[data-crm-complete]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-crm-error]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __crm: { calls: string[] } }).__crm.calls)).toEqual(['schedule', 'start', 'complete'])
})

test('someone who may not schedule sees why, and no form', async ({ page }) => {
  await page.addInitScript(({ projectId, doc, persona }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new RegExp(`/projects/${projectId}/documents(\\?.*)?$`).test(url)) {
        return json([{ id: doc, projectId, type: 'protocol', title: 'CRM test', status: 'in-review', stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-20T09:00:00Z', sections: [] }])
      }
      if (url.includes(`/documents/${doc}/crm/access`)) return json({ canSchedule: false })
      if (url.includes(`/documents/${doc}/`)) return json([])
      return real(input, init)
    }
  }, { projectId: PROJECT_ID, doc: DOC, persona: PM_PERSONA })

  await page.goto(`/projects/${PROJECT_ID}/clinical-writing/crm`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-crm-schedule-not-allowed]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-crm-schedule]')).toHaveCount(0)
})

test('someone who may not resolve sees the comment and why, with the decision buttons off', async ({ page }) => {
  await page.addInitScript(({ projectId, doc, persona }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const meeting = {
      id: 'm-e2e', documentId: doc, documentTitle: 'CRM test', meetingRef: 'CRM-E2E', version: 'v0.1',
      date: '2026-11-04T09:00:00Z', startTime: '09:00', endTime: '10:00', status: 'in_progress', startedAt: '2026-11-04T09:00:00Z',
      chair: { userId: persona, name: 'Chair', initials: 'C', role: 'pm', raci: 'A' }, attendees: [],
      commentIds: ['CMT-E2E'], resolvedIds: [], activeId: null, pendingIds: ['CMT-E2E'],
    }
    const comment = { id: 'CMT-E2E', documentId: doc, sectionRef: '§1', reviewerId: 'u2', reviewerName: 'Reviewer', reviewerInitials: 'R', text: 'Please fix.', severity: 'major', status: 'open', age: 'now', canResolve: false }
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new RegExp(`/projects/${projectId}/documents(\\?.*)?$`).test(url)) {
        return json([{ id: doc, projectId, type: 'protocol', title: 'CRM test', status: 'crm-in-progress', stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-20T09:00:00Z', sections: [] }])
      }
      if (url.includes(`/documents/${doc}/crm/access`)) return json({ canSchedule: true })
      if (url.includes(`/documents/${doc}/crm`)) return json([meeting])
      if (url.includes(`/documents/${doc}/comments`)) return json([comment])
      if (url.includes('/crm/m-e2e/ai-drafts')) return json({ meetingId: 'm-e2e', drafts: [], transcript: null })
      if (url.includes('/crm/m-e2e/resolutions')) return json([])
      if (url.includes(`/documents/${doc}/`)) return json([])
      return real(input, init)
    }
  }, { projectId: PROJECT_ID, doc: DOC, persona: PM_PERSONA })

  await page.goto(`/projects/${PROJECT_ID}/clinical-writing/crm`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-resolve-not-allowed]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-resolve="accept"]')).toBeDisabled()
  await expect(page.locator('[data-crm-end]')).toBeVisible()
})
