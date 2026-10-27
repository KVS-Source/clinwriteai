# ClinWrite License Studio — Design Brief for Claude Design

**For:** Claude Design (CD) — screen design generation
**By:** GenBioCa engineering, 2026-10-28
**Reference material (same repo):** [`standalone-deployment-prd.md`](./standalone-deployment-prd.md) — read this first for full context on the product strategy.

---

## 1. Short read if you only have 30 seconds

ClinWrite is a clinical writing SaaS for pharma (think: writing CSRs, protocols, DSURs). We're launching a **customer-hosted / air-gapped** variant where regulated pharma customers run the whole stack on their own infrastructure and GenBioCa never sees their data.

To make that work, we need a **tiny internal tool** called the **License Studio** — operated only by the CEO and the IT head at GenBioCa. It issues cryptographically-signed license files (`.lic`) that customers import into their deployment. The license file tells their deployment what modules are unlocked, how many users are allowed, when it expires, which AI providers it may call, and so on.

**You are designing screens for this internal License Studio.** It is **not** a customer-facing product. Think of it as a serious, data-dense operator console — closer to AWS console / Stripe dashboard than to Linear / Notion.

---

## 2. Who uses this

Exactly **two people**:

| Role | What they do with it |
|---|---|
| **CEO** (business decisions) | Creates/renews customer records, approves license parameters (modules, seats, price tier), sets expiry, revokes a cheating customer. |
| **IT head** (crypto operator) | Physically holds the YubiKey. Executes the "signing ceremony" (touches YubiKey when prompted), handles signing-key rotation, operates the revocation list. |

Both log in from the GenBioCa office or a locked-down VPN. They may work side-by-side on a single customer renewal — one approves the shape, the other signs.

Not users: customers, salespeople, support staff, accountants. If anyone else needs info, the CEO/IT head exports a CSV.

---

## 3. The emotional read we want

- **Trust.** Every click here produces an artifact that encodes revenue + legal commitments. The UI should feel *serious* — not playful. No illustrations. No marketing copy.
- **Clarity.** Every expiry date, module list, and seat count is right in the open — nothing hidden behind tooltips.
- **Deliberate.** Destructive actions (revoke, delete a customer, rotate the signing key) require explicit confirmation + a typed phrase. No one accidentally revokes a $500k/year customer.
- **Compact.** These are power users; data density is fine. Tables with 50-row pages, no card-grid dashboards.
- **Audit-first.** Every screen that mutates state ends with "This action will be logged as `license_renewed` at 15:04 UTC by Alex Thornton" — so the operator always knows what's about to be recorded.

Think: **Stripe Dashboard circa 2018 meets the UI of a hardware security module admin panel.** Dark navy accents on white; monospace for IDs and timestamps; data tables are first-class.

---

## 4. Visual system to reuse from the main ClinWrite app

Pull these from the existing ClinWrite UI so the two apps feel like siblings (even though users of each are different).

### 4.1 Colors

| Role | Hex | Where used |
|---|---|---|
| **Dark navy** (brand) | `#1E293B` | TopNav background, primary header text |
| **Primary blue** | `#2563EB` | Primary buttons, links, active tab indicators, chart accents |
| **Blue tint (background)** | `#EFF6FF` | Hover states, active-row backgrounds |
| **Slate 900** (body text) | `#1E293B` | All body text |
| **Slate 600** (meta text) | `#64748B` | Timestamps, metadata rows |
| **Slate 300** (dividers) | `#CBD5E1` | Table borders, divider lines |
| **Slate 100** (chip bg) | `#F1F5F9` | Chip/badge backgrounds for neutral tags |
| **Slate 50** (page bg) | `#F8FAFC` | Page background, sidebar background |
| **Emerald 700** (success) | `#15803D` | Active license, "Signed", "Valid" status |
| **Amber 700** (warn) | `#B45309` | "Expiring soon", grace-period, "Revoked" |
| **Rose 600** (danger) | `#DC2626` | "Expired", "Revoked - compromise", delete button text |
| **Indigo 50/700** (AI/security) | `#E0E7FF` / `#4338CA` | YubiKey-touch moment, crypto-sign call-outs — makes the "something magical/secure is happening" moment pop |

