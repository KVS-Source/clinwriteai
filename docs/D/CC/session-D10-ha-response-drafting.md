# Session D10 — HA Response Drafting
**Screen:** sD10 · HA Response Drafting
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId/ha-response`
**Component:** `src/modules/regulatory-writing/screens/HAResponseDrafting.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD10-ha-response-drafting.html`
**Data:** `src/data/haCorrespondence.json`
**Store:** `regulatorySubmissionStore`

---

## What to Build

Post-submission Stage 6 — the LoQ response drafting screen. From `haCorrespondence.json` hac-001 (FDA Day 120 LoQ, 12 questions total, 7 shown). AI drafts responses grounded in the canonical JSON layer (DD-D-004). Primary demo: q-001 AI-drafted and responded, q-003 AI draft in progress, q-004 not started.

---

## Screen Anatomy

Two-column. Left: LoQ question list + upload panel (~360px). Right: active question + AI draft.

**Header:** "HA Response Drafting · Day 120 List of Questions · FDA", "12 questions · 4 responded · 8 remaining" (amber chip — from hac-001.questionsExtracted and responded count). "Submit response package →" gated button.

**Left — LoQ upload panel (collapsed — already uploaded):**
From hac-001: "FDA Day 120 LoQ · Uploaded 22 Oct 2026 · 12 questions · Auto-parsed ✓"
- "12 questions extracted · Categorised: Clinical (7) · CMC (3) · Administrative (2) · Routed to RACI roles"
- "View LoQ document →" link

**Left — Question list:**
Seven questions from `haCorrespondence.json` hac-001.questions. Each row: number / category chip / assignee chip / status dot.

Category chip colours: Clinical = blue `#EFF6FF`/`#2563EB` · CMC = amber · Administrative = grey.
Status dots: responded = green ✓ · in-progress = ● crimson · not-started = ○ grey.

Rows (in order):
- Q1 · Clinical · Dr E. Vasquez · ✓ responded (green)
- Q2 · Clinical · Dr E. Vasquez · ✓ responded (green)
- **Q3 · Clinical · Dr S. Chen · ● in-progress** ← active, crimson left border
- Q4 · Clinical · Dr S. Chen · ○ not-started
- Q5 · CMC · Dr A. Patel · ✓ responded (green)
- Q6 · CMC · Dr A. Patel · ● in-progress
- Q7 · Administrative · Dr J. Hartley · ○ not-started

**Right — Active question (q-003, Q3):**

**HA question (read-only, blue-grey background `#F8FAFC`):**
"Please provide detailed subgroup analyses for the primary endpoint stratified by baseline ECOG performance status (0 vs 1–2) and histology (squamous vs non-squamous), with associated confidence intervals and p-values for interaction."

**AI Draft Response:**
AI badge: "✦ AI draft · Generated 22 Oct 2026 09:44 UTC · claude-sonnet-4-6 · Grounded in canonical JSON layer · Logged to audit trail"
AI footprint chip: "AI footprint · 72% ✦" (crimson-tinted)

Draft text (editable, crimson tint `#FFF5F5` on AI blocks):
> "GenBioCa Sciences thanks the FDA for this question. We provide the requested subgroup analyses below.
>
> ECOG Performance Status Subgroup:
> ECOG 0 — HR 0.57 (95% CI 0.43–0.76; p<0.001) [Source: CSR v1.0 · Table 14.2.7.1]
> ECOG 1–2 — HR 0.66 (95% CI 0.50–0.87; p=0.003) [Source: CSR v1.0 · Table 14.2.7.1]
> Interaction p-value: 0.42 (non-significant)
>
> Histology Subgroup:
> Squamous — HR 0.59 (95% CI 0.42–0.83; p=0.003) [Source: CSR v1.0 · Table 14.2.7.2]
> Non-squamous — HR 0.62 (95% CI 0.46–0.83; p=0.002) [Source: CSR v1.0 · Table 14.2.7.2]"

Two inline source citation chips: "CSR v1.0 · Table 14.2.7.1" and "CSR v1.0 · Table 14.2.7.2" (IBM Plex Mono).

**Sign-off row:**
- Regulatory Writer: Dr Sarah Chen ● In review
- Clinical Lead: Dr Elena Vasquez ○ Pending

"Sign off this response" button (role-gated — visible to assigned roles only).

**Response history (collapsed):**
"Previous version: Q3 draft v0.1 · 09:44 UTC · AI-generated"

---

## Data Wiring

```typescript
const { data: haRecord } = useQuery(['ha-correspondence', submissionId],
  () => regulatoryWritingApi.getHACorrespondence(submissionId))
// MSW: GET /api/regulatory-submissions/sub-001/ha-correspondence → haCorrespondence.json
// Use hac-001 (the LoQ record with questions array)

const loqRecord = haRecord?.find(h => h.type === 'loq')  // hac-001
const [activeQuestionId, setActiveQuestionId] = useState('q-003')
const activeQuestion = loqRecord?.questions.find(q => q.questionId === activeQuestionId)

// Generate AI draft (3000ms simulated)
const handleGenerateDraft = (questionId: string) =>
  regulatoryWritingApi.generateHAResponse(submissionId, questionId)
// MSW: POST /api/regulatory-submissions/sub-001/ha-response/q-003/generate
// Returns: { draftText, sourceRefs: ['CSR v1.0 · Table 14.2.7.1', ...], aiFootprintPct: 72 }

// Submit response package gate
const responded = loqRecord?.questions.filter(q => q.status === 'responded').length ?? 3
// 3 responded (q-001, q-002, q-005) — package cannot be submitted until all 7 (or 12) done
const canSubmit = responded === (loqRecord?.questions.length ?? 0)
```

---

## Navigation

- Click question row → sets `activeQuestionId`, loads question in right panel
- "Submit response package →" → gated (all questions must be responded + signed)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. LoQ upload panel shows collapsed "Auto-parsed ✓" state: "12 questions extracted · Categorised: Clinical (7) · CMC (3) · Administrative (2)."
2. Question list shows correct status dots: Q1, Q2, Q5 green ✓; Q3, Q6 crimson ●; Q4, Q7 grey ○. Q3 has crimson left border (active).
3. The HA question text renders on a blue-grey `#F8FAFC` background. The AI draft renders on crimson tint `#FFF5F5`.
4. Two inline source citation chips appear within the draft text: "CSR v1.0 · Table 14.2.7.1" and "CSR v1.0 · Table 14.2.7.2" in IBM Plex Mono.
5. AI badge shows "Grounded in canonical JSON layer" text. AI footprint chip shows "72% ✦".

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D10-ha-response-drafting.md and execute.
Build HAResponseDrafting exactly as specified, run all 3 validation passes, and report results.
```
