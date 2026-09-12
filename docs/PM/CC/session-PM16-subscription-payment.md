# Session PM05 — Subscription & Payment
**Screen:** sPM13 · Subscription & Payment
**Route:** `/admin/subscription`
**Component:** `src/platform/screens/SubscriptionPayment.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM13-subscription-payment.html`
**Data:** `subscription.json`, `ratecards.json`, `platformConfig.json`
**Store:** `adminStore`
**Access:** `<AdminGuard>`

---

## What to Build

Two-column: current plan summary (left) · top-up purchase panel (right). Current user: Dr James Hartley · Admin. Professional plan.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Left — Current plan:**
- "Plan, allowance and billing for GenBioCa Sciences."
- Plan name: "**Professional plan** · GenBioCa Sciences · renews 01 Oct 2026 · ✓ Active"
- Scope table: All disciplines · 4,000,000 included · 1,847,200 used (Sept) · 2,152,800 remaining
- "46% of the monthly allowance used · 22 days remaining"
- Next invoice: "$15,000 · 01 Oct 2026 · Auto-charge to Visa ···· 4417"
- "Update payment method →" link
- Invoice history — `{{ invoices }}` loop: `{{ inv.date }}` / `{{ inv.note }}` / `{{ inv.amount }}` / `{{ inv.status }}` + "Download PDF"
- "Invoices are immutable once issued. Corrections are made by credit note, never by amending the original."

**Right — Purchase additional tokens:**
- "Top-up tokens are added immediately and do not expire at renewal."
- Service: "All disciplines (combined)" (dropdown)
- Quantity stepper: `{{ dec }}` (−) · `{{ qtyLabel }}` · `{{ inc }}` (+)
- Price: `{{ price }}` — "Rate card v1.1 · $0.005 per 1K tokens"
- Payment gateway selector: `{{ gateways }}` loop · `{{ g.label }}` radio options
- "Proceed to payment →" (navy primary)
- "Payment is processed securely via the selected gateway. No card details are stored on this platform."

---

## Data Wiring

```typescript
const { subscription, ratecards, config, purchase } = useAdminStore()
// MSW: GET /api/services/dashboard → subscription.json
// MSW: GET /api/super-admin/rate-cards → ratecards.json
// MSW: GET /api/admin/config → platformConfig.json
// MSW: POST /api/services/topup → { success: true, checkoutUrl: '/mock-checkout' }

// Stepper steps
const STEPS = [100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000]
const [stepIdx, setStepIdx] = useState(2)  // default 500K
const qty = STEPS[stepIdx]
const qtyLabel = `${(qty / 1000).toLocaleString()}K tokens`

// Price derives from active rate card
const baseRate = ratecards.find(r => r.status === 'active')?.rates
  .find(r => r.serviceType === 'AI Tokens (base)')?.rate ?? 0.005
const price = `$${((qty / 1000) * baseRate).toLocaleString()}`

// Gateway options from platformConfig.json activeGateways array
const gateways = config.paymentGateways.filter(g => g.status === 'active')

// Expired rate card blocks purchase
const isExpired = new Date(ratecards.find(r=>r.status==='active')?.validUntil) < new Date()
```

---

## Implementation Notes (from design review)

- Quantity is a **stepper widget** (`{{ dec }}` / `{{ qtyLabel }}` / `{{ inc }}`), not a text input — steps through `[100K, 250K, 500K, 1M, 2M, 5M]`
- `{{ price }}` derives from: `(qty / 1000) × activeRateCard.rates.find('AI Tokens (base)').rate`
- `{{ gateways }}` / `{{ g.label }}` loop wires from `platformConfig.json` `paymentGateways` where `status === 'active'` — Stripe, RazorPay, UPI, Net Banking
- Plan name is **Professional** (not Enterprise) — wire from `subscription.planName`
- Invoice immutability note: "Invoices are immutable once issued. Corrections are made by credit note, never by amending the original." — hard-code this note
- If expired rate card detected, disable "Proceed to payment →" with: "A new rate card must be published before purchases can resume"
- "No card details are stored on this platform." — hard-code

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Plan name shows "Professional plan" (not Enterprise). Scope table shows 4,000,000 · 1,847,200 · 2,152,800. (AC-PM-018)
2. Invoice history shows 3 rows from `subscription.json` `invoices` array. Each has "Download PDF" link.
3. Quantity stepper starts at 500K tokens. − and + buttons step through [100K, 250K, 500K, 1M, 2M, 5M]. Price updates with each step.
4. Payment gateway radio shows 4 active options from `platformConfig.json`: Stripe, RazorPay, UPI, Net Banking.
5. "No card details are stored on this platform." note is visible. "Invoices are immutable" note is visible.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM17-subscription-payment.md and execute.
Build SubscriptionPayment exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM13-subscription-payment.html.
Run all 3 validation passes and report results before awaiting Session PM17.
```