### 4.2 Typography

- Body: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`, 13px base.
- Monospace: `ui-monospace, SF Mono, Menlo, monospace` for all IDs, timestamps, hashes, JWT previews, revocation IDs.
- Headlines: same sans, bold, clear hierarchy (18 / 16 / 14 / 13 / 11).

### 4.3 Shape

- **TopNav**: 56px tall, dark navy `#1E293B`, white text, breadcrumbs on the left + operator avatar on the right. Match the main ClinWrite TopNav exactly.
- **Content area**: white (`#FFFFFF`) over slate-50 page background.
- **Cards + tables**: 1px slate-200 border, 6-8px rounded corners.
- **Spacing scale**: 4 / 8 / 12 / 16 / 24 / 32px — standard Tailwind.
- **Shadows**: Minimal. Only used for modals (`shadow-xl`) and the YubiKey-touch overlay. No shadows on normal cards — borders only.

### 4.4 Reusable components (reference the main app)

- **Status pill** — small rounded-full chip, 11px, bold, uppercase tracking-wider. Status colors from §4.1.
- **MonoLabel** — tiny ALL-CAPS section header, 10px, slate-500, wide tracking.
- **Breadcrumbs** — chevrons, mono tone, truncate last crumb on narrow screens.
- **Table** — sortable headers, zebra off (clean), hover tint `#EFF6FF`, row-click to detail.
- **Modal** — centered, slate-900/40 backdrop, white panel with slate-200 header border, Esc + backdrop click dismiss.
- **Toast** — top-right corner, 4s auto-dismiss, success/warn/error variants.

---

## 5. Screen inventory

Design these screens, in priority order:

| # | Screen | Priority | Notes |
|---|---|---|---|
| 1 | **Dashboard** | P0 | Operator's landing page. Expiring soon + recent activity. |
| 2 | **Customers (list)** | P0 | All customer orgs with license status at-a-glance. |
| 3 | **Customer detail** | P0 | Everything about one customer, including license history. |
| 4 | **New / Renew license wizard** | P0 | Multi-step flow ending in the YubiKey-touch moment. |
| 5 | **YubiKey touch overlay** | P0 | Modal that appears during signing. The showpiece moment. |
| 6 | **License download / email handoff** | P0 | Immediately after signing — operator sends to customer. |
| 7 | **Revocation workflow** | P1 | Suspend / revoke a live license, with reason + consequences. |
| 8 | **Audit log** | P1 | Chronological operator-action log. Filterable. |
| 9 | **Signing key management** | P2 | Current key, rotation ceremony, backup state. |
| 10 | **Settings / Operators** | P2 | The two operators + their credentials + 2FA state. |
| 11 | **Login screen** | P0 | Simple. SSO (Google Workspace) + hardware 2FA. |

---

## 6. Screen-by-screen specs

### Screen 1 — Dashboard (landing after login)

**Purpose:** The operator opens the Studio Monday morning. They want to see: what's expiring this week? Who did what last? Is there anything on fire?

**Layout:** Left sidebar (nav) + main content.

**Sidebar nav** (260px wide, slate-50 bg):
- Logo + "License Studio" wordmark (dark navy)
- `Dashboard` (home icon) — active
- `Customers` (building icon)
- `Licenses` (certificate/key icon)
- `Audit log` (clipboard icon)
- `Signing key` (shield icon)
- `Settings` (gear icon)
- Divider
- Operator chip at the bottom: avatar + name + "Sign out" (`Dr Rohan Iyer · CEO`)

**Main content:**

- **Header row** (not the TopNav — a page-level header):
  - "Good morning, Rohan." (greets by first name)
  - Right side: timestamp "Monday, 28 October 2026 — 09:14 IST"

- **Four stat tiles** across the top (equal width, 1px border, no shadow):
  1. Active licenses: `12` + green dot
  2. Expiring within 30 days: `3` + amber dot
  3. Revoked (ever): `1` + rose dot
  4. Issued this month: `4` + blue dot
  Each tile is clickable → filters the Licenses list.

