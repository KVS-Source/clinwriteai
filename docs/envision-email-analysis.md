# Envision email — platform & PRD alignment analysis

Analysis of the Envision priority email against (a) what the platform
ships today and (b) what the PRDs commit to. Captured for revisit —
nothing in this doc is a build plan.

Source context: email thread proposing to share Envision-aligned
ClinWrite + GenRAC positioning with Dr. Deepti (and possibly Chetan).

---

## 1. The email, verbatim

### Envision priority table

| # | Envision Priority | GenBioCa Platform / Service | Value Created | Entry Point |
|---|---|---|---|---|
| 1 | Plan around decisions, not deliverables | ClinWrite | Evidence planning module; decision-linked content generation | Medical Affairs, Publications teams |
| 2 | Build AI-enabled evidence foundations | ClinWrite + GenRAC | AI authoring with governance, audit trail, traceability | Regulatory Affairs, Compliance |
| 3 | Integrate clinical, HEOR, and RWE | SDTM Accelerator + ClinWrite | Structured data foundation enabling cross-workstream integration | Biostatistics, Data Management |
| 4 | Design for broader audiences | ClinWrite | Multi-format, plain-language, multi-stakeholder output generation | Medical Affairs, Patient Advocacy |
| 5 | Measure real-world impact | Analytics module (new); Consulting | Impact dashboards; citation velocity, discoverability, field influence | Publications Strategy, Market Access |
| 6 | Build for global consistency | ClinWrite + Consulting | Multi-regional template governance; local adaptation workflows | Global Medical Affairs |
| 7 | Invest in people, process, OS models | Consulting / Staffing (Veeva, ZS) | Operating model design; embedded talent; CoE build | Leadership, Strategy |
| 8 | Build durable data infrastructure | SDTM Accelerator + GenRAC | CDISC-standard, auditable, reusable clinical data | Data Management, IT |

### 4.1 ClinWrite — "What GenBioCa can do"

- **a.** Add an evidence planning layer to ClinWrite — allowing users to log the stakeholder decision each document is intended to inform, before authoring begins
- **b.** Build a structured output library so a single evidence asset can be repurposed into multiple downstream formats without manual reformatting
- **c.** Develop audit trails that satisfy the EU AI Act and FDA AI governance expectations being referenced in the Envision paper
- **d.** Add multi-language support for plain language summaries — a gap specifically called out for patient and caregiver accessibility

### 4.2 GenRAC — "What GenBioCa can do"

- **a.** Position GenRAC's compliance rule engine as the governance backbone for AI-generated publications — the layer that ensures every AI-assisted draft is traceable, attributable, and defensible
- **b.** Extend GenRAC's rule library to include ISMPP GPP 2022 (Good Publication Practice guidelines) and ICH E6(R3) GCP requirements
- **c.** Build an integration between GenRAC and ClinWrite so compliance validation happens inline during document authoring, not as a downstream audit
- **d.** Create a 'Publication Compliance Pack' as a commercial offering — pre-loaded rules for GDPR, FDA 21 CFR Part 11, and EFPIA codes as applied to medical publications

---

## 2. Platform-today reality check (what we ship today vs. each priority)

| # | Priority | What the platform ships today | Gap vs. ask | Feasibility |
|---|---|---|---|---|
| 1 | Plan around decisions, not deliverables | `aiInstructions`, `DocumentBrief` (indication/population/endpoints), `keyMessage` on publications | No explicit "stakeholder decision this document informs" captured before authoring | **Small** — new `EvidencePlan` entity + wizard step |
| 2 | AI evidence foundations w/ governance | 85% confidence loop, hash-chained audit chain, AiDraftingPass log, policy pinning at create, Part 11 e-sig with TOTP+NTP, AiPromptRecord / BestPracticeRecord pointer refactor, Section Templates (NL rules, migration 91) | EU AI Act article mapping; explicit "AI-influence" flag on content spans; model-version-at-draft (exists but not surfaced) | **Small** — mostly mapping + exposure |
| 3 | Integrate clinical / HEOR / RWE | Project-level therapeutic area; no SDTM ingestion inside ClinWrite | Entire SDTM Accelerator integration surface | **Large & wrong home** — belongs in SDTM Accelerator, not ClinWrite |
| 4 | Multi-format output | One document → one type today. PLS, payer brief, poster not generable from the same evidence asset | Entire repurposing chain (manuscript → PLS → poster → brief from one source) | **Large but high-value** — credible moat |
| 5 | Post-publication impact | Publication module tracks publication state; no citation / altmetric / discoverability data | Entire post-pub analytics product. CrossRef + PubMed + altmetrics integrations all deferred (vendor-blocked) | **Medium if vendors contracted; zero without them** |
| 6 | Global consistency | DocumentTypePolicy versioned per doc type; platform templates governed; i18n Phase 1 planned (JA + pluggable) | No region layer on templates (US / EU / APAC). SectionTemplate is global, not locale-scoped | **Medium** — add `region` to DocumentTemplate + SectionTemplate; adapt resolver |
| 7 | People / process / OS models | N/A | Services line, not a product gap | **Not a software build** |
| 8 | Durable data infrastructure | Hash-chained audit chain, policy-version pinning, ADR 0002 immutability contract | No CDISC/SDTM ingestion into ClinWrite | **Belongs in SDTM Accelerator** |

