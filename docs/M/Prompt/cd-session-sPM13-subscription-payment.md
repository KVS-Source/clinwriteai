# CD Session — sPM13 · Subscription & Payment
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM13-subscription-payment.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/admin/subscription`
**Phase:** Phase 4
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM13** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM13 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM13 — Subscription & Payment

**File:** `aurora-sPM13-subscription-payment.html`
**Route:** `/admin/subscription`
**Current user:** Dr James Hartley · Admin

**Layout:** Two-column. Left: current plan summary. Right: top-up / purchase panel.

**Left — Current plan:**
Plan name: "Professional Plan · GenBioCa Sciences"
Services table:
| Module | Included tokens/month | Used (Sept) | Remaining |
|--------|----------------------|-------------|-----------|
| All modules | 4,000,000 | 1,847,200 | 2,152,800 |

Renewal date: 01 Oct 2026
Next invoice: £15,000 · auto-charge to Visa ····4417

Invoice history (last 3):
- Aug 2026 · £15,000 · `✓ Paid` · Download PDF
- Jul 2026 · £15,000 · `✓ Paid` · Download PDF
- Jun 2026 · £14,200 (overage) · `✓ Paid` · Download PDF

"Update payment method →" link

**Right — Top up panel:**
Header: "Purchase additional tokens"
Service dropdown: "All modules (combined)" / per-module options
Quantity selector: `500,000 tokens`
Price preview: "£2,500 at current rate (v1.1 · £0.005/1K)"

Active gateways (radio):
- `Stripe` (selected)
- `RazorPay`

"Proceed to payment →" (navy primary)

**Template variables (CC wires these):**
`{{ invoices }}` — invoice history rows · `{{ inv.date }}` / `{{ inv.amount }}` / `{{ inv.status }}` — per-invoice data
`{{ planName }}` / `{{ tokensIncluded }}` / `{{ tokensUsed }}` / `{{ tokensRemaining }}` / `{{ nextInvoice }}` — plan summary
`{{ selectedGateway }}` / `{{ quantity }}` / `{{ pricePreview }}` — top-up panel state

No raw card data note: "Payment is processed securely via Stripe. No card details are stored on this platform."

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM13-subscription-payment.md and execute.
Build Subscription and Payment exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM13-subscription-payment.html.
Run all 3 validation passes and report results before awaiting the next session.
```
