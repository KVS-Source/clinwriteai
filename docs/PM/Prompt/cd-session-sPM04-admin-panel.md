# CD Session — sPM04 · Admin Panel
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM04-admin-panel.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/admin`
**Phase:** Phase 0
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM04** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM04 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM04 — Admin Panel

**File:** `aurora-sPM04-admin-panel.html`
**Route:** `/admin`
**Current user:** Dr James Hartley · Admin · Client: GenBioCa Sciences

**Layout:** Full-width with AppShell. Main area uses a left settings nav (~220px) + right content panel.

**Left nav tabs** (vertical list, active = navy bg + white text):
- AI Engine (active/default)
- Voice Transcription
- eCTD Configuration
- Payment Gateways
- Templates
- Subscription
- External APIs

**Right panel — AI Engine tab (default active):**

Header: "AI Engine Configuration"
Sub-label: "Select the default AI engine for all modules. Authors can override per session if permitted."

Engine selector cards (2-column grid, 4 cards):
- `Claude Sonnet 4.5` · Anthropic · `✓ Active` (navy border + navy `Active` chip) · "Default — fast, balanced"
- `Claude Opus 4` · Anthropic · `○ Available` · "Most capable — slower"
- `GPT-4o` · OpenAI · `○ Available` · "Strong alternative"
- `Gemini Pro` · Google · `○ Available` · "Third option"

Fallback engine selector: dropdown showing "Claude Haiku 4.5 (fastest)"
Per-module override toggle: "Allow per-module AI engine override" — `{{ overrideEnabled }}` toggle (on)

Test connection section:
- Button: "Test connection →" (navy outline)
- Status: `✓ Connected · claude-sonnet-4-5 · latency 340ms · last tested 09 Sept 2026 14:22 UTC`

**Right panel — Voice Transcription tab:**

Header: "Voice Transcription Engine"
Sub-label: "Audio files are transcribed server-side. Configure data sovereignty and retention below."

Engine selector (radio cards):
- `Whisper (OpenAI)` · `✓ Active`
- `AssemblyAI` · `○ Available`
- `Azure Speech` · `○ Available`

GDPR / data sovereignty section:
- Jurisdiction selector: EU (selected) / US / APAC
- Audio retention: dropdown — "Delete immediately after transcription" (selected)
- Note (always visible): "Audio files are deleted from storage immediately after transcription. Transcript text is stored in the selected jurisdiction. Deletion is logged to the audit trail."

**Right panel — eCTD Configuration tab:**

Default eCTD version (radio):
- `eCTD v3.2.2` · `✓ Default` (selected)
- `eCTD v4.0` · "Emerging — PMDA mandatory; FDA/EMA transition"

Validation tool:
- `EXTEDO EXTEDOpulse` · `✓ Configured`
- Credentials status: "API credentials on file · last validated 15 Sept 2026"

**Right panel — Payment Gateways tab:**

Header: "Payment Gateways — multiple gateways may be active simultaneously"

Table (4 columns: Gateway · Status · Last tested · Actions):
- Stripe · `✓ Active` (green) · 08 Sept 2026 · Edit / Deactivate
- RazorPay · `✓ Active` (green) · 08 Sept 2026 · Edit / Deactivate
- PayU · `○ Inactive` (grey) · — · Activate
- CCAvenue · `○ Inactive` (grey) · — · Activate
- UPI · `✓ Active` (green) · 08 Sept 2026 · Edit / Deactivate
- Net Banking · `✓ Active` (green) · 08 Sept 2026 · Edit / Deactivate

Webhook URL field (per gateway, shown when expanded): `{{ webhookUrl }}`
"Test payment" button per active gateway.

**Right panel — External APIs tab:**

Header: "External API Connectors · 22 configured"

Table rows (9 visible, paginated — `{{ apis }}` loop):
Representative hard-coded rows:
- FDA ESG · `✓ Connected` · 09 Sept 2026 09:00 UTC · Edit credentials
- EMA CESP · `✓ Connected` · 09 Sept 2026 09:00 UTC · Edit credentials
- MHRA · `⚠ Not configured` · — · Configure
- EXTEDO EXTEDOpulse · `✓ Connected` · 15 Sept 2026 · Edit credentials
- CrossRef / ORCID · `✓ Connected` · Module E owns · Edit credentials
- PubMed · `✓ Connected` · 01 Sept 2026 · Edit credentials
- CDSCO · `○ Inactive` · — · Configure
- SMS Gateway · `✓ Connected` · Admin email + SMS provider · Edit credentials

"Save changes" button (navy primary, bottom right). Unsaved change indicator dot.

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM04-admin-panel.md and execute.
Build Admin Panel exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM04-admin-panel.html.
Run all 3 validation passes and report results before awaiting the next session.
```
