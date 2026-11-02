# CD Session — sPM03 · Terms Gate
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM03-terms-gate.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/terms`
**Phase:** Phase 0
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM03** of the ClinWrite.AI Platform & Admin module — the Terms of Service + Data Processing Agreement acceptance gate shown immediately after sPM02 MFA Verify, on first sign-in and after any T&C version bump. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E**.
2. **This screen renders OVER a dark backdrop, not inside the AppShell.** The user is technically "signed in" (session cookie issued), but no app surface is reachable until T&C is accepted. The current prototype uses `rgba(15,23,42,0.6)` as the backdrop over an empty viewport; CD should either match this or propose a cleaner alternative (e.g. the AppShell loaded and dimmed behind the modal) as a secondary frame.
3. All structural text (headings, labels, notes, T&C body paragraphs, checkbox labels, button copy) is hard-coded. Only the version number + accept timestamp + user name use `{{ }}` template variables.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.
5. **This is legally load-bearing.** T&C acceptance writes to the audit trail with user_id + timestamp + T&C version. Do not design in affordances that let the user bypass (no "Skip for now", no "Remind me later"). Do not design in a "download T&C" link that opens a modal — the full text must be scrollable in place so the acceptance checkbox is literally below the thing being accepted.

---

## sPM03 — Terms Gate

**File:** `aurora-sPM03-terms-gate.html`
**Route:** `/terms`
**Current user:** `{{ currentUserName }}` · `{{ currentUserRole }}` (session issued, T&C not yet accepted)
**Shipped reference:** `apps/web/src/screens/shell/TCGate.tsx` (170 LOC — treat as prototype; CD should polish, not just mirror)

**Layout:** Full viewport dark backdrop. Centred modal card 560px wide, white, 24px border-radius, 24px shadow, 40px padding.

### Modal card composition (top → bottom)

**Header block:**
- "Terms of Service & Data Processing Agreement" — 20px bold slate-900
- Sub-strap: "Review and accept before accessing the platform" — 11px mono slate-500
- Version chip (NEW — not in current prototype): small chip top-right of header: "VERSION `{{ termsVersion }}` · EFFECTIVE `{{ termsEffectiveDate }}`" — 10px mono slate-500, slate-50 bg, 1px slate-200 border.

**Divider** — 1px slate-200, 24px above + 24px below.

**Scrollable T&C body** — this is the heart of the screen:
- Container: 1px slate-200 border, 8px radius, slate-50 bg, 20px padding.
- Fixed height 240px (current prototype) OR 320px for a 1440×900 desktop variant — CD decides based on readability. Scroll overflow with a visible scrollbar.
- Content: 13px slate-600 body text at `line-height: 1.65`. Section headings inside: 14px bold slate-900 with 6px space below.
- **Current shipped sections** (keep as the baseline, CD may propose polish — do not change the legal substance without flagging to the product owner):

  1. **Platform Use & GxP Compliance** — "This platform is validated for use in GxP-regulated environments. All authoring, review, and approval activities are subject to 21 CFR Part 11 electronic records and signature requirements. Users are responsible for maintaining the integrity of records created within this platform."

  2. **Data Processing & Confidentiality** — "All clinical study data, documents, and personally identifiable information processed within this platform are subject to your organisation's data processing agreement. Unauthorised disclosure of clinical data constitutes a breach of applicable data protection regulations including GDPR (EU) 2016/679."

  3. **Audit Trail & Electronic Signatures** — "Your actions within this platform are logged in a tamper-evident audit trail. Electronic signatures applied through this platform carry legal weight equivalent to handwritten signatures under 21 CFR Part 11. You are solely responsible for all actions performed under your credentials."

- **Flag for the product owner / legal review:** sections for DPDPA 2023 (India), audit-log retention period, incident-notification obligations, and acceptable-use scope are NOT in the current body. CD should design a frame where they'd fit so the layout is proven for the eventual full text; do not author the clauses.

**Checkbox block** — 20px below the scrollable body, stacked:
- Checkbox 1: 16×16 custom checkbox (navy fill when checked, white check mark). Label at 13px slate-900 with 1.4 line-height:

  "I have read and accept the Terms of Service and Data Processing Agreement"

- Checkbox 2 (indented 0, same visual weight — equally load-bearing):

  "I understand that my actions are logged in a tamper-evident audit trail and that electronic signatures carry legal weight under 21 CFR Part 11"

Both must be clickable on the entire label row (not just the 16×16 target).

**Primary submit** — 24px below checkboxes:
- 44px tall (taller than sPM01/sPM02 submits — this is a one-time commitment, not a repeat action):
  - Enabled state: full-width navy `#1A3C5E` bg, white 14px semibold "Accept and continue to platform" + right-arrow glyph (`→`). Hover: `#152F4A` (slightly darker).
  - Disabled state: slate-200 bg, slate-400 label, cursor not-allowed. Shown until BOTH checkboxes are checked.

