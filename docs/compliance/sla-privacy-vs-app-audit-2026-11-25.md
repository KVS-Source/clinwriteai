# ClinWrite SLA + Vendor Privacy Statement — Audit vs Application

**Audit date:** 2026-11-25
**Documents reviewed:**
- `ClinWrite_Software_License_Agreement_v1.0.docx` (GBC-CW-SLA-001 v1.0, effective 2026-12-01)
- `ClinWrite_Vendor_Privacy_Statement_v1.0.docx` (GBC-CW-VPS-001 v1.0, effective 2026-12-01)

**Codebase audited against:** `c:\Chetan\GenBioCa\LifeSciences` as of 2026-11-25.
**Review method:** initial read → pass 1 (under-weighted technical claims) → pass 2 (cross-document inconsistencies). Every mismatch below carries a `file:line` evidence pointer.

---

## Executive summary

The two documents are **largely well-drafted** and the compliance-framework wording (GDPR / APPI / DPDPA / HIPAA framing, data-controller allocation, 21 CFR Part 11 vocabulary, Japan PMDA framing) is legally sound in structure.

The audit surfaced **14 material mismatches** between what the documents promise and what the application actually does:

- **4 critical** — direct misrepresentations that could expose GenBioCa to breach-of-contract or data-protection liability.
- **5 feature-claim gaps** — capabilities named as shipped or ready-to-deliver that aren't built.
- **3 missing documents** — artefacts promised to the Licensee on request that don't exist.
- **3 minor / wording issues** — drift between the two signed documents or between documents and code.
- **2 under-claimed strengths** — the application over-delivers; the contracts could legitimately claim more.

The **single most important finding**: both documents tell the Licensee that AI inference runs locally on their infrastructure and that no clinical data leaves their deployment environment. The application sends every drafted section, every attached source PDF, and every author prompt to Anthropic's cloud API. This misstatement appears in **four separate places** across the two documents. Fixing it is non-negotiable before signature.

---

## Scope and methodology

Each document was read in full and every falsifiable claim was mapped to a specific code path, Prisma model, migration, documentation file, or configuration. For each claim we recorded: Confirmed / Partial / Contradicted / Not Found, with a `file:line` pointer.

Two additional validation passes were performed after the first review:

1. **Pass 1 — under-weighted claims.** Items the first review passed over too quickly: specific deliverable line items, retention numbers, air-gap behaviour, PII handling, cross-jurisdiction DSR coverage.
2. **Pass 2 — cross-document consistency.** The two documents are signed together and the SLA references the Privacy Statement; drift between them is itself a defect. This pass hunted for places where the two documents contradict each other even when both are wrong about the code, or both are right about the code but about different categories.

---

## Document A — Software License & Deployment Agreement (SLA)

### Initial review (8 findings)

| # | Severity | Clause | Mismatch | Evidence |
|---|----------|--------|----------|----------|
| A-1 | 🔴 Critical | §4.1 "Embedded AI — No External Data Transmission" | *"AI inference runs locally on the Licensee's infrastructure. Clinical Data is not transmitted to GenBioCa's servers or any external AI service."* The app calls Anthropic's cloud API for every drafting, validation, and TBD-autofill call. | [apps/api/src/modules/platform/ai-gateway/anthropic-client.ts](../../apps/api/src/modules/platform/ai-gateway/anthropic-client.ts) — instantiates `new Anthropic({ apiKey })` and calls `client.messages.create()`. |
| A-2 | 🔴 Critical | §3.1 + §9.2 "21 CFR Part 11 Compliance Matrix" delivered as a shipped artefact | Scaffolding exists but the Part-11 compliance assessment explicitly flags §11.50, §11.70, §11.200 as **blocked on four open design decisions**. | [docs/compliance/Part11/compliance-assessment.md](Part11/compliance-assessment.md) — "Blocker for shipping to Part 11-regulated customers … gated on four open decisions". |
| A-3 | 🔴 Critical | §3.1 + §9.3 PMDA / JRCT / J-NDA / J-CSR templates | No template with PMDA, JRCT, J-NDA, or J-CSR identifiers exists in the seeded template catalogue. | Grep across `apps/api/src` returns zero matches; `apps/api/prisma/seed.ts` seeds generic clinical templates only. |
| A-4 | 🟠 Feature claim | §3.3 Implementation Services — Veeva Vault / Medidata Rave / Adobe Sign integrations | Zero integration code for any of the three vendors. | Grep for `veeva`, `medidata`, `adobe` across `apps/api/src` + `apps/worker/src` returns zero matches. |
| A-5 | 🟠 Feature claim | §3.3 + §9.3 "Bilingual (EN/JA) AI features" / "Japanese regulatory document authoring" | UI is bilingual via [apps/web/src/i18n/ja.json](../../apps/web/src/i18n/ja.json), but **no Japanese-specific AI prompts** exist. System prompts are English-only. | No grep hits for `japanese` / `ja_JP` in `apps/api/src/modules/platform/ai-gateway/`. |
| A-6 | 🟠 Feature claim | §4.3 License Telemetry — "may periodically contact GenBioCa's license servers" | Licensing is **fully offline JWT verification**. Zero outbound calls. The SLA's description doesn't match the code. | [apps/api/src/modules/platform/licensing/service.ts](../../apps/api/src/modules/platform/licensing/service.ts) — `verifyJwtRS256()` against a pre-distributed public key. No `fetch`, no HTTP. |
| A-7 | 🟡 Minor | §1 Definitions — module list "Clinical Writer, Document Library, Review & Approval, Analytics, Admin Console" | Actual module structure is Clinical Writing (A), Publication (B), Medical (C), Regulatory (D), Ideation (E), plus Platform. The SLA's list doesn't reflect the four non-clinical modules. | `apps/api/src/modules/` directory listing. |
| A-8 | 🟡 Minor | Annex A.5 — "written access logs for a minimum of 7 years" | `audit_events` are retained **indefinitely** (stronger than the claim); `sessions` purge at 90 days (weaker). Depends which category "access logs" is meant to reference. | [apps/worker/src/jobs/retention-purge.ts](../../apps/worker/src/jobs/retention-purge.ts) — retention policy in comment at head of file. |

