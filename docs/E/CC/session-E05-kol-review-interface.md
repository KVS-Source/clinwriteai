# Session E05 — KOL Review Interface
**Screen:** sE05 · KOL Review Interface
**Route:** `/kol-review/:token` — PUBLIC ROUTE, registered at router root outside AppShell
**Component:** `src/modules/ideation-publishing/screens/KOLReviewInterface.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE05-kol-review-interface.html`
**Data:** `src/data/kolContacts.json`, `src/data/ideationContentCards.json`
**Store:** none (stateless — local component state only, no Zustand store)

---

## CRITICAL — PUBLIC ROUTE

This is the only Aurora screen with no authentication. The route is registered at the **router root level** (FR-E-010, AC-E-023), not inside the AppShell or any auth-protected route tree:

```typescript
// router/index.tsx — at the ROOT, not inside AppShell
{ path: 'kol-review/:token', element: <KOLReviewInterface /> }
```

**On valid token:** Render the review interface directly — no auth check, no login redirect.
**On invalid/expired token:** Render a plain public-facing "link expired" page — never the Aurora login page.
The token for the demo is `kol-tok-001-demo`. KOL email: `j.hartley@example.ac.uk`.

---

## What to Build

The KOL's review interface. Prof. James Hartley reviews 3 content cards for ip-001, approves all, leaves a comment on c-003. No Aurora login, no navigation shell, no sidebar.

---

## Screen Anatomy

Minimal — no AppShell, no sidebar. Clean public interface.

**Header (no Aurora shell):**
- "VELORA-301 Efficacy Communications · KOL Review"
- "Invited by GenBioCa Sciences · Secure one-time link · Expires 28 Oct 2026"
- "Prof. James Hartley · University of Edinburgh"

**Three card review panels (from `ideationContentCards.json` + `kolContacts.json` decisions):**

**c-001 — Primary PFS Efficacy Result:**
- Source passage (read-only): "Veloricept plus pembrolizumab demonstrated…HR 0.61…"
- `ProvenanceChip` visible: "Source: KOL Summary §3.2 → CSR v1.0 → Module A"
- Decision shown: `✓ Approved` (green — from `kolContacts.json` decision for c-001)
- No comment

**c-002 — Safety Profile:**
- Source passage read-only
- `ProvenanceChip` visible
- Decision: `✓ Approved` (green)
- No comment

**c-003 — Subgroup Consistency:**
- Source passage read-only
- `ProvenanceChip` visible
- Decision: `✓ Approved` (green) — with comment:
  - Comment field: "PD-L1 subgroup language — please ensure consistency with current ESMO guidelines."
  - (from `kolContacts.json` reviewDecisions[2].comment)

**Overall sign-off panel:**
- "Prof. James Hartley · University of Edinburgh"
- Signed off: "21 Oct 2026 14:00 UTC" (from `kolContacts.json`.signedOffAt)
- "This review is complete. Your decisions have been recorded. This link is now closed."
- Immutability note: "KOL review decisions are immutable once submitted."

---

## Data Wiring

```typescript
// sE05 uses NO authenticated API client — public fetch only
// Token from URL param
const { token } = useParams()
// Demo token: 'kol-tok-001-demo'

// MSW handler for public route (no auth header)
// GET /kol-review/:token/data → returns kolContacts.json (kol-001) + ideationContentCards.json (c-001, c-002, c-003)
// This is a READ — not the submit endpoint

// Submit (if not yet signed off — demo shows already signed)
const submitReview = (decisions: object[]) =>
  fetch(`/api/kol-review/${token}/submit`, {
    method: 'POST',
    body: JSON.stringify({ decisions }),
    // NOTE: no Authorization header — public endpoint
  })

// Invalid token
if (!kolData) {
  return <KOLLinkExpiredPage />  // plain public page, no Aurora chrome
}
```

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Navigating to `/kol-review/kol-tok-001-demo` renders the review interface without any login redirect and without the Aurora AppShell/sidebar.
2. All three cards show `ProvenanceChip` without any interaction required.
3. c-001 and c-002 show "✓ Approved" decisions. c-003 shows "✓ Approved" plus the KOL comment "PD-L1 subgroup language — please ensure consistency with current ESMO guidelines."
4. The sign-off panel shows "Signed off: 18 Oct 2026 14:32 UTC" and "This link is now closed."
5. Navigating to `/kol-review/invalid-token` shows the public "link expired" page — not the Aurora login page.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E05-kol-review-interface.md and execute.
Build KOLReviewInterface exactly as specified, run all 3 validation passes, and report results.
Critical: this screen is a public route at the router root — no auth check, no AppShell, no sidebar.
```