- **Two-column layout below the tiles:**

  **Left column: "Expiring soon"** (card, 1px border)
    - Table: Customer / Modules / Expires / Action
    - Each row: customer name (bold) + sub-line (contract id), module chips (A, B, C letters in slate-100 bg), expiry date in amber (with "in 12 days" subtext), "Renew" button (primary blue)
    - 3-5 rows visible; "View all expiring →" link at the bottom.

  **Right column: "Recent operator activity"** (card, 1px border)
    - Vertical timeline, newest at top
    - Each entry: avatar circle + name + action + timestamp
    - E.g.: "**Alex Thornton** issued license `lic-7d2f…` for **Acme Pharma** — 2h ago"
    - Icons by action type: key (issued), refresh (renewed), ban (revoked), rotate (key rotated)
    - 10 entries visible; "View full audit log →" link at the bottom.

**States to show:**
- Normal (populated as above).
- Empty state ("No licenses expiring in the next 30 days — all clear." + emerald check).
- Attention state (if a cert is expired past grace: large red banner at the top of the page).

---

### Screen 2 — Customers (list)

**Purpose:** All customer orgs in one scrollable, filterable table.

**Layout:** Same sidebar. Main content:

- **Header:** "Customers" h1 + subtitle "12 active · 1 archived"
- **Right side of header:** **+ New customer** primary button.
- **Toolbar row** (just above the table):
  - Search input (grows to fill) — `Search by name, contract ID, or primary contact…`
  - Status filter chip group: `All` / `Active` / `Expiring` / `Expired` / `Revoked` / `Archived`
  - Export CSV button (icon + "Export")

- **Table** (full width, 1px border, no shadow):
  Columns:
  | Col | Content | Format |
  |---|---|---|
  | Customer | Logo (initials fallback) + Name (bold) + sub: contract-id (mono) | ~24% |
  | Contact | Primary name + email | ~18% |
  | Modules | Chips: `A` `B` `C` | ~12% |
  | Seats | `12 / 25` (used / max) | ~8% |
  | License | Pill: Active / Expiring / Expired / Revoked | ~10% |
  | Expires | Date + relative ("in 42 days") | ~14% |
  | Last activity | "Issued" / "Renewed" / "Seats bumped" + relative time | ~14% |

  Row interactions: hover tint `#EFF6FF`, click opens detail.

- **Pagination at the bottom:** 50 rows per page. `← Previous · 1 2 3 · Next →`.

**Edge states:**
- Expiring row: pill is amber, Expires cell has amber text.
- Expired row: entire row text slate-400; pill is rose.
- Revoked row: entire row text slate-400 strike-through; pill is rose with ban icon.

---

### Screen 3 — Customer detail

**Purpose:** Everything about one customer. Operators spend most of their active time here.

**Layout:** Sidebar + main. Main is split into a header strip + three vertical sections.

**Header strip** (white, 1px bottom border, 120px tall):

- Breadcrumb at the top: `Customers › Acme Pharma`
- Big block below:
  - Left: customer logo (56px square) + Name (`Acme Pharma Pvt Ltd`, 24px bold) + contract ID (`CTR-2026-014`, mono, slate-500) + status pill (Active / Expiring / etc.)
  - Right: **Renew license** (primary) · **Suspend** (secondary) · overflow kebab (Archive, Edit record, Delete)

**Section 1 — Snapshot** (card)

Four-column grid of key facts:

| Field | Example |
|---|---|
| Primary contact | Dr R. Mehta · r.mehta@acme.in |
| IT contact | V. Shah · it@acme.in |
| Contract period | 1 Jan 2026 – 31 Dec 2026 |
| Modules | `A` `B` `C` (chips) |
| Seat cap | 25 users |
| AI providers allowed | `anthropic` `openai` (chips) |
| Deployment ID | `acme-prod-01` (mono) |
| First deployed | 15 Feb 2026 |

