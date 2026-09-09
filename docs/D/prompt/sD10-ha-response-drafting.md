# CD Prompt — sD10 HA Response Drafting
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-022, FR-D-023, FR-D-004 (DD-D-004)  
**Screen code:** sD10  
**Output file:** `aurora-sD10-ha-response-drafting.html`

---

## Screen Purpose

Post-submission Stage 6 — when the Health Authority issues a List of Questions (LoQ) at Day 80, 120, or 180, the Regulatory Writer uploads it and the AI drafts a structured response package grounded in the original submission dossier. One of Aurora's strongest differentiators: no competitor offers AI-drafted HA responses anchored in the original canonical JSON layer.

---

## Layout

Two-column layout. Left: LoQ question list + upload panel (~360px). Right: AI-drafted response for the selected question (fills remaining width).

**Header:** "HA Response Drafting · Day 120 List of Questions · FDA" breadcrumb, "12 questions · 4 responded · 8 remaining" status chip (amber), "Submit response package →" button (gated — requires all questions responded and Reg Writer + Clinical Lead sign-off).

---

## Left Column — LoQ Question List

**Upload panel (collapsed after upload):**
"FDA Day 120 LoQ · Uploaded 22 Oct 2026 · 12 questions · Auto-parsed ✓"
Status: "12 questions extracted · Auto-parsed ✓ · Categorised: Clinical (7) · CMC (3) · Administrative (2) · Routed to RACI roles"
"View LoQ document →" link.

**Question list (scrollable):**
Each row: question number / category chip / respondent chip / status dot.

Selected question (Q3) highlighted with crimson left border:

- Q1 · Clinical · Dr E. Vasquez · ✓ Responded
- Q2 · CMC · Dr A. Patel · ✓ Responded  
- **Q3 · Clinical · Dr S. Chen · ● In progress** ← active
- Q4 · Clinical · Dr E. Vasquez · ✓ Responded
- Q5 · CMC · Dr A. Patel · ○ Not started
- Q6 · Administrative · Dr J. Hartley · ○ Not started
- Q7–Q12 · (collapsed — "8 more questions")

Category chips: Clinical = blue, CMC = amber, Administrative = grey.

---

## Right Column — Active Question (Q3)

**Question header:**
"Question 3 · Clinical · Day 120 · FDA · Assigned: Dr Sarah Chen"

**HA Question (original text — read-only, blue-grey background):**
"Please provide additional subgroup analyses for the primary endpoint (progression-free survival) stratified by baseline ECOG performance status (0 vs 1–2) and histology (squamous vs non-squamous), with associated confidence intervals and p-values for interaction."

---

**AI Draft Response:**

AI draft badge: "✦ AI draft · Generated 22 Oct 2026 09:44 UTC · claude-sonnet-4-6 · Grounded in canonical JSON layer · Logged to audit trail"
AI footprint chip: "AI footprint · 68% ✦"

Draft response (editable — same editor as sD04, crimson tint on AI-generated paragraphs):

> "GenBioCa Sciences thanks the FDA for this question. We provide the requested subgroup analyses below.
>
> **ECOG Performance Status Subgroup:**  
> Hazard ratio: ECOG 0 — HR 0.57 (95% CI 0.43–0.76; p<0.001); ECOG 1–2 — HR 0.66 (95% CI 0.50–0.87; p=0.003). Interaction p-value: 0.42 (non-significant). [Source: VELORA-301 CSR v1.0 · Table 14.2.7.1]
>
> **Histology Subgroup:**  
> Squamous — HR 0.59 (95% CI 0.42–0.83; p=0.003); Non-squamous — HR 0.62 (95% CI 0.46–0.83; p=0.002). Interaction p-value: 0.71 (non-significant). [Source: VELORA-301 CSR v1.0 · Table 14.2.7.2]"

Inline source chips: "CSR v1.0 · Table 14.2.7.1" and "CSR v1.0 · Table 14.2.7.2"

---

**Sign-off row:**
- Regulatory Writer: Dr Sarah Chen ● In review
- Clinical Lead: Dr Elena Vasquez ○ Pending

"Sign off this response" button (per role). After both sign: "Q3 ✓ Responded" in the question list.

---

**Response history (collapsed):**
"Previous version: Q3 draft v0.1 · 09:44 UTC · AI-generated · Full version history →"

---

## Design Notes

- The HA question text must be clearly visually separate from the AI draft — use a distinct blue-grey block for the question, white/crimson-tint background for the response draft.
- The inline source citation chips ("CSR v1.0 · Table 14.2.7.1") are the core demo moment — they prove the canonical JSON layer grounding claim that DD-D-004 specifies.
- "Auto-parsed ✓ · 12 questions extracted" after LoQ upload is a key demo moment — the system structures the LoQ automatically, it does not require manual formatting.
- Each question is routed to the correct RACI role (Clinical, CMC, Administrative) automatically — this routing logic should be visible in the question list via the assignee chip.


> **Auto-parsed LoQ:** When a LoQ document is uploaded, the system automatically extracts and numbers each question, categorises it (Clinical/CMC/Administrative), routes it to the correct RACI role, and generates a response letter template. The word "auto-parsed" should appear as a green status chip next to the uploaded LoQ filename — it is a key demo differentiator.
