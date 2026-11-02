# CD Session — sPM01 · Sign In
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM01-sign-in.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/signin`
**Phase:** Phase 0
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM01** of the ClinWrite.AI Platform & Admin module — the public sign-in page. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. **This screen renders WITHOUT the ClinWrite.AI AppShell** — no sidebar, no top nav. It's a pre-auth public page. A thin branded header may be used in place of the AppShell, but the main content is a centred card.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.
5. **Compliance footer** — the "Protected by 21 CFR Part 11 compliant authentication" strapline is load-bearing. It must appear on every pre-auth screen (sPM01, sPM02, sPM03, sPM19) in the same visual treatment so users see from first pixel that the surface is auditable.

---

## sPM01 — Sign In

**File:** `aurora-sPM01-sign-in.html`
**Route:** `/signin`
**Current user:** none (pre-auth)
**Shipped reference:** `apps/web/src/screens/shell/SignIn.tsx` (118 LOC — treat as prototype; CD should polish, not just mirror)

**Layout:** Full viewport, soft slate background (`#F8FAFC`), vertically + horizontally centred form card. No AppShell chrome. Max card width 400px. Card padding 40px.

### Card composition (top → bottom)

**Brand header row** — single row, 32px tall logo square + wordmark:
- Square: 32×32, rounded 8px, navy `#1A3C5E` background, white mono bold "C" glyph at 14px. (Current prototype uses blue `#2563EB`; recolour to navy to match the Platform/Admin accent system.)
- Wordmark + tagline stacked:
  - "ClinWrite.AI" — 18px bold slate-900
  - "AI-Native Authoring for Life Sciences" — 11px slate-400 regular

**Divider** — 1px slate-200, 24px above + 24px below.

**Form title block:**
- "Sign in to your account" — 18px bold slate-900
- "Clinical Writing Module" — 11px mono, navy `#1A3C5E` (change from current blue `#2563EB` for consistency)

The mono-tagline below the title adapts per entry-point: default copy is "Clinical Writing Module"; if the user lands via a module-specific invite or deep link, substitute `{{ moduleTagline }}` ("Scientific Writing Module", "Regulatory Writing Module", etc.).

**Form:**
- Field: Email address
  - Label: "Email address" — 13px medium slate-600
  - Input: 40px tall, 1px slate-200 border, 8px radius, 14px placeholder slate-400, focus state uses navy border + navy focus-ring (`box-shadow` 2px navy at 20% opacity).
  - Placeholder: `name@organisation.com`
  - autocomplete="username", type="email", required, autoFocus.
- Field: Password
  - Label: "Password" — 13px medium slate-600
  - Input: same treatment. Placeholder: 8 dots.
  - **Add show/hide eye toggle on the right side of the input** — currently missing in the prototype. Password managers rely on `autocomplete="current-password"`.
- Error banner (shown when server rejects credentials):
  - Rounded 8px, `#FFF1F2` bg, 13px rose-600 text, 12px padding. Example copy for the error state frame: "That email and password combination doesn't match our records. Try again or request access from your administrator."
  - Anti-enumeration discipline: NEVER branch on "user unknown" vs "wrong password" — the message is identical for both cases. The current prototype's "Invalid email or password. Try marcus.webb@genbiocat.com" is a demo-mode leak and must NOT appear in production. For a non-demo build, drop the hint entirely.
- Primary submit:
  - 40px tall, full-width, navy `#1A3C5E` bg, white 14px semibold "Sign in" label.
  - Loading state: label swaps to "Signing in…" + opacity 70% + cursor not-allowed. Spinner optional (small inline, left of label).
  - Disabled state: slate-200 bg, slate-400 label.

**Below-card utility row** — 16px gap below card, centred, 11px mono slate-400:

- "Protected by 21 CFR Part 11 compliant authentication"

### States to design (frames)

1. **Default** — empty form, button disabled until both fields have content.
2. **Filled, submitting** — "Signing in…" button, inputs disabled.
3. **Error** — rose banner shown with the generic anti-enumeration message, inputs re-enabled, email field keeps its value, password field cleared + focused.
4. **Account suspended / disabled** (returned by API when the user's account has been deactivated) — different banner tone: amber `#FFFBEB` bg + 13px amber-700 text + "Your account access has been suspended. Contact your administrator for support."
5. **Network error** (API unreachable, no server status) — amber banner "Can't reach the ClinWrite.AI service. Check your connection and try again."
6. **(Future, flag as deferred)** "Forgot password?" link and "Email me a sign-in link" (magic link) alternative — not shipped today; design them as a secondary frame so the surface can grow when the backend lands these flows.

### Template variables (CC wires these)

- `{{ emailValue }}` — controlled email input value
- `{{ passwordValue }}` — controlled password input value
- `{{ submitting }}` — boolean, drives button label + disabled state
- `{{ errorMessage }}` — nullable string; when present, renders the banner (CC decides which tone based on error class)
- `{{ moduleTagline }}` — overrides the "Clinical Writing Module" sub-label when the user arrived via a module-specific invitation

### A11y requirements

- `<main>` landmark wraps the card. `<form>` has `aria-label="Sign in to ClinWrite.AI"`.
- Inputs have proper `<label htmlFor>` associations.
- Error banner has `role="alert"` + `aria-live="polite"`.
- Focus order: email → password → eye-toggle → submit. First focus lands on email on mount.
- Keyboard-only submit via Enter from any form field.

### What NOT to design

- SSO button rows (Google / Microsoft / enterprise IdP) — ClinWrite does not have federated login shipped. Flag SSO as a future deliverable; do not stub buttons that are no-ops.
- "Create account" / self-serve registration — ClinWrite is tenant-provisioned only; invitees land on sPM19 Accept Invitation. There is no public sign-up.
- Captcha widget — not shipped today. If added later, it would be a modal interstitial (sPM01.1) between submit and MFA.

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM19-sign-in.md and execute.
Build Sign In exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM01-sign-in.html.
Run all 3 validation passes and report results before awaiting the next session.
```