Edit → inline edit mode (same card, inputs replace values, Save/Cancel at the bottom).

**Section 2 — Active license**

Big card. States:
- **Active:** emerald left-border, "Current license" header. Shows JWT metadata — modules, seats, exp date, jti (mono), issued-at, signed-by (operator). Below the metadata: a `View payload` link that opens a modal with the JSON preview.
- **Expiring soon:** amber left-border, countdown ("Expires in 12 days"), **Renew** button front-and-center.
- **In grace:** amber left-border, "In 30-day grace — writes blocked at the deployment", **Renew now** urgent button.
- **Expired:** rose left-border, "License expired on 15 Oct 2026 — deployment is read-only."
- **Revoked:** rose left-border, "Revoked on 15 Oct 2026 by Alex Thornton. Reason: contract terminated." No action button.

**Section 3 — License history** (table)

| Issued | Jti | Modules | Expires | Action | Operator | Status |
|---|---|---|---|---|---|---|
| 15 Feb 2026 | `lic-abc1…` | A, B | 31 Dec 2026 | Initial issue | Alex Thornton | Superseded |
| 02 Jul 2026 | `lic-def4…` | A, B, C | 31 Dec 2026 | Module added (C) | Rohan Iyer | Active ✓ |

Row click → modal with the full JWT payload + download .lic button + "Resend to customer" button.

---

### Screen 4 — New / Renew license wizard

**Purpose:** 4-step flow. Operator clicks "Renew" from the customer detail (or "+ New customer → create first license" after a signup).

**Layout:** Modal takes over the viewport. 760px wide. Stepper at the top. Content changes per step. Cancel always available (confirms discard if any field touched).

**Stepper (top strip):**
`1. Scope ─ 2. Features ─ 3. Review ─ 4. Sign & deliver`

**Step 1 — Scope**
- Customer: locked (comes from context). Show as read-only chip with "Change customer" small link.
- Contract period: two date pickers, side-by-side. Validation: start ≤ end, end must be in the future.
- Modules: checkbox group with the five modules (A/B/C/D/E) each with a one-line description. Checkboxes default to the customer's previous selection.
- Seats: numeric stepper, default = previous value. Shows "Used 12 of currently 25" so operator knows how close they are.

**Step 2 — Features**
- Toggle list of named features: `section-locks`, `crm-ai-notetaker`, `edit-history-sessions`, `tlf-cross-reference`, `meddra-lookup`. Each with a short description.
- AI providers allowed: multi-select of `anthropic`, `openai`, `google`, `azure-openai`, `bedrock`, `ollama`. Default = previous selection.
- Deployment ID: mono input, pre-filled with the existing deployment-id (immutable after first issue; grayed out on renewals).

**Step 3 — Review**
- Full card showing what will be in the JWT:
  - Customer: name + contract-id
  - Scope: `modules: [A, B, C]`, `seats.max_users: 25`
  - Features: list of toggled features
  - AI providers: chip row
  - Expiry: `exp: 2027-12-31T23:59:59Z` (local tz hint under)
  - Deployment ID
  - `iat`, `jti` (shown as "will be generated at signing")
- **Diff from previous license** (if renewal): a two-column "Was / Now" showing what changed (e.g. seats 20 → 25 highlighted amber).
- Operator confirms with a required typed phrase: `Type "ISSUE LICENSE" to proceed.` Button disabled until typed exactly.

**Step 4 — Sign & deliver** — this triggers Screen 5.

**Right side of each step: a sticky "What this does" help card** — plain English summary of the current step's effect. Example on Step 1: "You're deciding what Acme Pharma can use. Modules unlock entire feature sets; seats cap how many human users can log in."

---

### Screen 5 — YubiKey touch overlay (the showpiece)

**Purpose:** This is the one moment in the whole product where real cryptographic magic happens. It should feel special.

**Trigger:** Operator clicks "Sign & deliver" on the wizard's Step 4.

