# SSO end-to-end verification runbook

Procedure to walk the full sign-in flow against a real IdP once the WorkOS
tenant + test user are provisioned. Blocks the demo-env flip of
`VITE_BYPASS_AUTH=false` from this doc's success criteria.

## Prerequisites (procurement side — do first)

1. **WorkOS tenant** — create at [workos.com](https://workos.com), either
   dev tier (free) or production. Note the client id + API key.
2. **IdP connection** — WorkOS → Authentication → add either a Google/MS
   OIDC connection (fastest for testing) or configure SAML against your
   actual corporate IdP. The dev tier includes a built-in "test connection"
   that acts as a mock IdP for sanity-level walks.
3. **Test user** — in the IdP, create at least one user with an email in
   the domain registered to the connection. Give them a password you can
   type (if OIDC) or configure IdP-initiated SAML POST.
4. **Callback URL** — in WorkOS, add `https://api.clinwrite.ai/auth/callback`
   as an allowed redirect URL. For local dev, also add `http://localhost:3001/auth/callback`.
5. **Env vars on the API** — set in sops-encrypted `/opt/platform/env/api.env.enc`:
   - `WORKOS_API_KEY=sk_xxx`
   - `WORKOS_CLIENT_ID=client_xxx`
   - `SSO_PROVIDER=workos`

## Walk-through (what to click)

Steps assume the test user's email is `tester@clinwritedemo.ai` and the
WorkOS tenant is live.

1. **Prime the API** — restart `platform-api` systemd unit so it reads
   the new WORKOS_* envs.
   ```bash
   systemctl restart platform-api
   journalctl -u platform-api -n 50 | grep -i sso
   # expect: "SSO provider: workos (connection ok)"
   ```

2. **Set the UI env** — on your local workstation:
   ```bash
   cd apps/web
   echo 'VITE_API_URL=https://api.clinwrite.ai' >> .env.local
   echo 'VITE_BYPASS_AUTH=false' >> .env.local
   npm run dev
   ```

3. **Visit the dev UI** — `http://localhost:5173/`. Expected: immediate
   redirect to `/sign-in` because the AuthGuard sees no session.

4. **Click Sign in** — the UI calls `GET /auth/login` on the API; the API
   issues a 302 to WorkOS's hosted login page. Expected URL (after redirect):
   `https://api.workos.com/sso/authorize?...`.

5. **Authenticate with the test user** — enter the IdP credentials. The
   IdP posts back to the API's `/auth/callback` with the auth code.

6. **API exchanges the code** — the callback handler verifies the WorkOS
   JWT, creates a `Session` row, issues an `aurora_session` cookie
   (Domain=.clinwrite.ai in prod), and redirects to `CORS_ORIGIN`.

7. **Land on `/projects`** — if the user was previously created in our DB
   (via SCIM or manual seed), they see their projects. If not, they get
   a 403 explaining they haven't been provisioned yet.

8. **Verify the session cookie** — in DevTools → Application → Cookies →
   `demo.clinwrite.ai`:
   - Name: `aurora_session`
   - Domain: `.clinwrite.ai`
   - HttpOnly: ✓
   - Secure: ✓
   - SameSite: Lax

9. **Walk one authed API call** — click into a project, open a document.
   DevTools Network tab should show the request to `api.clinwrite.ai/documents/X`
   carrying the cookie and returning 200.

10. **Sign out** — click the user menu → Sign out. API should return 200,
    clear the cookie (same Domain/path attrs as set), and the UI
    redirects to `/sign-in`. Re-visiting `/projects` bounces to `/sign-in`
    (session is gone).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Infinite redirect loop between `/sign-in` and WorkOS | Callback URL not on allow-list | WorkOS → Redirect URIs → add exact match (including protocol + port) |
| 400 on `/auth/callback` with `invalid_state` | Session cookie not surviving the redirect; usually SameSite | Confirm `SESSION_COOKIE_DOMAIN=.clinwrite.ai` in API env + both subdomains proxied through Cloudflare |
| 403 after a successful auth | User exists in WorkOS but not in our `users` table | Seed the user (`prisma db seed`) OR wait for SCIM provisioning |
| CORS error on first authed request | `CORS_ORIGIN` on API doesn't match the UI origin | Check `/opt/platform/env/api.env.enc` has `CORS_ORIGIN=https://demo.clinwrite.ai` |
| Cookie set but not sent on `api.clinwrite.ai` request | Domain attribute missing or wrong | Confirm `SESSION_COOKIE_DOMAIN=.clinwrite.ai` is set and matches both subdomains |

## Automation (nice-to-have, not shipping now)

A full Playwright test exercising this walk against the real IdP would run
in CI but needs:
- A dedicated test tenant on WorkOS (not shared with real users)
- Test-user credentials in a GitHub secret (`SSO_TEST_PASSWORD`)
- Playwright configured to run with `baseURL=https://demo.clinwrite.ai`
  and the real WorkOS callback.

Spec'd under BACKLOG.md "scope-later but shippable" as a future deliverable.

## Success criteria for cutover

- All 10 walk-through steps pass without manual intervention
- Common failures table (above) checked against — none active
- One real user walks the flow end-to-end and signs a document in Module A
  (exercises the Session + RBAC + audit chain + e-sig flow in one path)

Only then flip `VITE_BYPASS_AUTH=false` in the deployed demo build.
