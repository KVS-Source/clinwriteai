# CD Prompt — sD08 PPD/CCI Redaction Tool
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-014  
**Screen code:** sD08  
**Output file:** `aurora-sD08-ppd-cci-redaction.html`

---

## Screen Purpose

The dedicated full-screen PPD/CCI redaction review tool, accessible from sD07 when the user clicks into the detailed redaction workflow. The sD07 panel shows the summary; sD08 is the document-by-document redaction confirmation screen. The Regulatory Writer confirms each AI-detected instance before the public copy is finalised.

---

## Layout

Two-panel split. Left: document list + redaction progress sidebar (~300px). Right: document viewer with inline redaction markup (fills remaining width).

**Header:** "PPD/CCI Redaction · Stage 5" breadcrumb, "23 of 55 confirmed · 32 remaining" progress chip (amber), "Generate public copy →" button (gated until all 55 confirmed), "Back to Publishing →" link to sD07.

---

## Left Panel — Document List

Header: "12 documents with detected instances"

Document list (scrollable), each row:
- Document name
- PPD count chip (crimson-tinted if unconfirmed remain, green if all done)
- CCI count chip
- Progress: "3/8 confirmed"

Example rows:
- "5.3.1 CSR VELORA-301 Phase III" · PPD 38 · CCI 6 · [14/44 confirmed]
- "5.3.1 Appendix — Patient Listings" · PPD 9 · CCI 0 · [9/9 confirmed ✓]
- "2.7.6.2 Patient Profiles" · PPD 0 · CCI 2 · [0/2 confirmed]

Active document highlighted with crimson left border.

Below list: "Two output versions:"
- "Original (unredacted) — Restricted access · Regulatory Writer + Reg Affairs Lead only"
- "Public redacted copy — Generated after all instances confirmed"

---

## Right Panel — Document Viewer with Redaction Markup

Displays the active document (CSR VELORA-301). Document rendered as paginated PDF-style view with inline redaction overlays.

**Redaction instance types:**

**PPD — Confirmed (already confirmed by user):**
- Black redaction bar over text: `████████` with small green chip "✓ PPD · Confirmed · Dr S. Chen"

**PPD — Unconfirmed (awaiting confirmation):**
- Yellow highlight over text (AI detection, pre-confirmation): `PT-VELORA-301-004`
- Below the highlighted text: action bar —
  "AI detected: Patient ID · Confirm redaction [✓ REDACT] or [✗ KEEP — requires justification]"
  If KEEP is selected: justification field appears.

**CCI — Unconfirmed:**
- Blue highlight: `[Formulation patent pending · Confidential]`
- Action bar: "AI detected: CCI — Commercially Confidential · [✓ REDACT] or [✗ KEEP — requires justification]"

**Page navigation:** "Page 24 of 387" with prev/next and "Go to page" input. "Jump to next unconfirmed →" link (most useful action — crimson text button).

**Redaction progress for active document:**
Compact strip below viewer: "Page 24: 2 instances · 1 confirmed · 1 remaining. [Confirm all on page →]"

---

## Audit trail footer (document-level):
IBM Plex Mono strip: "Redaction session · 15 Oct 2026 · Dr Sarah Chen · All confirmations logged to audit trail · Pre-redaction version retained under restricted access."

---

## Design Notes

- "Jump to next unconfirmed →" is the most important interaction in this screen — users will be confirming up to 55 instances across 12 documents. This action must be prominent.
- The two highlight colours (yellow = PPD, blue = CCI) must be distinct and have high contrast against the white document background.
- Confirmed redactions become black bars immediately — visual feedback that the action is irreversible.
- Never use the word "delete" anywhere in this screen — use "redact." These are legal documents and the language matters.
