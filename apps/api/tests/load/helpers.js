// Shared k6 helpers for the ClinWrite API load scenarios.
// k6 scripts run under Goja (ES5-ish), so no TS, no modern bundling.
// Keep this file dependency-free.

import http from 'k6/http'
import { check } from 'k6'

export const BASE = __ENV.E2E_BASE_URL || 'http://localhost:3101'

/**
 * Mock-SSO login round-trip. Returns the aurora_session cookie value for
 * use in subsequent requests. The dev provider auto-approves — this is
 * how the Playwright smoke suite does it too (see apps/web/playwright).
 */
export function login() {
  const jar = http.cookieJar()

  const loginRes = http.get(`${BASE}/auth/login`, {
    redirects: 0,     // we want the Location header, not the follow
    jar,
    tags: { name: 'auth-login' },
  })
  check(loginRes, { 'auth/login 302': r => r.status === 302 })
  const callbackUrl = loginRes.headers['Location']

  const callbackRes = http.get(callbackUrl, {
    redirects: 0,
    jar,
    tags: { name: 'auth-callback' },
  })
  check(callbackRes, { 'auth/callback 302': r => r.status === 302 })

  // Return cookies collected into the jar; k6 will send them automatically
  // when we reuse this jar for subsequent requests.
  return jar
}

/** Fetch /auth/me with the given cookie jar. */
export function me(jar) {
  return http.get(`${BASE}/auth/me`, { jar, tags: { name: 'auth-me' } })
}

/** Standard list queries exercised by the baseline scenario. */
export function listRoutes(jar) {
  const res = http.batch([
    ['GET', `${BASE}/auth/me`, null, { jar, tags: { name: 'auth-me' } }],
    ['GET', `${BASE}/projects`, null, { jar, tags: { name: 'projects-list' } }],
    ['GET', `${BASE}/library/sections`, null, { jar, tags: { name: 'library-list' } }],
    ['GET', `${BASE}/notifications/me/unread-count`, null, { jar, tags: { name: 'notifications-unread-count' } }],
  ])
  check(res[0], { 'auth/me 200': r => r.status === 200 })
  check(res[1], { 'projects 200': r => r.status === 200 })
  check(res[2], { 'library 200': r => r.status === 200 })
  check(res[3], { 'notifications unread 200': r => r.status === 200 })
}
