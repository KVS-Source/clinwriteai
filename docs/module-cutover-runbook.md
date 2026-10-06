# Module cutover runbook

Per-module checklist for flipping a `VITE_MOCK_<MODULE>` toggle from `on`
to `off` on the demo build. Follow top to bottom for each module in the
order recommended by `docs/BACKLOG.md` (PROJECTS → AUTH → A → B → C → D → E).

## Prerequisites (one-time, before module 1)

- [ ] API deployed to `api.clinwrite.ai`, `GET /health` returns 200
- [ ] Demo DB seeded (`npm --workspace=apps/api run db:seed` — includes
      1 doc + 1 pub + 1 med-content + 1 submission + 1 ideation artefact
      under `PROJ-VELORA`)
- [ ] `SESSION_COOKIE_DOMAIN=.clinwrite.ai` set in
      `/opt/platform/env/api.env.enc`
- [ ] `CORS_ORIGIN=https://demo.clinwrite.ai` in the same env file
- [ ] Browser DevTools open on the Network tab for every manual check

## For each module

### 1. Shape alignment check (pre-flip)

Before flipping the toggle, run a shape audit:

- [ ] Compare the module's MSW handler responses (apps/web/src/mocks/handlers/*.ts)
      against the real API's responses (`curl` the running API)
- [ ] Any field the UI reads that the API doesn't return → add it to the
      API's response (handler-level transform or a `.select` tweak)
- [ ] Any extra field the API returns → fine, UI ignores unused fields
- [ ] Date-typed fields: Prisma returns Date objects, JSON serialises
      to ISO strings. UI usually expects strings. Confirm.

### 2. Flip the toggle

In `apps/web/.env.demo`:

```diff
- VITE_MOCK_<MODULE>=on
+ VITE_MOCK_<MODULE>=off
```

Commit the change. Deploy script (`infra/standalone/scripts/deploy.sh`
or `deploy-bluegreen.sh`) picks up `.env.demo` and bakes the toggles
into the SPA bundle at build time.

### 3. Deploy

- [ ] CI build green (`web` job + `web-integration` job both pass)
- [ ] Deploy workflow finishes (watch `.github/workflows/deploy-demo.yml`)
- [ ] `/health` on `api.clinwrite.ai` still 200
- [ ] `/ready` returns 200 with postgres + redis both `ok`

### 4. Manual smoke (10 flows, ~15 minutes)

Walk the top flows for the module in a browser. The specific flows per
module are different — baseline list for all:

| Flow | What breaks tells you |
|---|---|
| Load module landing page | 500 on API → check API logs; empty state → check seed |
| Create a resource | 400 → shape mismatch; 403 → RBAC gap; 409 → unique constraint |
| List resources (search / filter) | wrong order → sort key diff; missing rows → tenant filter bug |
| Open a detail view | 404 → id format mismatch; empty sections → nested include missing |
| Edit + save | optimistic update rolls back → mutation didn't invalidate right query |
| Delete / archive | undo button missing → UI doesn't know about the soft-delete column |
| Rate-limit floor | 429 at N+1 requests → correct behaviour; otherwise rate-limit not Redis-backed |
| Session expiry | force-expire cookie, next click → bounce to /sign-in with no toast flash |
| Error toast rendering | force a 500 on API, UI shows red toast with request-id | | |
| WCAG audit | Chrome DevTools → Lighthouse → Accessibility ≥ 95 |

### 5. Rollback plan

If anything above fails:

- [ ] Flip the toggle back: `VITE_MOCK_<MODULE>=on` in `.env.demo`,
      commit, deploy
- [ ] Open a GH issue naming the failing flow + API response + browser trace
- [ ] Re-run the shape audit against the specific endpoint

### 6. Post-cutover

- [ ] Delete the module's MSW handlers (if no longer needed)
      OR leave in place with `VITE_MOCK_<MODULE>=force` as a canary
      (if you want to compare mock vs real responses during dev)
- [ ] Mark the module cut over in `docs/BACKLOG.md`'s "What's shipped"
      rollup
- [ ] Update `docs/sso-e2e-runbook.md` success criteria if this is the
      first module to require real auth (AUTH toggle)

## Module-specific notes

### PROJECTS (first cutover)

Shape gaps caught during shape audit (Batch 37):
- API's `/projects` list didn't include `team` array → fixed by adding
  `include: { teamMembers: true }` + a `projectShape()` mapper
- MSW fixture included nested study data (`VELORA-301`, `ATLAS-TB`); seed
  mirrors the same ids (`PROJ-VELORA`, `PROJ-ATLAS-TB`)

### AUTH (second — do only after SSO E2E runbook passes)

Depends on WorkOS tenant provisioning. See `docs/sso-e2e-runbook.md` —
walk all 10 steps before flipping. BYPASS_AUTH stays `true` in dev; the
flip only applies to the deployed demo build via `VITE_BYPASS_AUTH=false`
in `.env.demo`.

### MODULE_A (largest, do third)

Covers documents + versions + sections + comments + checklist + voice
notes + CRM + TLF + signatures + presence. ~44 API routes. Expect the
longest smoke session. The CRM meeting lifecycle (schedule → start →
resolve comments → complete → doc flips to pending_signature) is the
single most important flow — it exercises the state machine + audit
chain + comment linkage in one path.

### MODULE_B..E

Mirror MODULE_A pattern — each has its own state machine + sub-resources.
Peer-review response-letter assembly in B, pre-MLR + agentic report in C,
HA correspondence + safety reports + ODD in D, DOI + Dublin Core + KOL
reminders in E are the ones most likely to surface shape gaps.
