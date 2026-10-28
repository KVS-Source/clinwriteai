# ClinWrite License Studio — Design Brief for Claude Design

**For:** Claude Design (CD)
**By:** GenBioCa engineering, 2026-10-28
**Companion doc:** [`prd.md`](./prd.md) — read for product context.

---

## 1. What this tool is in one paragraph

ClinWrite is a clinical writing SaaS for pharma. We're launching a customer-hosted variant where regulated pharma customers run the whole stack on their own servers and GenBioCa never sees their data. To gate what each customer can use (which modules, how many users, when it expires), we need a tiny internal tool — the **License Studio** — operated only by GenBioCa's CEO and IT head. It generates a signed license file (`.lic`) that the customer imports into their deployment.

**This is an internal operator tool. Not a customer product. Keep it simple.**

---

## 2. Users

Two roles, both at GenBioCa, both with equal privileges — including the ability to manage each other on Screen 5:

- **CEO**
- **IT Head**

Why symmetric? Business continuity. If one person is unavailable (sick, travelling, lost phone, left the company), the other can invite a replacement, reset the missing person's 2FA, or revoke their sessions. Two guardrails prevent misuse:

1. You cannot remove yourself, revoke your own sessions, or reset your own 2FA.
2. The system refuses to delete the last remaining operator.

They sign in once in a while — when a new customer signs up, when a license renews, when a key gets rotated. No daily use. No power-user shortcuts needed.

---

## 3. Design principles

- **Simple over clever.** No command palette, no keyboard shortcuts, no dashboards with charts. Just the five screens below.
- **Serious but friendly.** Each click generates a legal artifact; the UI should feel deliberate. No illustrations, no marketing copy, no animations beyond basic fade-ins.
- **Confirm destructive actions once** — simple confirm modal, not a typed-phrase ceremony.
- **Desktop-only.** Operators use laptops. Mobile is out of scope.

---

## 4. The five modules customers can license

Use the real names in the UI. **Do not use** "Module A/B/C" anywhere — those are internal keys.

- **Clinical Writing**
- **Scientific Writing**
- **Medical Writing**
- **Regulatory Writing**
- **Ideation & Publishing**

Every license-related screen presents these as a checkbox list.

---

## 5. Visual system

Pulling from the main ClinWrite app so the two feel like siblings.

| Role | Hex |
|---|---|
| Dark navy (brand) | `#1E293B` |
| Primary blue (buttons, links) | `#2563EB` |
| Blue tint (hover, active row) | `#EFF6FF` |
| Body text | `#1E293B` |
| Meta text | `#64748B` |
| Dividers | `#CBD5E1` |
| Chip background | `#F1F5F9` |
| Page background | `#F8FAFC` |
| Success (active license) | `#15803D` |
| Warn (expiring, grace period) | `#B45309` |
| Danger (expired, revoked) | `#DC2626` |

Typography: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` for body; `ui-monospace, SF Mono, Menlo, monospace` for IDs, timestamps, hashes.

Shape: 1px slate-200 borders. 6px rounded corners. No shadows except on modals.

---

## 6. The five screens

That's all we need:

| # | Screen | What it does | Who sees it |
|---|---|---|---|
| 1 | **Login** | Email magic link + TOTP (Google Authenticator / Authy). No passwords. | Both operators |
| 2 | **Tenants** | List of customers. Click one → opens Tenant Settings. | Both operators |
| 3 | **Tenant Settings** | Single page: customer details + current license + "Issue new license" button. Everything about one customer. | Both operators |
| 4 | **Signing Key** | View the current signing key fingerprint. Rotate when needed. | Both operators |
| 5 | **Admin** | Operator roster. Add / remove operator, revoke session, reset TOTP. | Both operators |

Issuing or renewing a license happens inline on screen 3 (not a separate wizard page). It opens a small modal, generates the JWT, signs with the key on the operator's YubiKey/USB, and prompts the operator to download the `.lic` file + optionally email it to the customer.

That's it. No dashboard, no audit-log page (we query Postgres directly if we ever need it), no separate revocation screen (it's a button on Tenant Settings).

---

## 7. Screen specs

### Screen 1 — Login

Full-screen centered card, 400px wide, white on `#F8FAFC` background. The flow is **email magic link + TOTP** — no passwords, no SMS.

Four sequential states on the same card:

**(a) Email entry**
- Logo + "License Studio" wordmark at the top (dark navy).
- Headline: "Sign in"
- Email input, autofocused, placeholder `you@genbioca.ai`.
- Primary button: `Send me a sign-in link`.
- Footer: "GenBioCa Internal Use Only · build v0.1.0" (slate-400, tiny).

**(b) Check your inbox**
- Mail icon (slate-400, 32px, centered).
- Headline: "Check your inbox"
- Body: "We sent a sign-in link to **you@genbioca.ai**. Click it from this device within 10 minutes."
- Text link: `Use a different email` (returns to state (a)).

**(c) TOTP code**
Reached after clicking the magic link in email (the link opens this same card in a new tab).
- Headline: "Enter your 6-digit code"
- Body: "Open Google Authenticator or Authy and enter the code for **License Studio**."
- Six single-character inputs (segmented, auto-advance, mono).
- Primary button: `Verify` (enabled when all six filled).
- Text link below: `Lost your authenticator? Ask the other operator to reset it.` (slate-500).

**(d) First-time TOTP enrollment**
Shown instead of (c) if the operator has no TOTP secret yet (new operator just added by another operator, or an existing operator whose 2FA was reset).
- Headline: "Set up two-factor"
- Body: "Scan this QR code with Google Authenticator, Authy, or 1Password, then enter the first code to confirm."
- QR code block (240×240, centered). Below it: `Can't scan? Enter this key:` + the base32 secret in mono, with a copy icon.
- Six-input code field (same as (c)).
- Primary button: `Confirm and sign in`.

**Error states**
- Unknown email → state (a) shows a rose banner above the input: "This email is not authorised. Ask an existing operator to invite you."
- Expired / already-used magic link → full-card error: "This link has expired. Request a new one." + button back to (a).
- Wrong TOTP code → inline rose message below the input: "Code didn't match. Try again." (3 wrong attempts → full-card lockout: "Too many attempts. Try again in 15 minutes.")

---

### Screen 2 — Tenants

**Layout:** Thin sidebar on the left. Links: `Tenants`, `Signing Key`, `Admin`. All three are visible to both roles. Main content fills the rest.

**Header:**
- "Tenants" h1 + subtitle "12 active · 1 archived"
- Right side: `+ Add tenant` primary button.

**Toolbar:**
- Search input: `Search by name or contact email…`
- Status filter: `All` / `Active` / `Expiring soon` / `Expired` / `Revoked` (chip group).

**Table** (full width, 1px border):

| Tenant | Contact | Modules | License | Expires |
|---|---|---|---|---|
| **Acme Pharma Pvt Ltd** | Dr R. Mehta · r.mehta@acme.in | `Clinical Writing` `Regulatory Writing` | Active ● | 31 Dec 2027 (in 426 days) |
| **BioNova Labs** | V. Shah · v.shah@bionova.in | `Clinical Writing` | Expiring ● | 15 Nov 2026 (in 18 days) |
| **Zenith Research** | A. Kapoor · a@zenith.in | `Clinical Writing` `Medical Writing` | Expired ● | 10 Oct 2026 (grace ends 9 Nov) |

Row hover: `#EFF6FF` background. Row click: opens Tenant Settings (screen 3).

Module chips are small, rounded, slate-100 background, slate-700 text.
Status pill colors: Active = emerald, Expiring = amber, Expired = amber (grace) or rose (past grace), Revoked = rose with strikethrough on the row.

Empty state (first-run): "No tenants yet. Click **+ Add tenant** to create your first customer record."

---

### Screen 3 — Tenant Settings

The main working screen. Everything about one customer on one page.

**Layout:** Same sidebar. Main content split into a header strip + two sections.

**Header strip:**
- Breadcrumb (`Tenants › Acme Pharma`)
- Big block: Tenant name (24px bold) + current status pill + contact line + overflow kebab menu (Edit record, Archive).

**Section 1 — Tenant details** (card, 1px border, white)
- Two-column grid of editable fields:
  - Tenant name
  - Primary contact name
  - Primary contact email
  - Date added (read-only)
- `Save` + `Cancel` buttons at the bottom-right when any field is dirty.

**Section 2 — License** (card, 1px border, white)

Shows the current license state. Three visual variants:

- **No license yet** (brand new tenant):
  - Grey header "No license issued yet"
  - Body: "Click Issue license to generate the first one for this tenant."
  - Primary button: `Issue license` → opens the issue modal.