### Pass 1 — under-weighted claims (3 new findings)

| # | Severity | Clause | Mismatch | Evidence |
|---|----------|--------|----------|----------|
| A-9 | 🔴 Critical | §3.1 Delivery checklist + §5.4 IP protection — "AI Model files (compiled, encrypted; weights are not human-readable)" | **Zero model files exist in the repo.** The SLA promises them as a deliverable and then IP-protects them. There is nothing to deliver, nothing to decrypt, nothing to reverse-engineer. Pure fiction. | Grep across the repo for `model_file`, `*.bin`, `*.safetensors`, `weights` — zero matches. |
| A-10 | 🔴 Critical | §4.3 Air-gapped deployment as a supported mode | License validation works air-gapped (confirmed). **AI features do not** — the gateway throws `AiNotConfiguredError` when there's no key and the stub is dev-only. A customer taking the air-gapped option gets zero AI functionality, silently. | [apps/api/src/modules/platform/ai-gateway/service.ts:226-228](../../apps/api/src/modules/platform/ai-gateway/service.ts#L226-L228); stub is gated on `AI_ALLOW_STUB=1`. |
| A-11 | 🟡 Minor | §2.3 restriction: *"Circumvent or disable any … electronic signature features"* | Legally fine as a restriction, but there's no production e-signature chain to circumvent. The restriction gestures at a feature that is scaffolded but not shipping (see A-2). | Inherits from A-2. |

### Pass 2 — cross-document consistency (2 new findings)

