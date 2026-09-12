# Session PM04 — Rate Card Admin
**Screen:** sPM12 · Rate Card Admin
**Route:** `/super-admin/rate-card`
**Component:** `src/platform/screens/RateCardAdmin.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM12-rate-card-admin.html`
**Data:** `ratecards.json`
**Store:** `superAdminStore`
**Access:** `<SuperAdminGuard>`

---

## What to Build

Two-column: version history list (left ~260px) · active rate card detail (right). Current user: Alex Thornton · Super admin. v1.1 active, v1.0 archived.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Left — version history:**
- Header: "Rate card versions" · "+ New rate card →" (navy primary)
- `{{ versions }}` loop: `{{ v.label }}` / `{{ v.status }}` / `{{ v.effective }}` / `{{ v.setBy }}`
- v1.1: "Rate Card v1.1 · ✓ Active (navy chip) · Effective 01 Jul 2026 · Alex Thornton"
- v1.0: "Rate Card v1.0 · 🔒 Archived (grey) · 01 Jan 2026 → 30 Jun 2026 · Alex Thornton"
- "Archived rate cards are read-only. Rate cards cannot be backdated."

**Right — active rate card (v1.1):**
- `{{ heading }}` = "Rate Card v1.1 · USD · exclusive of sales tax"
- `{{ validity }}` = "Effective 01 Jul 2026 · Valid until 31 Dec 2026"
- `{{ editLabel }}` = "Edit rate card →" (active, navy outline) OR disabled for archived
- "⚠ Expires in 113 days · Super Admin receives a reminder 7 days before expiry. **An expired rate card blocks new purchases until a successor is published.**"
- Rate table — `{{ rates }}` loop: `{{ r.module }}` / `{{ r.service }}` / `{{ r.unit }}` / `{{ r.rate }}`
- "10 rate lines · USD · exclusive of sales tax"
- **Disruption Rate Card note (on v1.0 only):** "This is the AURORA Disruption Rate Card (PRD §10.2) — the platform default. Super Admin may replace it with a custom rate card. The Disruption Rate Card represents market disruption pricing versus standard consultancy rates."

**Archived view (v1.0 selected):**
- "🔒 Archived — read-only · This version governed transactions in its effective window. Its rates remain citable on historical invoices and cannot be edited."
- `{{ editLabel }}` = disabled / locked state

---

## Data Wiring

```typescript
const { ratecards, activeVersion, setActiveVersion } = useSuperAdminStore()
// MSW: GET /api/super-admin/rate-cards → ratecards.json

// heading = `Rate Card ${v.version} · USD · exclusive of sales tax`
// validity = `Effective ${v.effectiveFrom} · Valid until ${v.validUntil}`
// editLabel = v.status === 'active' ? 'Edit rate card →' : '🔒 Locked'

// No backdating: effective date picker rejects past dates
// Expired rate card detection:
const isExpired = new Date(activeRatecard.validUntil) < new Date()
// If isExpired: block purchases in sPM11 and sPM13
```

---

## Implementation Notes (from design review)

- An expired rate card (`validUntil` past today) **blocks new purchases** in sPM11 and sPM13 — derive from `ratecards.json` `validUntil`, no extra fixture field
- The **"AURORA Disruption Rate Card"** note uses "AURORA" intentionally — this is a PRD §10.2 contractual reference, **not** a product name. Do NOT replace with ClinWrite.AI
- v1.0 `isDisruptionRateCard: true` — renders the Disruption Rate Card note
- `{{ rates }}` wires from `v.rates` array — 10 rows for v1.1
- "+ New rate card →" opens a form with effective date picker — date must be today or future, else show: "Effective date cannot be in the past. Please select a current or future date."

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. v1.1 shows navy "✓ Active" chip. v1.0 shows grey "🔒 Archived" chip. (AC-PM-017)
2. Selecting v1.0 shows the Disruption Rate Card note with "AURORA" preserved exactly.
3. v1.0 "Edit rate card" is disabled/locked. v1.1 "Edit rate card →" is active.
4. "⚠ Expires in 113 days" warning is visible on v1.1. Contains "An expired rate card blocks new purchases until a successor is published."
5. "+ New rate card →" form rejects a past effective date with "Effective date cannot be in the past."

---

## CC Prompt

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM15-rate-card-admin.md and execute.
Build RateCardAdmin exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM12-rate-card-admin.html.
Run all 3 validation passes and report results before awaiting Session PM16.
```
