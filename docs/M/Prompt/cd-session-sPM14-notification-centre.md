# CD Session — sPM14 · Notification Centre
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM14-notification-centre.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/notifications`
**Phase:** Phase 1
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM14** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM14 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM14 — Notification Centre

**File:** `aurora-sPM14-notification-centre.html`
**Route:** `/notifications`
**Current user:** Dr Sarah Chen · Regulatory Writer

**Layout:** Two-column. Left: notification list (~420px). Right: notification detail + preferences tab strip.

**Top tabs:** Inbox (default, badge `3 unread`) · Preferences

**Left — Inbox:**
Filter: All · Unread · By type dropdown

Notification rows (10):
1. `🔵 Stage advance` · **Document entered Stage 4 — Super Review · VELORA-301 NDA · sD06** · 2h ago · **UNREAD**
2. `🔵 Review assigned` · **You have been assigned as Regulatory Writer on VELORA-302 · Module D** · 4h ago · **UNREAD**
3. `🟡 Publishing due` · **VELORA-301 LinkedIn post due in 3 days · sE07** · 09 Sept 2026 · **UNREAD**
4. `⚪ Stage advance` · Document entered Stage 5 · VELORA-301 NDA · 08 Sept 2026 · Read
5. `⚪ System` · ACK2 received · FDA ESG · VELORA-301 NDA · 08 Sept 2026 · Read
6. `⚪ Comment` · Dr Elena Vasquez left a comment on §2.5.4 · 07 Sept 2026 · Read
7-10: `{{ notifications }}` loop (CC wires remaining)

"Mark all as read" button (grey link, top right of list)

**Template variables (CC wires these):**
`{{ notifications }}` — rows 7–10 · `{{ n.type }}` / `{{ n.title }}` / `{{ n.body }}` / `{{ n.time }}` / `{{ n.read }}` — per-notification data
`{{ unreadCount }}` — badge count on Inbox tab
`{{ activeNotification }}` — selected notification for detail panel
`{{ prefRows }}` — preferences table rows · `{{ p.type }}` / `{{ p.email }}` / `{{ p.inApp }}` / `{{ p.sms }}` — per-preference data

**Right — Detail (notification 1 active):**
Type: Stage advance · Module D
Title: "VELORA-301 NDA — Super Review (Stage 4)"
Body: "The submission VELORA-301 NDA has entered Stage 4 — Super Review. Your sign-off as Regulatory Writer is required."
Time: 09 Sept 2026 07:15 UTC
"Go to Super Review →" (navy primary) · "Dismiss" (grey link)

**Preferences tab:**
Table (Notification type · Email · In-app · SMS):
| Type | Email | In-app | SMS |
|------|-------|--------|-----|
| Stage advance | ✓ on | ✓ on | ○ off |
| Review assigned | ✓ on | ✓ on | ○ off |
| KOL invitation sent | ✓ on | ✓ on | ✓ on |
| Publishing due | ✓ on | ✓ on | ✓ on |
| System alerts | ○ off | ✓ on | ○ off |

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM14-notification-centre.md and execute.
Build Notification Centre exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM14-notification-centre.html.
Run all 3 validation passes and report results before awaiting the next session.
```