### ClinWrite 4.1 — feasibility + worth-it per item

- **a. Evidence planning layer** — small lift. New `EvidencePlan` entity (decision text + stakeholder role + success criteria), wizard step before document create, surface in `DocumentBrief`. **Worth it** — differentiator, 1-2 weeks.
- **b. Structured output library** — large lift, highest value. Needs a "source-evidence" abstraction with derivation rules per format + prompt chains + template packs. **Worth it, 4-6 weeks minimum**. Phase it: PLS from manuscript first (the specifically-called-out gap), then payer brief, then poster.
- **c. EU AI Act / FDA AI audit trails** — ~90% of mechanics already shipped. AiDraftingPass has model+version+confidence+input/output hash. Audit chain is hash-chained. Part 11 captures TOTP+NTP. Mostly documentation + exposure. Add 2-3 new audit action types. **Worth it, cheap sales enabler.**
- **d. Multi-language PLS** — medium lift. Conditional on (b) — don't build PLS translation without PLS generation first. i18n Phase 1 is UI chrome only; content translation needs per-locale medical-term quality rubric.

### GenRAC 4.2 — feasibility + worth-it per item

(Structural read — GenRAC is a sibling repo, not deeply audited in this session.)

- **a. Position GenRAC rule engine as governance backbone** — small-to-medium (positioning + thin integration shim). **Worth it.**
- **b. ISMPP GPP 2022 + ICH E6(R3) in rule library** — medium (content work). **Worth it** — specifically named in Envision as the gap, low-tech, high-signal.
- **c. Real-time inline ClinWrite ↔ GenRAC integration** — large (cross-repo, latency budget, false-positive management). **Worth it after (a) and (b).** Start with "run compliance pack at draft-save" as background check.
- **d. Publication Compliance Pack commercial offering** — small (content), medium (packaging). **Worth it** — natural upsell once (b) and (c) land.

### Not worth building (or at least: not here, not now)

- **SDTM / CDISC ingestion inside ClinWrite** (Priority 3 + 8). Belongs in SDTM Accelerator. Cramming it into ClinWrite dilutes both products.
- **Full post-publication analytics** (Priority 5). Blocked on CrossRef + PubMed + altmetric vendor contracts per deferrals memory. Don't start the build before procurement closes.
- **Priority 7 (consulting / staffing)** — not a software deliverable at all.
- **Chasing every regional variation at once for Priority 6** — scope to US + EU first; APAC adds locale complexity without a named customer yet.

---

## 3. PRD audit — is any of this committed on paper?

Scan performed against: `docs/PRD_A_Clinical_Writing_v0_4.md`,
`docs/demo/PRD_B_Scientific_Writing_v0_1.md`,
`docs/demo/PRD_C_Medical_Writing_v0_1.md`,
`docs/demo/PRD_D_Regulatory_Writing_v0_2.md`,
`docs/demo/PRD_E_Ideation_Publishing_v0_3.md`.

### Fully covered in the PRDs

| Email claim | PRD evidence |
|---|---|
| Priority 2 — AI authoring with governance / audit / traceability | PRD_A:120 EU draft Annex 22; PRD_A:70-88 21 CFR Part 11 audit trail; PRD_A:181 every AI span flagged in UI + audit; PRD_B:120 GPP 2022 / ICMJE audit trail |
| Priority 4 + ClinWrite 4.1b — Multi-format output from one evidence asset | PRD_B:75 manuscripts, abstracts, posters, systematic reviews; PRD_E:95 AI multi-format content atomisation — one approved artefact → multiple channel cards; PRD_C:421 congress submission export |
| Priority 6 — Multi-region template governance | PRD_A:48 `ap-south-1` region; PRD_D:235 FDA / EMA / MHRA / CDSCO / PMDA pathways; PRD_D:239 country-specific variations flagged |

### Partially covered — email overstates what's in the PRD