**Behavior:**
- Full-viewport overlay. Dim backdrop (slate-900/60).
- Centered modal, 480px wide, white, generous padding (48px).
- **Top:** large stylized YubiKey icon (gold tone — the YubiKey Y is iconic). 72px tall. Pulsing gently if waiting for touch.
- **Headline:** "Touch your YubiKey to sign"
- **Subhead:** "License for **Acme Pharma Pvt Ltd** · modules A, B, C · expires 31 Dec 2027"
- **Below the subhead, a mono card:** `jti: lic-7d2f-9c1a-4e8b…` (the id about to be minted)
- **Status line:** cycles through states:
  - **Idle (first 2s):** "Waiting for key…" (grey)
  - **Detected:** "YubiKey detected — touch the button now" (blue, with an animated finger-tap indicator)
  - **Signing (brief):** "Signing…" (indigo, animated spinner)
  - **Done:** "✓ Signed. Preparing download…" (emerald, fades to Screen 6)
  - **Error — not detected:** "No YubiKey found. Plug one in and try again." (rose, with Retry button)
  - **Error — wrong key:** "This YubiKey isn't authorized for license signing. Use the primary signing key." (rose)
  - **Error — timeout (30s):** "Timed out — your touch wasn't registered. Try again." (amber, Retry button)
- **Cancel link** at the bottom (grey, small). Confirms with a secondary modal because the operator's about to abort a sign.

**Design note for CD:** This modal needs to feel *weighty* — not casual. A pharma CEO signing a $500k contract license should feel like they're pressing the big red button. Use white space generously. The YubiKey icon is the hero.

---

### Screen 6 — License download / email handoff

**Purpose:** The moment after a successful signature. Operator needs to get the `.lic` to the customer.

**Layout:** Replaces the wizard content (same modal container). Confetti-style check-mark but tasteful (no actual confetti — a single ✓ in an emerald circle, no animation beyond a brief fade-in).

**Content:**

- **Headline:** "License signed and ready."
- **Subhead:** "`lic-7d2f-9c1a-4e8b` for **Acme Pharma** · modules A, B, C · expires 31 Dec 2027"

- **Primary action:**
  - "Email to customer" button (primary blue, prominent)
  - Below: pre-filled email preview card — recipient (`r.mehta@acme.in`), subject, body (templated), + the `.lic` attached. Operator can edit before sending.

- **Secondary actions:**
  - "Download .lic file" button (secondary)
  - "Copy JWT" button (icon only)
  - "View raw JSON" link

- **Below actions, an info strip:**
  - "This action was logged as `license_renewed` at 09:14 UTC by Alex Thornton. Jti recorded as superseding the previous license (`lic-def4…`)."

- Close button returns to the customer detail (now showing the new active license).

---

### Screen 7 — Revocation workflow

**Purpose:** Kill an active license. Needs friction so it's deliberate.

**Trigger:** "Suspend" button on customer detail OR "Revoke" from a license history row.

**Flow:** Multi-step modal (not a full page).

**Step 1 — Reason**
- Radio group of reasons:
  - "Contract terminated" (normal end-of-life)
  - "Non-payment"
  - "Compromise / key leaked"
  - "Breach of DPA terms"
  - "Other (specify)"
- Textarea for optional note.
- Each reason has a brief description of what consequences the customer will see.

**Step 2 — Consequences preview**
- Card:
  - "On revocation:"
    - License `lic-7d2f…` added to revocation list (next release will carry it)
    - Customer's deployment will refuse to issue new user sessions after their next revocation-list refresh (if they've opted into the Monday refresh, that's within a week; if not, next time they update the stack)
    - **Existing sessions:** the deployment goes read-only; existing users can view + export but not edit
    - "Compromise" revocations also trigger: internal alert, security postmortem docket item
- Operator reads + confirms with checkbox: "I understand these consequences."

**Step 3 — Typed confirmation**
- Input: `Type the customer name exactly to confirm: "Acme Pharma Pvt Ltd"`
- Only the exact match enables the Revoke button (rose, prominent).

**Step 4 — Done**
- Success state: "Revoked. Internal alert sent to Chetan Amin (CEO) and the compliance mailbox."
- Shows the customer detail with the revoked state applied.