**Below-button meta row** — 12px below button:
- 11px mono slate-500 centred:
- Line 1: "You are signing as `{{ currentUserName }}` · `{{ currentUserRole }}`"
- Line 2: "This acceptance is recorded in the audit trail."

### States to design (frames)

1. **Default** — neither checkbox checked, submit disabled.
2. **Partial** — one checkbox checked, submit still disabled.
3. **Ready** — both checked, submit enabled + navy, hover state.
4. **Submitting** — button swaps to "Recording acceptance…" + spinner, both checkboxes disabled.
5. **Audit log recorded** (brief toast / in-place confirmation before auto-navigate to `/projects`):

   "T&C acceptance recorded — redirecting…"

6. **Version-bump variant** — repeat sign-in by a user who already accepted v1, now sees v2. Add a small amber chip above the title: "YOU'VE ALREADY ACCEPTED AN EARLIER VERSION — PLEASE REVIEW THE CHANGES BELOW" + a "What changed" expander above the T&C body naming the new/updated clauses.

### Template variables (CC wires these)

- `{{ currentUserName }}` — display name of the user doing the acceptance
- `{{ currentUserRole }}` — e.g. "Admin · Client: GenBioCa Sciences"
- `{{ termsVersion }}` — e.g. "v1.2"
- `{{ termsEffectiveDate }}` — e.g. "01 Oct 2026"
- `{{ box1Checked }}` / `{{ box2Checked }}` — controlled checkbox state
- `{{ submitting }}` — boolean driving submit state

### A11y requirements

- Modal has `role="dialog"` + `aria-modal="true"` + `aria-labelledby` pointing at the H1.
- Focus trap: Tab cycles within the modal. First focus lands on the scrollable body (so screen readers announce the content before the checkboxes). Last focusable before cycling back is the submit button.
- The backdrop does NOT dismiss the modal on click (no escape hatch — this is a gate).
- Esc does NOT dismiss (same reason).
- Checkbox labels are proper `<label htmlFor>` associations.
- Scroll container has `tabIndex=0` so keyboard-only users can scroll it with arrow keys.
- Submit button announces its disabled state (`aria-disabled="true"` AND HTML `disabled` so it's taken out of the Tab sequence until enabled).

### What NOT to design

- "Download PDF" / "Print terms" affordances — not needed for the acceptance surface. If legal requires archival, that's a separate screen in `/me/security` showing acceptance history + download.
- "Decline" button — there is no decline. The equivalent is "Sign out", which is NOT shown here. If the user wants to decline, they close the browser. (Flag this to legal if they want a "Decline → log sign-out" button; design a secondary frame where it would sit, labelled "Sign out instead" below the submit, 12px slate-500 underlined.)
- Multi-language toggle — ClinWrite is English-only today. If the user is in a locale where T&C must be in a local language by regulation, that is a translation + legal-review requirement, not a UI pattern.

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM21-terms-gate.md and execute.
Build Terms Gate exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM03-terms-gate.html.
Run all 3 validation passes and report results before awaiting the next session.
```
