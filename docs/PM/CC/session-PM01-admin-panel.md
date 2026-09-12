# Session PM01 — Admin Panel
**Screen:** sPM04 · Admin Panel
**Route:** `/admin`
**Component:** `src/platform/screens/AdminPanel.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM04-admin-panel.html`
**Data:** `platformConfig.json`
**Store:** `adminStore`
**Access:** `<AdminGuard>` — Admin role only

---

## What to Build

The primary configuration interface for client-level Admins. Left settings nav (6 tabs) + right content panel. Current user: Dr James Hartley · Admin · GenBioCa Sciences. Navy `#1A3C5E` accent throughout.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Left settings nav — 6 tabs (active = navy bg, white text):**
AI Engine (default active) · Voice Transcription · eCTD Configuration · Payment Gateways · Document Templates · Subscription · External APIs

**AI Engine tab:**
- 4 engine cards: Claude Sonnet 4.6 ✓ Active · Claude Opus 4 ○ Available · GPT-4o ○ Available · Gemini Pro ○ Available
- Fallback: "Claude Haiku 4.5 (fastest)"
- Session overrides toggle: "Allow per-module AI engine override · Every override is written to the audit trail"
- Test connection: "✓ Connected · claude-sonnet-4-6 · latency 340ms · Last tested 09 Sept 2026 14:22 UTC"

**Voice Transcription tab:**
- Whisper ✓ Active · AssemblyAI ○ · Azure Speech ○
- GDPR: Jurisdiction = **APAC** · Audio retention = "Delete immediately after transcription"
- Note: "Audio files are deleted from storage immediately after transcription. Transcript text is stored in the selected jurisdiction. Deletion is logged to the audit trail."

**eCTD Configuration tab:**
- eCTD v3.2.2 ✓ Default · eCTD v4.0 available
- EXTEDO EXTEDOpulse ✓ Configured · "API credentials on file · last validated 15 Sept 2026"

**Payment Gateways tab:**
- `{{ gateways }}` loop from `platformConfig.json` `paymentGateways` array
- `{{ g.name }}` / `{{ g.status }}` / `{{ g.tested }}` / `{{ g.actions }}` per row
- Webhook URL field: `https://api.clinwrite.ai/webhooks/stripe` (hard-coded for Stripe demo)
- "Multiple gateways may be active simultaneously. Clients see every active gateway at checkout."

**Document Templates tab:**
- "GenBioCa Corporate v2.1 · Slide deck · uploaded 02 Sept 2026 · ✓ Applied" — Replace button
- "ICH E3 CSR shell · Clinical Writing · platform default" — Override button
- "eCTD cover letter · Regulatory Writing · system-generated" — Override button

**Subscription tab:**
- Plan: **Professional** · Seats: 38/50 · Tokens: 612K · Renews: 01 Jan 2027
- "Invoices are immutable once issued. Plan changes take effect at the next renewal date and cannot be backdated."

**External APIs tab:**
- `{{ apis }}` loop from `platformConfig.json` `externalApis` array
- `{{ a.name }}` / `{{ a.status }}` / `{{ a.checked }}` / `{{ a.action }}` per row
- "22 configured · Showing 8 of 22 connectors"
- `{{ unsaved }}` indicator dot + `{{ save }}` button (Save changes) at bottom right

---

## Data Wiring

```typescript
const { config, updateAIEngine, updateVoiceConfig, updateEctdVersion,
        updateGateway, testConnection } = useAdminStore()

// MSW: GET /api/admin/config → platformConfig.json
// MSW: PATCH /api/admin/config → update and return config

// Payment gateways loop
config.paymentGateways.map(g => ({
  name: g.label, status: g.status, tested: g.lastTested, actions: g.status === 'active' ? 'Edit / Deactivate' : 'Activate'
}))

// External APIs loop
config.externalApis.map(a => ({
  name: a.label, status: a.status, checked: a.lastTested ?? '—', action: a.status === 'connected' ? 'Edit credentials' : 'Configure'
}))

// Unsaved state
const [unsaved, setUnsaved] = useState(false)
// Set unsaved=true on any form change; reset on save
```

---

## Implementation Notes (from design review)

- `{{ gateways }}` and `{{ apis }}` are both table loops — not dropdowns
- `{{ unsaved }}` = amber dot indicator that appears when any field is changed before saving
- `{{ save }}` = "Save changes" button — disabled until `unsaved === true`
- Jurisdiction is **APAC** (not EU) — wire from `config.voiceTranscription.gdprJurisdiction`
- Plan shows **Professional** (not Enterprise) — wire from `config.plan`
- Seats: 38/50 — wire from `config.seats.used` / `config.seats.total`
- Token count: 612K this month — wire from `subscription.json` `currentMonthRunningTotal`
- Test connection button fires `POST /api/admin/test-connection` → returns `{ latency: 340, model: 'claude-sonnet-4-6', status: 'connected' }` — MSW mock this

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. AI Engine tab shows Claude Sonnet 4.6 with ✓ Active chip and navy card border. Other 3 engines show ○ Available. (AC-PM-001)
2. Voice Transcription tab shows Whisper ✓ Active · APAC jurisdiction selected · "Delete immediately after transcription". (AC-PM-002)
3. Payment Gateways tab shows all 6 gateways from `platformConfig.json`. Stripe, RazorPay, UPI, Net Banking show ✓ Active; PayU and CCAvenue show ○ Inactive. (AC-PM-003)
4. Changing any field makes the unsaved dot appear and enables "Save changes". Saving clears the dot.
5. "External APIs" tab shows "22 configured · Showing 8 of 22". All 8 rows render with correct status chips from `platformConfig.json` `externalApis` array.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM01-admin-panel.md and execute.
Build AdminPanel exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM04-admin-panel.html.
Run all 3 validation passes and report results before awaiting Session PM02.
```
