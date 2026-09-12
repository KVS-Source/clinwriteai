# Session PM04 — Notification Centre
**Screen:** sPM14 · Notification Centre
**Route:** `/notifications`
**Component:** `src/platform/screens/NotificationCentre.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM14-notification-centre.html`
**Data:** `notifications.json`, `notificationPrefs.json`
**Store:** `platformStore`
**Access:** All authenticated users

---

## What to Build

Two-column: notification list with filter bar (left ~420px) · detail panel + preferences tab (right). Current user: Dr Sarah Chen · Regulatory Writer. 3 unread notifications.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Header:** "Notifications · Assignments, stage advances and system events across every discipline you work in."

**Tabs:** Inbox (badge: "3 unread") · Preferences

**Inbox tab — left panel:**
- `{{ f.label }}` filter chips: All types · Stage advance · Review assigned · Publishing due · System
- "Mark all as read" link (grey)
- `{{ notifications }}` loop: `{{ n.type }}` icon · `{{ n.time }}` · `{{ n.title }}` · `{{ n.context }}`
- Unread rows have navy left border accent
- `{{ countLabel }}` = "Showing 10 notifications · 3 unread"

**Detail panel (right — notif-001 active):**
- `{{ activeType }}` type chip · `{{ activeModule }}` module chip
- `{{ activeTitle }}` · `{{ activeBody }}`
- Raised: `{{ activeStamp }}`
- `{{ activeAction }}` CTA button (navy) — navigates to the relevant screen
- "Dismiss" link — "Dismissing removes the notification from your inbox. The underlying event remains in the audit trail."

**Preferences tab:**
- "Preferences apply to your account across every client project. In-app delivery cannot be disabled for system alerts."
- Table: `{{ p.type }}` / `{{ p.emailLabel }}` / `{{ p.inAppLabel }}` / `{{ p.smsLabel }}`
- "Preference changes take effect immediately and are written to the audit trail."

---

## Data Wiring

```typescript
const { notifications, prefs, markRead, dismiss, updatePref } = usePlatformStore()
// MSW: GET /api/notifications → notifications.json
// Filter to targetUserId === 'user-rw' for Dr Sarah Chen demo
// notif-001, notif-002, notif-003 have isRead: false → 3 unread

// MSW: GET /api/notifications/preferences → notificationPrefs.json
// MSW: PATCH /api/notifications/:id/read → { isRead: true }

// countLabel = `Showing ${filtered.length} notifications · ${unread} unread`
// activeAction = ctaLabel from notifications.json (e.g. "Go to Super Review →")
// activeAction click → navigate to ctaRoute from notifications.json
// Mark as read automatically on notification click
```

---

## Implementation Notes (from design review)

- `{{ notifications }}` = only content gap — filter `notifications.json` to `targetUserId: 'user-rw'` for Dr Sarah Chen demo
- `{{ countLabel }}` = "Showing 10 notifications · 3 unread" — derives from filtered `notifications.json`
- `{{ n.context }}` = sub-line below title (e.g. "VELORA-301 NDA · Module D") — derive from `notifications.json` `entityLabel` + `module`
- `{{ activeAction }}` = CTA button label from `notifications.json` `ctaLabel`; clicking navigates to `ctaRoute`
- Marking a notification read: automatic on click (no separate "Mark as read" per item); "Mark all as read" is the bulk action
- "In-app delivery cannot be disabled for system alerts" — enforce in preferences: the In-app toggle for `eventType: 'system'` is disabled (greyed, checked)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Inbox tab shows "3 unread" badge. notif-001, notif-002, notif-003 have navy left border. Other rows have no border. (AC-PM-019)
2. Clicking notif-001 opens detail panel with correct title, body, stamp, and "Go to Super Review →" CTA. Notification is marked read (border disappears). (AC-PM-019)
3. Preferences tab shows 5 rows from `notificationPrefs.json`. System alerts row has In-app toggle disabled (greyed, checked). (AC-PM-020)
4. "Mark all as read" clears all unread borders and resets the Inbox badge to 0.
5. `countLabel` updates correctly when filter chips are applied (e.g. "Stage advance" filter shows only stage-related notifications).

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM15-notification-centre.md and execute.
Build NotificationCentre exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM14-notification-centre.html.
Run all 3 validation passes and report results before awaiting Session PM09.
```