| Email claim | What PRD actually says |
|---|---|
| Priority 1 / 4.1a — Evidence planning layer, stakeholder decision captured before authoring | PRDs document *audit trails that record* reviewer decisions (PRD_C:182) and SME decisions as a precondition to sprint planning (PRD_A:432) — but no named "evidence planning layer" or "stakeholder question" artefact captured *before* authoring |
| Priority 3 + 8 — CDISC / SDTM / HEOR / RWE | CDISC/SDTM **explicitly deferred** — PRD_A:78 "Full CDISC SDTM/ADaM ingestion pipeline (gap C1) — research item, not v0.1 target". HEOR is committed (PRD_C FR-C-010). **RWE not mentioned anywhere.** |
| Priority 5 — Post-publication analytics (citation velocity, altmetrics, field influence) | Only CrossRef DOI registration (PRD_B:341, PRD_E:396). **No altmetric, no citation velocity, no field-influence measurement anywhere in the PRDs.** |
| ClinWrite 4.1c — "EU AI Act and FDA AI governance" audit trails | PRD names **EU draft Annex 22** (PRD_A:120) — close cousin to EU AI Act but not the same regulation. **Neither "EU AI Act" nor "FDA AI" appears by name.** |
| ClinWrite 4.1d — Multi-language plain-language summaries | PLS is in Medical Writing PRD (PRD_C:136); multi-language PLS specifically is an **open question OQ-C-001**, not a commitment (PRD_C:66) |
| GenRAC 4.2b — ISMPP GPP 2022 + ICH E6(R3) in GenRAC rule library | GPP 2022 (PRD_B:134) and ICH E6(R3) (PRD_A:367) are referenced in ClinWrite PRDs as compliance standards — but **not as entries in a GenRAC rule library**. The PRDs don't frame compliance via GenRAC at all. |

### Not in the PRDs at all

| Email claim | Reality |
|---|---|
| Priority 7 — Consulting / staffing model | Expected — services line, not a platform spec. Fine. |
| GenRAC 4.2a — GenRAC compliance rule engine as "governance backbone" for AI publications | **Not in PRD.** Closest: PRD_A:438 notes "GenRAC-pattern adaptation in §6.8 — needs a validation pass" — flagged as pattern under review. |
| GenRAC 4.2c — Inline ClinWrite ↔ GenRAC integration during authoring | **Zero PRD evidence.** No "inline compliance", no "GenRAC integration" mentions. |
| GenRAC 4.2d — "Publication Compliance Pack" commercial offering | **Zero PRD evidence.** Not named anywhere. |

---

## 4. Share-out guidance (for the "share with Dr. Deepti" question)

- **Safe to lead with** (PRD-backed): governance / audit / traceability; multi-format output from one evidence asset; multi-regional template governance. These are the strongest positioning items against Veeva / Yseop / TrialAssure because competitors *claim* governance but don't run an 85% confidence loop with a hash-chained audit chain + Part 11 signature chain.
- **Flag as forward-looking** (platform supports it, PRD doesn't commit): evidence planning layer, EU AI Act / FDA AI naming, post-publication analytics, multi-language PLS. The underlying mechanics may be close but the email *frames them as current capability* and the PRDs don't commit to them that way.
- **Needs scoping before claiming externally**: the entire GenRAC side of the email (4.2a–d). The PRDs flag GenRAC as a pattern under review, not an integrated product line. Positioning it as "the governance backbone for AI publications" is a sales story that will need PRD updates + integration PRDs to back it.
- **Explicitly deferred**: CDISC/SDTM ingestion. If the Envision deck lands in front of a technical audience, they'll pull on this thread.

---

## 5. Open follow-ups to track

If any of these get prioritised, revisit this doc first so we don't
re-do the analysis:

- [ ] Draft PRD addendum bringing GenRAC integration items (4.2a–d) into the PRD so Envision framing has a spec to back it
- [ ] Decide whether "evidence planning layer" (4.1a) becomes a committed v1 feature or stays research
- [ ] Decide whether post-publication analytics (Priority 5) blocks on vendor procurement or scopes a vendor-neutral MVP (DOI + manual citation entry)
- [ ] Decide region strategy for Priority 6 — US + EU now, APAC with named customer later?
- [ ] If multi-format output library (4.1b) is prioritised, confirm the "PLS from manuscript first" ordering

## 6. Caveats on this analysis

- Platform-today claims are from the current `main` as of this writing. If the user has landed new work on ClinWrite after this doc, re-verify.
- PRD evidence is from the files listed in Section 3; `AURORA_Missing_Screens_PRD_v1.md` and `standalone/prd.md` were intentionally skipped.
- GenRAC side is a structural read, not a line-by-line audit (sibling repo).
- Competitor comparisons (Veeva / Yseop / TrialAssure) are domain knowledge, not verified feature audits — treat as "plausibly true, not fact-checked" for external claims.
