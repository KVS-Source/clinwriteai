# CD Session — sPM02 · MFA Verify
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM02-mfa-verify.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/mfa`
**Phase:** Phase 0
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM02** of the ClinWrite.AI Platform & Admin module — the MFA verification step after sPM01 Sign In resolves credentials. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E**.
2. **This screen renders WITHOUT the ClinWrite.AI AppShell** — pre-auth public page, same compliance footer as sPM01.
3. All structural text is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.
5. **Visual continuity with sPM01** — same card width (400px), same card padding (40px), same brand header. The user has JUST signed in; they must not feel they have jumped to a different product.

---

## sPM02 — MFA Verify

**File:** `aurora-sPM02-mfa-verify.html`
**Route:** `/mfa`
**Current user:** session-pending (`{{ pendingUserEmail }}` resolved from sPM01, no session cookie yet)
**Shipped reference:** `apps/web/src/screens/shell/MFAVerify.tsx` (127 LOC — treat as prototype; CD should polish, not just mirror)

**Layout:** Full viewport, soft slate `#F8FAFC` background, centred 400px card, 40px padding — identical shell to sPM01.

### Card composition (top → bottom)

**Brand header row** — same as sPM01 (32×32 navy square + "ClinWrite.AI" wordmark + tagline).

**Divider** — 1px slate-200.

**Identity chip** (NEW — not in current prototype):
- Compact pill above the title showing the email the user signed in with + a "Change" link that routes back to sPM01.
- Visual: 32px tall, slate-50 bg, 1px slate-200 border, 8px radius, 12px padding. Email at 13px slate-700, "Change" at 12px navy underlined.
- Purpose: eliminates the "did I just sign in with the right account?" ambiguity.

**Form title block:**
- Default (TOTP mode): "Enter your verification code" — 18px bold slate-900
- Default sub: "Enter the 6-digit code from your authenticator app." — 13px slate-500

Backup-code mode (toggled from "No access to your authenticator?" link below the card):
- Title: "Enter a backup code"
- Sub: "Enter one of the backup codes you saved when you set up MFA. Each code can be used only once."

**Form:**
- Field: Verification code
  - Label hidden visually (sr-only "Verification code"), aria-labelledby target.
  - Input: **ONE wide mono input, not six boxes**. Rationale: paste works, screen readers announce one field, backspace doesn't jump focus between boxes.
  - 48px tall (taller than sPM01's inputs to accentuate it as the primary action target). Centred text. IBM Plex Mono 18px, letter-spacing 4px for TOTP mode. Max-length 6 for TOTP, 10 for backup codes.
  - `inputMode="numeric"` + `autocomplete="one-time-code"` for TOTP; `inputMode="text"` + `autocomplete="off"` for backup.
  - Focus state: navy 2px border + 2px navy focus-ring at 20% opacity.
- NO auto-submit on paste. Auto-submit ONLY when the user TYPES the sixth digit (TOTP mode only). A wrong paste must be correctable.
- Error banner above the input when verification fails:
  - Rose `#FFF1F2` bg, 13px rose-700, 8px radius, `role="alert"`.
  - Mode-aware copy. TOTP: "That code didn't verify. Codes expire after 30 seconds — wait for the next code and try again." Backup: "That backup code is not valid. Codes are single-use; try the next one on your list."
- Primary submit:
  - 40px tall, full-width, navy `#1A3C5E` bg, white 14px semibold "Verify and sign in".
  - Loading state: "Verifying…" + spinner + disabled.
  - Disabled state: slate-200 bg, slate-400 label — active until the field has the right number of characters.

**Below-card utility row:**
- 13px slate-500 centred, 16px gap below card.
- "No access to your authenticator?" + button-style "Use a backup code instead" (navy, underlined, same baseline).
- Toggles mode in place; clears the input; does NOT reload the page.
- In backup mode, the link reads "Use your authenticator app instead" to return.

**Compliance footer** — same as sPM01: "Protected by 21 CFR Part 11 compliant authentication" — 11px mono slate-400, centred, 16px below the below-card row.

### States to design (frames)

1. **Default — TOTP mode** (empty 6-digit input, submit disabled).
2. **Typing — TOTP mode** (3 digits entered, submit still disabled, no auto-submit yet).
3. **Auto-submit — TOTP mode** (6th digit just typed, button shows "Verifying…" without the user clicking).
4. **Error — TOTP mode** (rose banner, input cleared, autofocused).
5. **Default — Backup mode** (input empty, placeholder "Enter backup code").
6. **Error — Backup mode** (rose banner, mode-specific copy).
7. **(Future, flag as deferred)** "Didn't receive it?" / SMS fallback — ClinWrite has no SMS MFA factor today. Design a deferred frame showing where it would sit.

### Template variables (CC wires these)

- `{{ pendingUserEmail }}` — identity-chip email string
- `{{ mode }}` — `'totp' | 'backup'`
- `{{ codeValue }}` — controlled input value
- `{{ submitting }}` — boolean
- `{{ errorMessage }}` — nullable; present → render mode-aware error banner

### A11y requirements

- `<main>` wraps the card. `<form>` has `aria-label="Verify your identity"`.
- Hidden `<label>` associated with the code input.
- Mode-toggle button announces the new mode: `aria-pressed="false"` toggles to `true` + the button text swap already names the new mode.
- Error banner has `role="alert"` + `aria-live="assertive"` (not polite — this is interrupting the user from signing in).
- Focus on mount lands on the code input. Mode toggle restores focus to the code input after clearing.
- Enter from the input submits (default form behaviour).

### What NOT to design

- MFA enrollment flow (QR code + secret + backup codes display) — ClinWrite does not currently gate first-time users through an in-login enrollment wizard. Enrollment lives in `/me/security` post-login and is a separate CD session (not yet briefed). Flag that as sPM03.5 or a follow-up.
- SMS code fallback — not shipped.
- "Trust this device for N days" — ClinWrite does not have device-cookie-persistence shipped. Design-only hint acceptable as a future frame; do not stub a non-functional checkbox.
- Removal of the "Enter any 6-digit number for the prototype" dev hint — already removed in production copy; must not reappear.

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM20-mfa-verify.md and execute.
Build MFA Verify exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM02-mfa-verify.html.
Run all 3 validation passes and report results before awaiting the next session.
```
