# CD Session — sPM05 · Super Admin Panel
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM05-super-admin-panel.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/super-admin`
**Phase:** Phase 0
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM05** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM05 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM05 — Super Admin Panel

**File:** `aurora-sPM05-super-admin-panel.html`
**Route:** `/super-admin`
**Current user:** Alex Thornton · Super Admin · GenBioCa Sciences

**Layout:** Left nav tabs + right content panel. Same structure as sPM04. Sidebar shows "SUPER ADMIN" section highlighted differently (slightly darker navy).

**Left nav tabs:**
- Clients (active/default)
- Platform Analytics
- Platform Configuration
- Audit Log

**Right panel — Clients tab (default active):**

Header: "Client Management · 7 active clients"
"+ New client" button (navy primary, top right)

Client table (7 columns: Client name · Plan · Status · Admin contact · Created · Revenue to date · Actions):
Hard-coded rows:
- GenBioCa Sciences (internal) · Enterprise · `✓ Active` · Dr James Hartley · 01 Jan 2026 · £0 internal · View / —
- MedPharma Ltd · Professional · `✓ Active` · Sarah Okonkwo · 15 Mar 2026 · £24,800 · View / Suspend
- GlobalClinicals Inc · Starter · `✓ Active` · Mark Reeves · 01 Jun 2026 · £6,200 · View / Suspend
- BioTherapeutics AG · Enterprise · `⚠ Suspended` (amber) · Hans Müller · 12 Feb 2026 · £41,000 · Reactivate / —
- DataRx Corp · Professional · `○ Churned` (grey) · — · 10 Apr 2026 · £8,400 · View (read-only)

**Right panel — Platform Analytics tab:**

4 stat cards (2×2 grid):
- Total active users: `247`
- Active projects: `34`
- Documents created (30 days): `1,847`
- AI tokens consumed (30 days): `4.2M`

Revenue strip: MRR £18,400 · ARR £220,800 · Churn this quarter 1 client · Avg tokens/client/month 600K

**Right panel — Platform Configuration tab:**

AI engines list (manage which engines Admin can select from):
Table: Engine name · Provider · Status · Add / Remove action

Feature flags table (3 columns: Feature · Status · Toggle):
- Module E Localisation · `✓ Enabled` · Toggle
- Voice Notes · `✓ Enabled` · Toggle
- Slide Deck Generator · `✓ Enabled` · Toggle
- Best Practices API · `○ Beta` · Toggle

**Template variables (CC wires these):**
`{{ clients }}` — client table rows · `{{ c.name }}` / `{{ c.plan }}` / `{{ c.status }}` / `{{ c.revenue }}` — per-client data
`{{ totalClients }}` — count in header · `{{ platformStats }}` — analytics numbers (users, projects, documents, tokens, MRR, ARR)
`{{ engines }}` — AI engine list in Platform Configuration tab
`{{ flags }}` — feature flag rows · `{{ f.feature }}` / `{{ f.status }}` — per-flag data

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM05-super-admin-panel.md and execute.
Build Super Admin Panel exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM05-super-admin-panel.html.
Run all 3 validation passes and report results before awaiting the next session.
```