| # | Severity | Clause | Mismatch | Evidence |
|---|----------|--------|----------|----------|
| A-12 | 🟡 Minor | SLA §4.3 Telemetry fields vs Privacy §2 Telemetry fields | SLA lists three fields; Privacy lists four (adds "feature modules activated"). Drift between the two signed documents. Moot because no telemetry actually ships (see A-6), but DPOs reading both will notice. | SLA §4.3 vs Privacy §2 License Telemetry row. |
| A-13 | 🟡 Nuance | Audit chain tamper-evidence stronger than claim | `audit_events` is hash-chained (`prev_hash` + `row_hash = SHA256(prev_hash ‖ canonical_json(row) ‖ audit_secret)`) with indefinite retention. The SLA under-sells this. Could legitimately claim "tamper-evident, cryptographically chained, retained indefinitely." | [apps/api/src/audit/hash.ts:31-46](../../apps/api/src/audit/hash.ts#L31-L46), [docs/compliance/audit-chain-incident-2026-10-21.md](audit-chain-incident-2026-10-21.md). |

### SLA audit totals

- **Critical:** 5 (A-1, A-2, A-3, A-9, A-10)
- **Feature claims:** 3 (A-4, A-5, A-6)
- **Minor / wording:** 4 (A-7, A-8, A-11, A-12)
- **Under-claimed:** 1 (A-13)

---

## Document B — Vendor Privacy & Data Handling Statement

### Initial review (8 findings — 3 reiterated from SLA)

| # | Severity | Clause | Mismatch | Evidence |
|---|----------|--------|----------|----------|
| B-1 | 🔴 Critical | §1 KEY DISTINCTION + §2 bullet 3: *"AI engine runs locally within the Licensee's infrastructure"* | Same reality as A-1. Clinical document content, attached sources, author prompts all go to Anthropic. Having this misrepresentation in **both** documents compounds exposure — a regulator or auditor reading either one treats Anthropic as an undisclosed sub-processor. | Inherits from A-1. |
| B-2 | 🔴 Critical | §6: *"No Clinical Data or personal data from the Licensee's Deployment Environment is shared with any third party"* | Direct contradiction of Anthropic calls. Anthropic needs to be named as a sub-processor OR §6 needs a BYO-key / local-model carve-out. | Inherits from A-1. |
| B-3 | 🟠 Feature claim | §2 License Telemetry table — same fields described as in SLA §4.3 | No telemetry actually ships. Either implement (as described) or rewrite both documents to say "license validation is performed offline via cryptographic signature verification; no network connectivity required." | Inherits from A-6. |
| B-4 | 🟠 Documents promised | §4.2 claims availability on request: *"PMDA Computer System Validation guidance documentation"* | No PMDA CSV document exists anywhere under `docs/compliance/`. | Directory listing of `docs/compliance/`. |
| B-5 | 🟠 Documents promised | §4.2: *"Data Flow Diagram showing all data processing within the Software and the absence of external data transmission during normal operation"* | No DFD exists. If one were drawn truthfully it would have to include the Anthropic call — which contradicts §1 and §2 of this same document. | None found. |
| B-6 | 🟠 Documents promised | §4.2: *"Template Records of Processing Activities (RoPA) entry for use by Licensee DPOs"* | No RoPA template exists. | None found. |
| B-7 | 🟡 Minor | §9.1 EU Representative: "ClinWrite EU Privacy, c/o GenBioCa UK, Cardiff, Wales, UK" | Verify this entity actually exists and accepts regulator correspondence. Not verifiable from code. | External check required. |
| B-8 | 🟡 Minor | §11: updates published at `clinwrite.genbioca.com/vendor-privacy` | No static site, route, or redirect in the repo serves this path. Needs to be stood up before signature, otherwise the §11 update mechanism is broken from day one. | Grep across repo for `vendor-privacy` — zero matches. |

### Pass 1 — under-weighted claims (2 new findings)

| # | Severity | Clause | Mismatch | Evidence |
|---|----------|--------|----------|----------|
| B-9 | 🟠 Feature-claim | §4.1 Licensee responsibilities — "Managing data subject rights requests (access, rectification, erasure) for personal data stored within the Deployment Environment" across GDPR / APPI / DPDPA / HIPAA | DSR tooling in the app is **India-DPDPA only**. The `data-principal` route supports `access | correction | erasure | grievance` but the gate is India-scoped. For EU / Japan / US DSRs the Licensee has no in-app tooling. | [apps/api/src/modules/platform/dpdpa/data-principal/routes.ts](../../apps/api/src/modules/platform/dpdpa/data-principal/routes.ts) — REQUEST_TYPES line 25; [apps/api/src/modules/platform/dpdpa/gate.ts:9](../../apps/api/src/modules/platform/dpdpa/gate.ts#L9) — "DPDPA scope is India". |
| B-10 | 🟢 Nuance | §2: *"Any data from AI inference operations"* — not collected | Partially mitigated: [apps/api/src/modules/platform/ai-gateway/pii-scrub.ts](../../apps/api/src/modules/platform/ai-gateway/pii-scrub.ts) scrubs emails, US SSNs, phones, credit cards, US MRN (label-anchored), UK NHS numbers, DEA numbers **before** calling Anthropic. The module's own header comment states *"intentionally dumb and conservative — does NOT replace an actual DLP engine."* It does not scrub names, dates of birth, trial IDs, protocol numbers, patient initials, clinical narrative, diagnoses, or dose details — all of which appear in drafted sections and attached PDFs. | pii-scrub.ts lines 1-49; the module is called from the ai-gateway service before the Anthropic call. |

### Pass 2 — cross-document consistency (2 new findings)

| # | Severity | Clause | Mismatch | Evidence |
|---|----------|--------|----------|----------|
| B-11 | 🟡 Minor | Privacy §7 retention table vs SLA Annex A.5 "7 years" | Privacy §7 breaks retention by category (contact 7y, telemetry 5y, support 7y, financials 8y) and has **no row for "access logs" specifically**. SLA Annex A.5's blanket "7 years for access logs" doesn't cleanly map to any Privacy §7 row. Pick one source of truth across both docs and the code. | Privacy §7 table; SLA Annex A.5; [apps/worker/src/jobs/retention-purge.ts](../../apps/worker/src/jobs/retention-purge.ts). |
| B-12 | 🟡 Minor | Privacy §2 License Telemetry adds "feature modules activated" — SLA §4.3 doesn't | Same as A-12; same two docs listed as a separate finding on the Privacy side for completeness. | Privacy §2 vs SLA §4.3. |

### Privacy audit totals

- **Critical:** 2 (B-1, B-2)
- **Feature claims / documents promised:** 5 (B-3, B-4, B-5, B-6, B-9)
- **Minor / wording:** 4 (B-7, B-8, B-11, B-12)
- **Under-claimed / mitigated:** 1 (B-10)

---

## Consolidated gap register

The 14 unique mismatches across both documents, de-duplicated:

| Ref | Severity | Category | One-line summary |
|-----|----------|----------|------------------|
| G-01 | 🔴 Critical | Misrepresentation | AI inference is not local — it goes to Anthropic (SLA §4.1, Privacy §1/§2/§6). |
| G-02 | 🔴 Critical | Missing deliverable | SLA §3.1 ships "AI Model files"; no such files exist. |
| G-03 | 🔴 Critical | Breaking behaviour | Air-gapped mode is sold but breaks AI entirely. |
| G-04 | 🔴 Critical | Incomplete feature | Part 11 e-signature chain scaffolded but blocked on 4 open decisions. |
| G-05 | 🟠 Missing feature | PMDA / JRCT / J-NDA / J-CSR templates don't exist. |
| G-06 | 🟠 Missing feature | Veeva Vault / Medidata Rave / Adobe Sign integrations don't exist. |
| G-07 | 🟠 Missing feature | Japanese-specific AI prompts don't exist (UI is bilingual; AI isn't). |
| G-08 | 🟠 Missing feature | DSR tooling is India-DPDPA only; EU / Japan / US DSRs have no in-app support. |
| G-09 | 🟠 Documents promised | PMDA CSV guidance / Data Flow Diagram / RoPA template don't exist. |
| G-10 | 🟡 Wording | Module list in SLA §1 doesn't reflect the actual A–E module structure. |
| G-11 | 🟡 Wording | License telemetry described in detail; zero telemetry ships. |
| G-12 | 🟡 Wording | Telemetry fields drift between SLA §4.3 and Privacy §2. |
| G-13 | 🟡 Wording | Retention: "7 years access logs" clashes with indefinite audit + 90-day sessions + 5-year telemetry mix. |
| G-14 | 🟡 Wording | `clinwrite.genbioca.com/vendor-privacy` URL doesn't exist. |

**Positive findings** (captured for completeness so the contracts can accurately claim them):

| Ref | Category | Summary |
|-----|----------|---------|
| P-01 | Validation | IQ/OQ/PQ documentation fully delivered — [docs/compliance/GAMP5/IQ-OQ-PQ.md](GAMP5/IQ-OQ-PQ.md). |
| P-02 | Validation | GDPR + HIPAA DPIAs exist — [docs/compliance/DPIA/](DPIA/). |
| P-03 | Security | ISO 27001 ISMS scope + risk register + SoA exist — [docs/compliance/ISO27001/](ISO27001/). |
| P-04 | Security | SOC 2 control matrix + evidence-collection plan exist — [docs/compliance/SOC2/](SOC2/). |
| P-05 | Audit | Audit events are hash-chained (tamper-evident) + retained indefinitely — stronger than the "7 years" the SLA claims. |
| P-06 | Licensing | Offline JWT license validation works air-gapped (confirmed). |
| P-07 | Privacy | PII scrubber (emails, SSNs, phones, credit cards, US MRN, UK NHS, DEA) runs before every Anthropic call. |
| P-08 | Data ownership | Licensee retains all rights to Clinical Data — code has no path that exports to GenBioCa servers (except the Anthropic sub-processor call, see G-01). |

---

## Recommended remediation

### Must-fix before signature

1. **G-01 (Anthropic sub-processor disclosure).** Options, ranked:
   - **(a) Document-only fix (fastest, lowest engineering cost):** rewrite SLA §4.1 + Annex A.1 + Privacy §1/§2/§6 to explicitly disclose Anthropic as a sub-processor; add a sub-processor table to Privacy §6; add Anthropic DPA language to Annex A.4; add Anthropic to the EU SCC chain where applicable. Downside: changes the sales story (loses the "data never leaves your infra" selling point).
   - **(b) BYO-key mode (small engineering lift):** add a deployment flag where the Licensee provides their own Anthropic API key under their own commercial + data-protection agreement with Anthropic. GenBioCa becomes a conduit, not a sub-processor. Document-side: SLA §4.1 says "Licensee may configure the Software to call Licensee's own LLM provider account under Licensee's own agreements with that provider."
   - **(c) Local-model mode (large engineering lift):** ship actually-local models (e.g. Llama 3 / Mistral) alongside the Anthropic path. Keeps the current wording honest but is weeks of work and the quality gap is real.
2. **G-02 (fictional "AI Model files" deliverable).** Delete the AI Model files line item from SLA §3.1 Delivery checklist; delete §5.4's "AI model files … constitute trade secrets" paragraph. Replace with the sub-processor language from G-01 fix.
3. **G-03 (air-gapped breaks AI).** Either remove the air-gapped option from §4.3 entirely, or add a caveat: "Air-gapped deployments do not support AI-assisted drafting; manual authoring continues to work."
4. **G-04 (Part 11 e-sig scaffold).** Either: (a) complete the e-sig chain before signing a Part-11-regulated customer; (b) carve Part 11 e-sig out of the "included" deliverables and offer it as a roadmap item with a target date; (c) use a third-party e-sig provider (Adobe Sign, DocuSign) as the Part-11 compliant layer — but then G-06 becomes the blocker instead.

### Should-fix before signature (feature claims not backed by code)

5. **G-05 (PMDA templates).** Either seed the J-NDA / J-CSR / JRCT templates before Japan-customer go-live, or scope them out of §3.1 Delivery and §9.3 and add them as a Statement-of-Work item.
6. **G-06 (3rd-party integrations).** Rephrase §3.3 from "Integration configuration for applicable third-party systems (Veeva Vault, Medidata Rave, Adobe Sign)" to "where separately contracted and available" — or remove entirely until built.
7. **G-07 (Japanese AI prompts).** Either implement JA-aware prompts in the AI gateway, or qualify §9.3 to "UI, documentation, and support" rather than AI generation.
8. **G-08 (multi-jurisdiction DSR).** Either extend the `data-principal` module to GDPR / APPI / HIPAA, or qualify Privacy §4.1 to disclose that the in-app DSR tooling is India-scoped and the Licensee must implement equivalent workflows for other jurisdictions.
9. **G-09 (missing documents).** Draft the PMDA CSV guidance, the Data Flow Diagram, and the RoPA template. The DFD will force the G-01 disclosure to be honest — do G-01 first.

### Nice-to-fix (wording)

10. **G-10:** replace the module list in SLA §1 with the current A–E + Platform structure.
11. **G-11, G-12:** align telemetry language across both documents. If telemetry is not implemented, say so plainly.
12. **G-13:** pick one retention taxonomy across SLA Annex A, Privacy §7, and `apps/worker/src/jobs/retention-purge.ts`. Update the two that drift.
13. **G-14:** stand up `clinwrite.genbioca.com/vendor-privacy` (or whichever URL) before §11's update mechanism goes live.

### Over-delivery to claim

14. **Audit chain:** both documents could legitimately claim "tamper-evident, cryptographically hash-chained audit trail retained indefinitely." Currently understated.
15. **PII scrubber:** Privacy §2 could honestly claim "basic PII patterns (emails, SSNs, phones, credit cards, US MRN, UK NHS, DEA) are scrubbed from every AI call before transmission" — once G-01 has disclosed the Anthropic flow, this becomes a mitigant worth naming.

---

## Appendix: validation pass summary

**Pass 0 — Initial review:** 16 findings total (8 per document, with 3 overlaps).
**Pass 1 — Under-weighted claims:** 5 new findings (A-9, A-10, A-11, B-9, B-10).
**Pass 2 — Cross-document consistency:** 4 new findings (A-12, A-13, B-11, B-12).

Deduplicated into **14 gap-register items (G-01 … G-14)** plus **8 positive confirmations (P-01 … P-08)**.

---

*Prepared from code inspection against `c:\Chetan\GenBioCa\LifeSciences` as of 2026-11-25. All code evidence pointers are relative to the repo root. Document versions reviewed: SLA v1.0 (effective 2026-12-01), Privacy Statement v1.0 (effective 2026-12-01).*