**Design note:** All destructive-action modals follow this pattern — reason → consequences preview → typed confirm → done. Consistency builds muscle memory.

---

### Screen 8 — Audit log

**Purpose:** Operators and (eventually) external auditors read this to see every action the Studio has taken.

**Layout:** Full-page table, same sidebar.

- **Header:** "Audit log" + subtitle "Append-only. Hash-chained. 1,247 entries since 15 Feb 2026."
- **Toolbar:**
  - Date-range picker (`From` – `To`)
  - Filter: Operator (dropdown of all operators)
  - Filter: Action (dropdown: `license_issued`, `license_renewed`, `license_revoked`, `signing_key_rotated`, `customer_created`, `customer_archived`)
  - Search: free text (searches entity ids + notes)
  - Export CSV button

- **Table:**
  | When | Operator | Action | Target | Detail |
  |---|---|---|---|---|
  | 2026-10-28 09:14 UTC | Alex Thornton | `license_renewed` | Acme Pharma | lic-7d2f…, modules A,B,C, exp 31 Dec 2027 |
  | 2026-10-27 16:02 UTC | Rohan Iyer | `license_issued` | BioNova Labs | lic-5e8d…, modules A, exp 31 Dec 2026 |
  | 2026-10-25 11:48 UTC | Alex Thornton | `signing_key_rotated` | — | New fingerprint SHA256:a3b2… |

- Row click: side panel slides in from the right with the full JSON payload, previous-hash + row-hash (mono), and a "Verify chain integrity" button.

**Design note:** this log is NOT editable. There's no "edit" affordance anywhere. Visually reinforce by making every row a static read-only block with no hover affordance beyond the detail-open.

---

### Screen 9 — Signing key management

**Purpose:** The IT head's domain. Shows the current signing key, when it was created, when to rotate.

**Layout:** Single column, 760px max width.

- **Current key card:**
  - "Primary signing key" header
  - Fingerprint (mono, large): `SHA256:a3b2c9…`
  - Algorithm: `ES256 (ECDSA P-256)`
  - Created: `15 Feb 2026 by Vikram Shah`
  - Hardware: `YubiKey 5C NFC · serial …7832`
  - Age: `256 days (rotate recommended at 365 days)`

- **Backup state card:**
  - Shamir 2-of-3 split documented at 15 Feb 2026
  - Three parts status: ✓ CEO (safe at HQ), ✓ IT head (safe at HQ), ✓ Legal (sealed envelope dated 15 Feb 2026)
  - "Verify backup integrity" button (opens a ceremony — not in v1)

- **Rotation ceremony** (collapsible section — expand to reveal):
  - A 4-step process. Each step has a checkbox + description.
  - Steps:
    1. Prepare new YubiKey; generate new keypair.
    2. Issue a transition license that trusts both keys (90-day window).
    3. Publish new public key to GitHub Releases.
    4. After 90 days, remove old key trust. Shred old YubiKey.
  - At the bottom: "Begin rotation ceremony" (rose button; requires both operators present).

**Design note:** This screen is viewed infrequently (annually, hopefully). But when it's used, the ceremony matters. Treat the collapsible rotation flow as a dramatic multi-step wizard when expanded.

---

### Screen 10 — Settings / Operators

**Purpose:** The two operator accounts, their credentials, their 2FA state.

**Layout:** Single column, 640px max width.

- "Operators" header + description "Two accounts can access this Studio. Both require hardware 2FA."
- Two cards, side-by-side:
  - CEO card: Avatar + Name + Email + Role chip ("CEO") + Last signin + 2FA status (hardware YubiKey, backup codes count) + Signout other sessions button
  - IT head card: same shape

- **Add operator** button — disabled by default; tooltip says "Only CEO can add new operators; contact the IT head for the change-control approval."

**Design note:** Only two users total. No role-based access control UI needed. If a third operator ever gets added, it's a product decision, not a self-serve setting.

---

### Screen 11 — Login

**Purpose:** Entry point. Simple + safe.

