# CD Prompt — sD05 CMC & Nonclinical Finalisation
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-004, FR-D-010, FR-D-011, FR-D-012, FR-D-013  
**Screen code:** sD05  
**Output file:** `aurora-sD05-cmc-nonclinical-finalisation.html`

---

## Screen Purpose

Stage 3 — review and finalise Modules 1, 3, 4, and 5 of the CTD dossier. CMC Lead signs off Module 3, Nonclinical Lead signs off Module 4, Module 5 is confirmed as imported read-only from Module A (DD-D-001), and regional administrative documents (Module 1) are finalised per target HA. CMC Data Readiness scoring is surfaced here with the full detail view.

---

## Layout

Tab-based layout. Four tabs across the top: Module 1 (Regional) / Module 3 (CMC) / Module 4 (Nonclinical) / Module 5 (Clinical — Read-Only). Default tab: Module 3 (CMC) — most complex.

**Header:** "Modules 1 & 3–5 Finalisation · Stage 3" breadcrumb, stage dot 3 active (crimson), "Submit to Super Review →" button (gated — inactive until all four module tabs are signed off).

---

## Module 3 (CMC) Tab — Default View

**CMC Readiness Report panel (top):**
- Completeness score ring: 84% filled crimson arc
- "CMC Lead sign-off required for all sections before proceeding"
- Acknowledged risk note displayed: "Stability data batches 3 and 4 pending · Risk acknowledged by Dr R. Patel · 12 Oct 2026 · Logged to audit trail"

**Module 3 section list:**
Each row: section code / title / status / sign-off button

| Section | Title | Status | Action |
|---------|-------|--------|--------|
| 3.2.S | Drug Substance | ✓ Signed off — Dr R. Patel · 14 Oct | Locked |
| 3.2.P | Drug Product | ✓ Signed off — Dr R. Patel · 14 Oct | Locked |
| 3.2.A | Appendices | ⚠ Stability gap — batches 3&4 pending | Sign off with risk note |
| 3.3 | Literature References | ✓ Signed off | Locked |
| 3.4 | Regional (FDA) | ○ Not started | Start |

ICH Q-series validation status: "3.2.S: Q11 ✓ · Q8 ✓ · 3.2.P: Q8 ✓ · Q9 ✓ · Q10 ✓"

Cross-reference check: "Module 2.3 (QOS) → Module 3: 12 cross-refs verified ✓ · 0 broken."

---

## Module 1 (Regional) Tab

**Cover Letters:**
Two cover letter rows:
- FDA: "Cover Letter (FDA) · System-generated template ✓ · Personalise →"
- EMA: "Cover Letter (EMA) · System-generated template ✓ · Personalise →"

**Regional Forms (FDA):**
- Form FDA 1571: "Auto-populated from project record · IND application · Review →"
- Form FDA 1572: "Statement of Investigator — requires investigator e-signature"

**Country-specific label differences:**
"3 country-specific label differences detected between EU SmPC and US USPI. View label comparison →"
Three difference chips in amber: "§4.1 Therapeutic indication — EMA wording differs" / "§4.4 Special warnings — US-only black-box warning" / "§4.8 Adverse effects — reporting frequency format differs"

---

## Module 4 (Nonclinical) Tab

**ICH S-series validation:**
- Studies validated against ICH S1–S9 structure
- "22 nonclinical study reports · ICH S1 ✓ · S4 ✓ · S6 ✓ · S7A ✓ · S8 ✓"

**Cross-reference check:**
- "Module 2.4 → Module 4: 8 refs verified ✓"
- "Module 2.6 → Module 4: 14 refs verified ✓"

**Sign-off row:** "Nonclinical Lead sign-off: Dr A. Bhatt ○ Pending"
"Sign off Module 4" button (Nonclinical Lead role only).

---

## Module 5 (Clinical — Read-Only) Tab

**Read-only import panel:**
Large read-only banner: "Module 5 — Imported from Module A · Read-only in Module D"
"Any edits to clinical study reports must be made in Module A. A new CSR version in Module A triggers a cross-functional data sync alert (FR-D-025)."

**Imported documents list:**
- VELORA-301 Phase III CSR v1.0 · Signed 28 Oct 2026 · Module A · "View in Module A →" link
- Module 5 TOC: auto-generated from imported CSRs ✓

**Cross-reference status:**
"Module 2.5 → Module 5: 18 refs verified ✓ · 2 flagged ⚠ (resolve in editor sD04)"

---

## Sign-off Summary (bottom strip)

Four mini sign-off cards in a horizontal strip:
- Module 1: "Pending — complete regional forms"
- Module 3: "⚠ Partial — stability gap acknowledged"
- Module 4: "Pending — Nonclinical Lead sign-off"  
- Module 5: "✓ Imported from Module A"

"Submit to Super Review →" activates only when Module 3 (with risk note) and Module 4 are signed off, Module 1 regional forms are complete, and Module 5 shows imported status.

---

## Design Notes

- The CMC Readiness ring (84% crimson arc) should be the visual anchor of the Module 3 tab — place it prominently at the top.
- The Module 5 read-only banner is the most important compliance communication on this screen — make it impossible to miss. Use a full-width steel blue `#005F8E` info banner, not a subtle chip.
- Country-specific label differences use amber chips — they are warnings, not errors. They require review but do not block progression.


> **Design rule — DD-D-001:** The Module 5 tab must display a full-width steel blue info banner: 'Module 5 — Read-only. Imported from Module A. Sign off from all leads required before Super Review.' The CMC Lead and Nonclinical Lead sign off buttons are role-gated — visible only to the assigned role.