- **Active license:**
  - Emerald left-border (3px).
  - Grid:
    - License ID: `lic-7d2f-9c1a…` (mono)
    - Modules: `Clinical Writing` `Regulatory Writing` (chips)
    - User cap: `25 users`
    - Expires: `31 Dec 2027` (relative sub-text "in 426 days")
    - Issued: `02 Jul 2026 by Alex Thornton`
  - Buttons on the right: `Renew license` (primary) + `Revoke` (text link, rose).
  - A link below: `Download .lic file` + `View raw JWT` (opens a small modal with the JSON payload).

- **Expired (within 30-day grace):**
  - Amber left-border.
  - Same grid, Expires line in amber: "Expired 12 Oct 2026 — read-only until 11 Nov 2026".
  - Big `Renew now` button, primary blue, prominent.

- **Expired past grace:**
  - Rose left-border.
  - Expires line in rose: "Expired 11 Oct 2026 — deployment is fully locked."
  - `Renew now` button still available.

- **Revoked:**
  - Rose left-border.
  - "Revoked 15 Oct 2026 by Alex Thornton — reason: contract terminated."
  - No renew button. "Create new license" button appears instead (treats it as a fresh issue).

#### The "Issue license" modal

Opens when the operator clicks `Issue license` or `Renew license` or `Create new license`.

Modal, 560px wide, centered, slate-900/40 backdrop. Three sections stacked:

**(a) Scope**
- Modules checkbox list (five module names from §4). Pre-checked = whatever the previous license had (empty for a brand-new tenant).
- User cap: numeric stepper. Default = previous value or 10.
- Expiry: single date picker. Default = 1 year from today.

**(b) Review**
- A plain-English summary line: "Issue a license for **Acme Pharma** enabling **Clinical Writing + Regulatory Writing** for **25 users**, valid until **31 Dec 2027**."

**(c) Sign & deliver**
- Primary button: `Sign with hardware key`.
- When clicked:
  1. Button changes to a spinner + "Touch your hardware key…" (indigo).
  2. On touch success: ✓ "Signed." (emerald), then shows the download + email actions.
  3. On error (no key, timeout, wrong key): rose message + Retry button.
- After signing, the modal body replaces with:
  - `Download .lic file` (primary button, downloads immediately).
  - `Email to r.mehta@acme.in` (secondary, pre-filled template).
  - A note: "This license has been recorded. The previous license (if any) is now superseded."
  - `Close` button returns the operator to the Tenant Settings page, now showing the new license as Active.

#### The "Revoke" action

A simple confirm modal, 480px wide:

- Title: "Revoke this license?"
- Body:
  - Dropdown: "Reason" (Contract terminated / Non-payment / Compromise / Other)
  - Optional note textarea.
  - Warning line: "The customer's deployment will go read-only on their next revocation list refresh (or at the next startup after Monday's weekly check)."
- Buttons: `Cancel` + `Revoke` (rose).

No typed-phrase confirmation needed. The dropdown + explicit button click is enough.

---

### Screen 4 — Signing Key

Minimal page. One card.

**Header:** "Signing key" h1.

**Card:**
- "Current signing key"
- Fingerprint: `SHA256:a3b2c9f7…` (mono, large)
- Algorithm: `ES256 (ECDSA P-256)`
- Created: `15 Feb 2026 by Vikram Shah`
- Hardware: `YubiKey 5C NFC · serial …7832`
- Backup location: `Office safe (primary) · bank locker (backup)` — operator-maintained note.

**Below the card:**
- `Rotate key` button (secondary, rose text).
  - Opens a confirm modal: "Key rotation is a serious step. The old key stays trusted for 90 days so existing licenses keep working. New licenses will be signed with the new key. Confirm?"
  - On confirm → leads to a two-step wizard (not detailed here — out of scope for v1 design).

---

### Screen 5 — Admin

Open to both CEO and IT Head. Either can invite, remove, or reset the other — this is the business-continuity escape hatch.

**Header:**
- "Admin" h1 + subtitle "Operators who can sign licenses"
- Right side: `+ Add operator` primary button.

**Operator table** (full width, 1px border):

| Operator | Role | 2FA | Last sign-in | Status |
|---|---|---|---|---|
| **Chetan Amin** (you) | CEO | Enrolled | 2 hours ago | Active ● |
| **Vikram Shah** | IT Head | Enrolled | 3 days ago | Active ● |
| **Priya Nair** | IT Head | **Not enrolled** | — | Invited ● |

