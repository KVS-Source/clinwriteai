1 · Wizard (UI)
User clicks Create Document → wizard opens.
User picks type (protocol / CSR-full / IB / …), fills title, therapeutic area, assignee, target date.
User selects source documents (previously uploaded CSRs, SAPs, IBs, TLFs — filtered to the categories relevant for the chosen doc type).
User optionally toggles Draft with AI, writes freeform AI instructions ("language: Japanese", "follow MHRA house style", etc.).
For protocol / protocol-amendment: user enters protocol metadata (study title, protocol number, sponsor, investigational product, regulatory region).
Submit → POST /projects/:projectId/documents.

2 · Document materialization (server, synchronous)
Validate inputs + project visibility + assignee eligibility + source-document usability.
Resolve the section skeleton: DB-backed DocumentTemplate first; fallback to built-in template for the doc type.
In one transaction: create Document row, DocumentVersion v0.1, one SectionContent row per template section, and auto-seed the assignee as R (Responsible) in DocumentRaci.
If sources were selected: write DocumentSource join rows.
Append document_created audit entry.
If Draft with AI + sources attached: flip aiDraftState = 'pending' and enqueue the clinical.ai_initial_draft job on BullMQ; otherwise skip to step 18.
Fire-and-forget: regenerate the Document Brief (compact outline + jurisdiction + sponsor rules + reference registry for later AI calls).
Respond 201 with the new document — UI redirects to the editor.

3 · AI initial draft (worker, async)
Worker picks up clinical.ai_initial_draft, flips aiDraftState = 'drafting'.

Reads each selected source from blob storage, extracts text (PDF → text, DOCX via mammoth, plain text as-is; scanned PDFs fall back to native Anthropic PDF input).
For each empty section: builds a scoped prompt (section number + title + the author's AI instructions + the source excerpts the template says this section needs) and calls app.aiGateway.chat(); writes the result as HTML into SectionContent.contentHtml + records ProvenanceRecord rows marking the AI spans.

4 · AI validation pass (worker, async, up to 5 passes)
Flip aiDraftState = 'validating'; create an AiDraftingPass row.
Autocheck engine runs per section — content-presence, references-complete, ICH-section coverage, and AI-pass strategies against the section HTML.
Each section gets aiConfidence (0–100 from the flag rubric) + an aiFlags[] array; the document rolls up as aiConfidenceOverall (average).
Any section below the confidence threshold is re-drafted (go back to step 17 for that section only) up to pass 5; after that the pass finishes.
Flip aiDraftState = 'complete' (or 'failed' if the gateway hard-errored).

5 · Author opens the editor
Editor loads the document, sections, confidence badges + flag chips per section, and the live presence of other users.
For protocol types the Protocol Metadata right-panel is pre-populated from step 5; author edits inline.
The AI Drafting Report panel shows the pass history, per-section confidence delta, and which flags resolved vs. new.

6 · Per-section AI edits (author interactive)
Author hits ⌘J or the bottom AI Prompt dock, types an instruction.
POST /documents/:id/sections/:sectionId/ai-suggest runs; if FEATURE_CARRY_PROMPT lists the doc type, the server loads the Document Brief + builds the compact carry prompt (role, hard rules, flag tokens, cross-ref + Vancouver rules) and prepends it to the user's instruction.
aiGateway.chat() returns revised text; server parses escape-hatch tokens ([Information Required: …], [Conflict: …], [Reference Verification Required: …], [Missing Cross-Ref Target: …]) out of the response.
Parsed flags are persisted into document_brief_open_flags so they survive page reloads and the next AI call sees them in brief.openFlags.
Response returns { responseText, flags[] }; the AI Chat panel shows the response + yellow-card list of flags with Resolve / Dismiss buttons; the editor toolbar shows an amber count badge on the AI Chat button.
When author clicks Accept into section → PATCH /documents/:id/sections/:sectionId → section updates, autocheck re-runs (fire-and-forget), and the Document Brief regenerates (fire-and-forget) so the next AI call sees fresh state.
When the author resolves/dismisses a flag → POST .../open-flags/:flagId/resolve → the row flips status, badge count decrements, Part 11 audit entry captures actor + note.
The whole pipeline is observable: /documents/:id/ai-draft-status lets the SPA poll the state machine from step 12 through step 22, and every stage writes an audit entry so a reviewer can replay the drafting history end to end.


 can we implement all this for Scentific writing module E make sure thorow consideration is givenn based on document type
first analyse find gaps recommend and ask question 
come up with a implementation plan validate 3 times.