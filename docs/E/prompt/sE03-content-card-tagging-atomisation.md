# CD Prompt — sE03 Content Card Tagging & AI Atomisation
**Module:** E — Ideation & Publishing · Steel Blue `#005F8E`
**PRD refs:** FR-E-006, FR-E-007, FR-E-009, DD-E-001, DD-E-004
**Screen code:** sE03
**Output file:** `aurora-sE03-content-card-tagging-atomisation.html`

---

## Screen Purpose

Stage 2 (Under Review) — the core ideation workspace. The Ideation Lead and Voice Note Contributors tag sections of the uploaded artefact as ideation content cards, then use AI atomisation to generate channel-specific adaptations. The claim-level provenance record (FR-E-009) is built here. No document editor — content is tagged from the source, then AI-reformatted.

---

## Layout

Three-panel layout:
- Left (~280px): Source document panel (read-only)
- Centre: Content card workspace
- Right (~300px): AI Atomisation panel

**Header:** "Content Card Tagging · Stage 2" breadcrumb, "VELORA-301 KOL Session Summary · Oncology", stage dot 2 active (steel blue), "Run compliance screen →" primary button → sE04. Voice note recorder button (reuses Module A VoiceNotePanel).

---

## Left Panel — Source Document (Read-Only)

Paginated read-only view of the uploaded PDF. "Source document — read-only. Tag sections to create ideation content cards."

Module of origin chip: "Module C · Medical Writing · MLR Approved ✓"

Highlighted section (paragraph) with a "Tag as content card" affordance — steel blue bracket on the left margin + "Tag +" button when hovering:

Example tagged section (highlighted steel blue background):
> "Veloricept plus pembrolizumab demonstrated clinically meaningful improvement in progression-free survival (hazard ratio 0.61; 95% CI 0.48–0.77) across all pre-specified subgroups, with a tolerability profile consistent with the pembrolizumab class."

Below the tagged section: small provenance chip automatically generated: "Source: VELORA-301 KOL Session Summary · §3.2 Efficacy Review · MLR Approved 20 Oct 2026"

Voice note panel: collapsed bar at the bottom of the left panel. "3 voice notes recorded · View →" — expands to show three voice note cards with transcriptions, each associated with a specific section.

---

## Centre — Content Card Workspace

Header: "3 content cards tagged" with "+ Tag new section" button.

Three content card tiles:

**Card 1 — Efficacy Claim (active):**
- Steel blue header strip with card number "C-001"
- Source passage excerpt (first 80 chars truncated)
- Provenance trail: "Source: KOL Session Summary §3.2 → CSR v1.0 Table 14.2.1 → Module A" (chain chip)
- Claim currency: "✓ Current — supported by SmPC v2.1"
- Ideation category chip: "HCP · Social · Blog" (multi-select)
- TA: "Oncology"
- "Atomise ✦" button

**Card 2 — Safety Profile:**
- Status: "Atomised — 4 channels ready"
- Green "Atomised ✓" badge
- Channel chips generated: LinkedIn ✓ / Blog ✓ / HCP ✓ / Email ✓

**Card 3 — Subgroup Insight:**
- Status: "⚠ Claim currency warning acknowledged" (amber)
- "Atomise ✦" button

---

## Right Panel — AI Atomisation (FR-E-007)

**Active card selected: C-001 Efficacy Claim**

Channel format selector — 8 channel cards in a grid (2×4), each selectable:
LinkedIn / X/Twitter / Blog Post / Email Snippet / HCP Summary / Medical Affairs Comms / Instagram / Facebook

Selected: LinkedIn (steel blue border) + Blog Post (steel blue border)

"Generate ✦" button (steel blue). Shows AI generating indicator (spinner, 10 seconds per channel per DD-E-004).

**Generated LinkedIn adaptation (card):**
AI footprint chip: "AI footprint ✦" (steel blue-tinted `#F0F7FF`)
Char count: "847 / 3000"
Generated text (editable inline):
"New data from the VELORA-301 Phase III trial reinforces the clinical benefit of combining veloricept with pembrolizumab in first-line advanced NSCLC. The hazard ratio of 0.61 across all PD-L1 subgroups supports a broad patient population benefit. Full data published in NEJM. #Oncology #NSCLC #ClinicalTrial"
Source provenance chip: "Source: KOL Session Summary §3.2 · CSR v1.0 Table 14.2.1"
Actions: "Accept" / "Edit" / "Regenerate ✦"

**Token usage indicator:**
IBM Plex Mono small: "Token usage: 847 tokens · 2 channels generated · Budget: 12,400 / 50,000 this month"

---

## Design Notes

- DD-E-001: Module E has NO document editor. The left panel is strictly read-only with tagging affordances. No text can be created or edited in the source document panel.
- **Editing scope (FR-E-007 / DD-E-001):** The AI-generated channel adaptation text shown in the right panel is the only place in Module E where text is directly edited by the Ideation Lead. Editing a channel adaptation (LinkedIn post, blog excerpt, etc.) is editing the AI-generated derivative — it is not editing the source document. Make this distinction visible in the UI: show a clear label on the right panel "Editing: LinkedIn adaptation (AI-generated)" and on the left panel "Source document — read-only".
- The provenance chain chip ("Source: KOL Session Summary §3.2 → CSR v1.0 Table 14.2.1 → Module A") is the key demo element of FR-E-009. It must be visible on every content card without expanding or clicking.
- AI-generated text uses a steel blue tint background (`#F0F7FF`) — lighter and less prominent than Module C/D crimson tint — because Module E is a communications module, not a regulated authoring module.
- DD-E-004: one AI call per channel format. Show a spinner per channel, not a single spinner. Users can watch each format complete in sequence.