- Role column: pill (`CEO` = indigo, `IT Head` = slate).
- 2FA column: text + icon. "Enrolled" (emerald check) / "Not enrolled" (amber warn).
- Status pill colors: Active = emerald, Invited = amber (pending first sign-in), Suspended = rose.
- Row kebab menu (right of each row):
  - `Revoke active sessions` — immediately invalidates every signed-in session for that operator.
  - `Reset 2FA` — clears the TOTP secret; operator will see the enrollment screen on next sign-in.
  - `Resend invite` (invited-state only) — fires a fresh magic link.
  - `Remove operator` (destructive, rose) — opens a confirm modal.

**Guardrails (hidden / disabled states on the kebab):**
- Your own row: the kebab is hidden entirely. You cannot remove yourself, revoke your own sessions, or reset your own 2FA — if you need any of those, ask the other operator.
- When only one operator remains: that row's `Remove operator` option is disabled with a tooltip: "Can't remove the last operator. Add another operator first."

**Add-operator modal** (480px, centered):
- Headline: "Add an operator"
- Email input (`@genbioca.ai` only — reject other domains with inline hint).
- Role select: `CEO` or `IT Head`. Default = `IT Head`. (You can promote someone to CEO; the roles are symmetric for admin purposes but kept distinct for audit clarity.)
- Explanation line: "They'll receive a magic link. On first sign-in they'll set up their authenticator app."
- Buttons: `Cancel` + `Send invite` (primary).

**Remove-operator confirm modal** (480px):
- Title: "Remove **Priya Nair**?"
- Body: "Their access ends immediately. Any licenses they signed in the past remain valid — this does not revoke those licenses."
- Buttons: `Cancel` + `Remove` (rose).

**Empty state** (only one operator — the signed-in person): the table shows the single row with the kebab hidden; a slate helper line appears below the table: "You're the only operator. Click **+ Add operator** to invite a backup — the system won't let you remove the last account."

---

## 8. States to include in deliverable

For each screen, provide:

1. **Primary variant** (populated, happy path).
2. **Empty state** where applicable (Tenants with no tenants; new tenant with no license; Admin with only the signed-in operator — showing the "invite a backup" helper line).
3. **One error state** per interactive flow (sign-in error, signing-key not detected, add-operator wrong domain).

**The Login screen gets extra attention** — show all four states:
- Email entry
- Check your inbox
- TOTP code
- First-time TOTP enrollment (QR code)

**The "Issue license" modal gets extra attention** — show four states:
- Form filled, ready to sign
- Waiting for key touch
- Signed, showing download + email actions
- Error (key not detected)

---

## 9. What to deliver

- **Figma file** (preferred) or hi-fi PNGs at 2x retina.
- Desktop viewport: 1440px wide.
- Naming: `[01 Login]`, `[02 Tenants]`, `[03 Tenant Settings]`, `[04 Signing Key]`, `[05 Admin]`.
- The Login screen states as `[01a Email]`, `[01b Inbox]`, `[01c TOTP]`, `[01d Enroll]`.
- The Issue License modal states as `[03a Issue - form]`, `[03b Issue - waiting]`, `[03c Issue - signed]`, `[03d Issue - error]`.

---

## 10. Out of scope

- Dashboard with charts.
- Audit log viewer (we query Postgres directly if ever needed).
- Separate revocation page (it's a button on Tenant Settings).
- SSO / Google Workspace integration (we deliberately own the operator roster inside the Studio — see Screen 5).
- Password-based login (we don't do passwords — magic link + TOTP only).
- SMS / phone-OTP second factor (SIM-swap risk; NIST SP 800-63B deprecates it).
- Keyboard shortcuts, command palette.
- Mobile layouts.
- Dark mode.
- Internationalisation (English only).

---

## 11. Questions to flag back

Add sticky notes in Figma if any of these is ambiguous:

- Does the License Studio carry the ClinWrite logo or get its own identity?
- Should the "Issue license" flow default to pre-checking the previous license's modules, or start empty every time?
- Is there a visual difference between "Expiring in 7 days" vs "Expiring in 30 days"? Suggest: amber pill either way, but the countdown ("in 5 days") turns bold at ≤7 days.
