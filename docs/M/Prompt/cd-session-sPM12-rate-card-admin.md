# CD Session — sPM12 · Rate Card Admin
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM12-rate-card-admin.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/super-admin/rate-card`
**Phase:** Phase 4
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM12** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM12 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM12 — Rate Card Admin

**File:** `aurora-sPM12-rate-card-admin.html`
**Route:** `/super-admin/rate-card`
**Current user:** Alex Thornton · Super Admin

**Layout:** Left: version history list (~260px). Right: active rate card detail table.

**Left — Version history:**
Header: "Rate Card Versions"
"+ New rate card" button (navy primary)

Version list (stacked):
- `v1.1 · Active` (navy chip) · Effective 01 Jul 2026 · Set by Alex Thornton
- `v1.0 · Archived` (grey) · 01 Jan 2026 → 30 Jun 2026 · Alex Thornton

Immutability note: "Archived rate cards are read-only. Rate cards cannot be backdated."

**Right — v1.1 Active rate card:**
Header: "Rate Card v1.1 · Effective 01 Jul 2026 · Valid until: 31 Dec 2026"
Expiry warning (amber chip): "⚠ Expires in 113 days · Super Admin will receive a 7-day reminder"

Table (Module · Service type · Unit · Rate (GBP)):
| Module | Service type | Unit | Rate |
|--------|-------------|------|------|
| A Clinical Writing | CSR Authoring | per token (1K) | £0.50 |
| A Clinical Writing | Document Review | per hour | £150 |
| B Scientific Writing | Manuscript Authoring | per token (1K) | £0.50 |
| B Scientific Writing | Slide Deck Generation | per deck | £45 |
| C Medical Writing | Content Authoring | per token (1K) | £0.50 |
| D Regulatory Writing | Regulatory Authoring | per token (1K) | £0.50 |
| D Regulatory Writing | Gateway Submission | per submission | £200 |
| E Ideation & Publishing | Content Atomisation | per card per channel | £5 |
| Platform | AI Tokens (base) | per 1K tokens | £0.005 |
| Platform | Voice Transcription | per minute | £0.02 |

"Edit rate card" button — only available on active version

**Template variables (CC wires these):**
`{{ versions }}` — version list rows · `{{ v.label }}` / `{{ v.status }}` / `{{ v.effective }}` / `{{ v.setBy }}` — per-version data
`{{ rateRows }}` — rate card table rows · `{{ r.module }}` / `{{ r.service }}` / `{{ r.unit }}` / `{{ r.rate }}` — per-rate data
`{{ activeVersion }}` — selected version in left panel, disabled on archived.

**Disruption Rate Card note (always visible):**
"This is the AURORA Disruption Rate Card (PRD §10.2) — the platform default. Super Admin may replace it with a custom rate card. The Disruption Rate Card represents market disruption pricing versus standard consultancy rates."

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM12-rate-card-admin.md and execute.
Build Rate Card Admin exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM12-rate-card-admin.html.
Run all 3 validation passes and report results before awaiting the next session.
```