**Layout:** Full-screen centered card, 400px wide. White on slate-50 background.

- Top: Logo + "License Studio" wordmark
- Headline: "Sign in"
- "Sign in with Google Workspace" button (primary blue, Google 'G' icon)
- Below: small "Hardware 2FA required after SSO" note.
- Footer: build version + "GenBioCa Internal Use Only" (slate-400).

After SSO redirect: 2FA screen (Google-prompt style, YubiKey touch required). On success: Dashboard.

**Edge:** Unknown Google account → "This account is not authorized for the License Studio. Only pre-approved GenBioCa staff may access this app. Contact the IT head if you believe this is an error." No signup affordance anywhere.

---

## 7. Interaction notes

- **Keyboard shortcuts:**
  - `⌘K` opens a command palette (customer search, action launcher).
  - `g c` navigates to Customers; `g l` to Licenses; `g a` to Audit.
- **Sticky top bar on scroll** in list views; the toolbar (search + filters) stays pinned.
- **Toast placement:** top-right. On signing success, the toast says: "License signed and emailed to r.mehta@acme.in" with a "View" link to the customer detail.
- **No notifications panel** in v1. If the CEO needs a reminder, they get an email from a nightly cron (`clinwrite-license-studio` → operators).

---

## 8. Accessibility

- All forms label-associated (`<label for>`).
- Status pills carry text equivalents (don't convey state by color alone).
- Monospace blocks have `aria-label` for screen readers when the content is a long hash (e.g. `aria-label="JWT ID lic-7d2f-9c1a-4e8b"`).
- Focus rings on every interactive element (2px blue outline).
- Modals trap focus; Esc closes; backdrop click dismisses (except destructive-action modals, which require explicit Cancel).

---

## 9. What to deliver

For each screen in §5, provide:

1. **Hi-fidelity mockup** (desktop first — 1440px). Mobile out of scope; this is a desktop-only operator tool.
2. **Primary variant** (the happy-path, populated state).
3. **At least 2 secondary states** per screen:
   - Empty state (if applicable)
   - Error state (if applicable)
   - Loading state (skeleton or spinner)
4. **The YubiKey overlay (Screen 5)** gets extra attention — show at least 4 states (idle, detected, signing, done, error).

**Format:** Figma file preferred. If generated as PNGs, 2x retina.

**Naming:** `[01 Dashboard]` / `[02 Customers list]` / etc., matching §5 numbering.

---

## 10. What not to design

- Marketing site. Not relevant — this is internal only.
- Mobile. Operators use desktop.
- Customer-facing portal. Explicitly out of scope (decision D7 in the PRD).
- Billing / payment screens. Out of scope — handled by external accounting.
- A "shared workspace" / commenting / collaboration layer. Two users; email + Slack is enough.

---

## 11. Reference artifacts

- **The product PRD** that drives this: [`standalone-deployment-prd.md`](./standalone-deployment-prd.md) in this same `docs/` folder — read before designing if time permits.
- **Current ClinWrite UI** (for visual-system reuse): https://demo.clinwrite.ai (ask engineering for credentials). Look at the TopNav, document editor, right-rail panels for component language.
- **Prior art for license-tool UIs** (not identical, but tonally similar):
  - Keygen admin dashboard
  - Stripe Dashboard (customer detail + list patterns)
  - 1Password Business Admin (serious internal tool for custodians of secrets)
  - AWS KMS console (cryptographic ceremony UI)

---

## 12. Questions to flag back if any

If any of these is ambiguous, surface it in the Figma file as a sticky note:

- **Branding:** should the Studio carry the ClinWrite logo + wordmark, or get its own identity ("License Studio" standalone)?
- **Light-only vs dark theme:** this brief assumes light. If operators prefer dark for a security tool (common), mention it.
- **Multi-language:** not required for v1. All copy English.
- **Emergency / "break-glass" flow:** if the IT head is unreachable and a customer needs an emergency revocation, is there a flow? Suggest surfacing this as an open design question.

---

**End of design brief.** Carry this file to Claude Design unchanged.
