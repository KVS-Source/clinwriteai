# CD Session — sPM19 · Accept Invitation
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM19-accept-invitation.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/accept-invitation?token=…`
**Phase:** Phase 0
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM19** of the ClinWrite.AI Platform & Admin module — the public page an invitee lands on from the one-time invite link emailed to them. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E**.
2. **This screen renders WITHOUT the ClinWrite.AI AppShell** — same visual family as sPM01 Sign In and sPM02 MFA Verify. The invitee is not signed in yet.
3. All structural text is hard-coded. All data rows (invitee name, role, inviter, expiry, tenant) use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.
5. **Token validation is the critical path.** The page's first job on mount is to call `GET /auth/invitations/preview?token=…` and decide which of 6 states to render (valid, expired, revoked, already-accepted, user-not-invited, not-found). Each state has its own copy + call-to-action. CD must design all 6 as separate frames.

---

## sPM19 — Accept Invitation

**File:** `aurora-sPM19-accept-invitation.html`
**Route:** `/accept-invitation?token={{ inviteToken }}`
**Current user:** none (pre-auth)
**Shipped reference:** `apps/web/src/platform/screens/AcceptInvitation.tsx` (93 LOC — treat as prototype; CD should polish, not just mirror)

**Layout:** Full viewport, soft slate `#F8FAFC` background, centred card. Same shell family as sPM01 — 400–480px card (slightly wider than Sign In to accommodate the invitation preview block), 40px padding.

### Card composition — happy path (invitation valid)

**Brand header row** — identical to sPM01 (32×32 navy square + "ClinWrite.AI" wordmark + tagline).

**Divider** — 1px slate-200.

**Invitation preview block:**
- Header: "You've been invited to ClinWrite.AI" — 18px bold slate-900
- Below: "`{{ inviteeName }}`, your organisation administrator has invited you to join as `{{ invitedRole }}`." — 13px slate-700
- Fine print: "You'll sign in with `{{ inviteeEmail }}` on the next screen. This link expires `{{ inviteExpiryHuman }}` (`{{ inviteExpiryAbsolute }}`)." — 12px slate-500. If expiry is <24h away, swap the fine print tone to amber `#B45309` with a small warning glyph.
- Tenant panel (NEW — not in current prototype): slate-50 bg, 1px slate-200 border, 8px radius, 12px padding, 2 rows:
  - Logo (32×32, tenant-configurable, falls back to the ClinWrite "C" mark)
  - Tenant display name at 13px semibold slate-900
  - Below: "Admin: `{{ inviterName }}` · `{{ inviterEmail }}`" at 11px slate-500

**Terms acceptance:**
- Single checkbox row — same visual treatment as sPM03 Terms Gate checkboxes (16×16 custom checkbox, navy fill).
- Label: "I accept the [Terms & Conditions](/terms) and the Data Processing Agreement." Links open the actual T&C page (sPM03 content) in a new tab via `target="_blank" rel="noopener"`.
- Below the checkbox, 11px mono slate-500: "You'll be asked to re-accept inside the platform after signing in — this is a record of your pre-sign-in consent."

**Primary submit:**
- 40px tall, full-width, navy `#1A3C5E` bg, white 14px semibold "Accept & continue to sign in" + right-arrow (`→`).
- Loading: "Continuing…" + spinner + disabled.
- Disabled until the T&C checkbox is checked.
- On click: POSTs to `/auth/invitations/accept` with the token + `acceptTerms: true`; on 200 redirects to `/signin` (sPM01) with the invitee email pre-filled.

**Compliance footer** — same as sPM01: "Protected by 21 CFR Part 11 compliant authentication".

### Error / edge-state frames (CD must design all 6)

1. **Loading** — token-check in flight. Replace the preview block with a slate-500 "Checking invitation…" row + inline spinner.
2. **Valid (happy path)** — the composition above.
3. **Expired** — amber banner `#FFFBEB` bg, 13px amber-700, inside the preview block instead of the role copy:
   - "This invitation has expired. Ask your administrator to resend it."
   - Submit button swapped out for a disabled grey "Invitation expired" state OR hidden entirely.
4. **Revoked** — rose banner `#FFF1F2` bg, 13px rose-700:
   - "This invitation is no longer valid. Ask your administrator for a new one."
   - Submit hidden.
5. **Already accepted** — slate-50 informational row:
   - "This invitation has already been used. Sign in to continue." + a navy "Go to sign in" button → `/signin`.
6. **User not invited / not found** — rose banner:
   - "This invitation link is not valid. If you believe you should have access, contact your administrator." + no submit action.

### Server-error frames (secondary variants)

7. **Accept-step failure** — happy-path card BUT with a rose banner above the submit after the user clicks: "We couldn't complete your acceptance. Please try again, or contact your administrator if the problem persists." Submit re-enabled.
8. **Network error** on the preview call — amber banner at the top: "Can't reach the ClinWrite.AI service to validate your invitation. Check your connection and refresh this page." + no submit.

### Template variables (CC wires these)

- `{{ inviteToken }}` — URL query param, used in the preview + accept requests
- `{{ previewStatus }}` — `'loading' | 'valid' | 'expired' | 'revoked' | 'accepted' | 'user_not_invited' | 'not_found' | 'network_error'`
- `{{ inviteeName }}`, `{{ inviteeEmail }}`, `{{ invitedRole }}` — present only when preview is `valid`
- `{{ inviterName }}`, `{{ inviterEmail }}` — present only when preview is `valid`
- `{{ tenantName }}`, `{{ tenantLogoUrl }}` — present only when preview is `valid`
- `{{ inviteExpiryHuman }}` — e.g. "in 2 days", "tomorrow", "today"
- `{{ inviteExpiryAbsolute }}` — DD-MMM-YYYY HH:mm UTC
- `{{ agreedToTerms }}` — controlled checkbox state
- `{{ accepting }}` — boolean, drives submit state
- `{{ acceptError }}` — nullable string, shown as rose banner on accept-step failure

### A11y requirements

- `<main>` landmark wraps the card.
- Preview block has `aria-live="polite"` so screen readers announce the transition from "Checking…" → the resolved state.
- All error banners have `role="alert"` + appropriate `aria-live` (polite for amber, assertive for rose).
- Terms checkbox is a proper `<label htmlFor>` association.
- The "Terms & Conditions" link inside the checkbox label is keyboard-reachable with its own Tab stop — do not swallow the whole label into a single interactive region.
- Focus on mount: on happy path, land on the T&C checkbox (the next required user input). On error state, land on the primary CTA (if any) or the error banner.

### What NOT to design

- Password creation on this screen — ClinWrite does NOT ask invitees to set a password here. They sign in via the next-screen SSO handoff (which, per the shipped prototype, delegates to `/signin`). If the product later moves to password-create-on-invite, that would be sPM19.1 as a new design.
- Inline SSO button rows (Google / Microsoft) — same rationale as sPM01, no federated login shipped.
- "Decline invitation" button — currently no backend endpoint; a declined invite just expires naturally. If the backend later adds decline, that would be an amber "Decline this invitation" button below the primary CTA on the valid-state frame.
- Role explainer tooltips — the role name alone is sufficient context for an invitee who already knows what role they expected. Over-explaining risks implying commitments ClinWrite doesn't make.

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM22-accept-invitation.md and execute.
Build Accept Invitation exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM19-accept-invitation.html.
Run all 3 validation passes and report results before awaiting the next session.
```
