# ClinWrite.AI — Clinical Writing Unique Features

Curated list of Clinical Writing (Module A) features that plausibly
differentiate ClinWrite.AI from established clinical-writing competitors
(TrialAssure, Veeva Vault RIM, Certara, Yseop, Lorenz docuBridge, Extedo,
Trialect, ICON authoring suites). Intended as source material for a PPT.


## AI drafting — grounding + confidence

- **85% confidence validation loop with explicit `[TBD: what is needed]` grounding contract** — Claude re-reads its own draft, scores it, and iterates up to 5 passes until ≥85% or inserts a visible `[TBD: …]` marker rather than fabricate. Competitors with AI typically ship a one-shot draft with no in-model self-audit.
- **Per-section confidence chip + open-flags badge in the editor** — authors see a live 0-100% score and a count of unresolved AI concerns right next to the section they're editing. Most competitor AI drafters surface confidence (if at all) only at document level.
- **Verbose AI Debug Panel with per-section source trace + "Copy JSON"** — slide-out panel shows the exact policy version pinned, AI prompt record, template, every source document with drop reasons (`not_pdf` / `exceeds_cap` / `virus_scan_failed`), per-section rewrite counts, the audit tail — and expandable rows showing which source PDFs were in Claude's context on each section commit. Built for support/debugging — no competitor exposes the prompt stack this transparently.
- **"AI isn't configured" toast with Settings link, not a silent hang** — when no Anthropic key is set, the drafter surfaces an amber "AI isn't configured — paste a key in Settings → AI engine" toast instead of leaving the writer staring at a spinner. Competitors fail silently.
- **Stop button that actually interrupts the in-flight Claude call** — co-operative cancellation via a 2-second heartbeat that polls `aiDraftState` and fires an `AbortController.abort()` on the active SDK call. Clicking Stop drops the writer back into control within one section boundary, not at the end of the whole doc. Competitors label a cancel button but let the job complete silently.
- **SECTION_GROUNDING_RULES — one shared product-wide guardrail constant** — the "attached sources are authoritative primary references; never fabricate; use `[TBD: …]`; preserve reference markers" contract is enforced identically across Clinical / Medical / Regulatory / Publications / KOL modules. Competitors scope prompt guardrails per doc type, not product-wide.

## AI cost + token discipline

- **Admin extracts cross-cutting rules once from the SME prompt — every section call then ships a compact `GENERAL RULES` block instead of the raw prompt text** — Claude distills the SME prompt into (a) document-wide rules and (b) per-section rules at approval time (migration 95). `/ai-suggest` and the initial-draft worker then compose a ~5× smaller prompt per section than dumping the raw SME text every call. Legacy rows fall back to the verbatim path so behaviour never changes until the admin re-extracts.
- **Template-authored section format rules in natural language, pinned per document at create time** — admins write section scaffolds (headings, table shapes, expected content) once per document type (migrations 91 / 94). The scaffold text ships inline with every per-section AI call so Claude doesn't re-infer the document's conventions. Writers never see a section start "blank" — the scaffold is the floor, the AI fills in grounded content.
- **DocumentBrief — compact ~1.5k-token project summary carried on every AI call** — indication, population, phase, endpoints, trial id. Auto-maintained in a fire-and-forget background refresh after each section save so the brief is always current without a user wait. Competitors rely on static templates and author-pasted context.
- **Per-call scope toggle (`section` / `document` / `source`) chooses how much context to burn** — writers pick whether the AI sees just this section, the whole document concatenated, or just the linked sources on each prompt. Default `section` keeps the bill small; `document` and `source` are explicit opt-ins. Competitors either always-include everything or always-just-this-section.
- **Carry-prompt feature flag — accumulate authored edits into a shorter targeted `/ai-suggest` prompt** — when enabled per doc type, the UI composes a "here's what the writer just changed, keep editing this way" prompt instead of re-sending the whole section each call. Competitors send the full section HTML every time.
- **AiCallRecord per call with Anthropic `cached_input_tokens` captured** — prompt-caching discount is attributed on the call record so cost dashboards reflect real billed tokens, not list price. Competitors typically show list-price billing even when cache hits occur.
- **Per-tenant Anthropic key in `ExternalApiCredential` (admin UI, DB-stored, no env fallback for Module A)** — the API gateway resolves the key per call from the DB so per-tenant quotas / rotation / spend attribution are first-class. Competitors ship a single platform-level key.

## Policy + versioning architecture

- **`policy_version_at_create` pinning** — the policy, SME prompt, and best-practice digest in force the day a document was created stay bolted to that document even after admin publishes a newer version. Competitor platforms re-apply the "current" template, silently drifting authored intent.
- **AiPromptRecord + BestPracticeRecord pointer refactor with draft → approved → retired lifecycle** — SME prompts and best-practice digests are independently versioned entities with an approval workflow, not free-text buried in a template file. No competitor at parity today treats the AI prompt itself as a first-class versioned regulated artefact.
- **Policy-preview panel showing the rendered prompt block admins will send** — admins see the exact composed `SME PROMPT (policy v3)` / `SECTION RULES (s6_2)` / `GENERAL RULES` text the AI will receive before approving a policy change. Competitor admin UIs show config, not the generated prompt.

## Section-level editing — multi-user, lockable, fully undoable

- **90-second lease-based section locks with heartbeat + presence avatars + `stolen` semantics** — multiple authors co-edit a long document in parallel, each on a different section. Locks auto-release on blur, heartbeat on focus, 423-Locked responses surface the current holder for a one-click force-release path (who stole it + when). Competitors tend to lock at document or chapter level (Vault) or have no lock at all.
- **Unified Section History panel — manual edits, AI rewrites, AI initial drafts and undos in one scrollable timeline** — one row per non-noop save with origin + author, sessionized into 10-minute "writing bursts" for readability, filterable by origin (All / AI only / Manual / Undos), with inline WAS/NOW diff preview and a per-row Revert that targets any point in the chain. Revert writes a new `undo` row so the chain stays complete. Competitors silo human history from AI history, or lack per-section granularity entirely.
- **TipTap autosave with visibly-equal HTML dedupe** — autosave compares normalized HTML (ignores empty `<p>` jitter, inter-tag whitespace, `&nbsp;` churn) before writing, so the editor's non-deterministic reformatting never generates a noise row. Competitor history panels show autosave jitter as "3 edits" that all look identical.
- **Auto-derived section status (no "Mark Complete" clicks)** — the section's status flips to `complete` the moment its content has real text and no `[TBD: …]` markers; `in_progress` while placeholders remain; `not_started` when empty. One source of truth: the content itself drives the Sections list dot, the progress counter, and the e-sig readiness gate. Competitors require an explicit author click to mark done.
- **5-intent section `/ai-suggest`** (rewrite / shorten / expand / clarify / fix-flags) **with grounding + policy pinning on every call** — one API with intent routing, all five intents honour the same TBD contract. Yseop et al. tend to offer whole-section rewrite only.
- **Open-flags escape-hatches that persist across structural regenerations** — unresolved AI concerns (missing data, inconsistency flags) survive template re-generation so authors can't lose the TODO list. Competitor flag systems reset on regenerate.

## Document-level editing + search

- **Document-wide find & replace in one transaction** — right-panel search across every section; replace-all fires a single batched PATCH on the server (one audit entry, one version hash recompute, one autocheck run) instead of N per-section round-trips. Scope toggle narrows to the active section for surgical changes. Competitors loop the client through sections.
- **TBD placeholder panel with jump-to + batched resolve across the whole document** — every `[TBD: …]` marker across all sections rolls up grouped by placeholder text (e.g. "protocol number" with occurrence count across §1.1 / §1.2 / §1.5). Clicking a section chip jumps + flashes the first occurrence in the editor; Replace-all fills every instance in one call. Competitors leave TBD discovery as a text search.
- **Sources tab per document — per-source citation count + clickable section chips** — the third sidebar tab shows each linked source doc + how many sections cite it + the specific sections (clickable chips that jump the editor). Competitor source trays are flat attachment lists.
- **Final document PDF renderer with watermark + signature page + undrawable-character reporting** — the compiled PDF binds its contents by SHA-256 so the Part 11 chain re-verifies at any time; unsigned exports are watermarked on every page; the title page names any character the embedded fonts couldn't draw so nothing vanishes silently. Competitor final output is an opaque merge-and-ship.
- **Version Diff view — compare against any previous version, then cherry-pick which sections to restore into a new version** — the diff screen dropdowns any prior `DocumentVersion` as the "from" side, renders a chapter-by-chapter side-by-side diff, and shows a checkbox on every changed section. Ticking boxes then "Restore" fires `POST /documents/:id/restore` with `[{sectionId, fromVersionId}]` tuples — sections can be cherry-picked from **different** past versions and combined into a single new version, not an all-or-nothing rollback. Server validates each requested section exists in its named source version and blocks no-op restores (content already matches current). Content-hash anchoring on every version means a diff opened on an older point re-verifies against its signed hash. Competitors typically offer whole-document rollback or single-section revert, not mixed cherry-pick.

## Source-attachment + citation integrity

- **PDF-only source picker with silent-drop visibility** — document creation hides non-PDF uploads behind an amber banner showing exactly how many `.docx`/`.xlsx` files were suppressed and why, so authors never wonder "why didn't the AI use my file?" Competitors silently accept all formats and the AI just doesn't cite them.
- **Span-level `SourceReference` citations** — AI-drafted claims cite the specific page / paragraph / span in the source PDF, not just "Document X." Competitor citation is mostly document-level footnote.
- **DocumentSource many-to-many with virus-scan + confirmation state machine** — sources are first-class records with upload / scanning / confirmed / rejected states; AI only ever sees `confirmed`. Most competitor tools treat uploads as opaque blobs.
- **20 MB per-source cap enforced before the prompt is composed** — oversized PDFs surface a visible drop notice in the AI Debug panel instead of silently inflating the prompt or failing mid-draft. Competitors fail mid-call.

## CRM AI note-taker

- **CRM "AI Note-Taker" — one AI call extracts per-comment resolution drafts from a meeting transcript** — the chair uploads a pre-transcribed text (Zoom / Teams / Otter export), and a single AI call drafts a resolution note for every open comment on the meeting in one pass (not N calls). The chair edits + approves each draft; `POST /crm/:meetingId/minutes` then composes the final minutes HTML combining those resolutions with an AI narrative paragraph. Competitors either skip meeting integration entirely or keep it as a note-taking silo that doesn't flow back into the writing pipeline.
- **Audio is never stored (explicit DPDPA stance)** — the CRM transcript endpoint only accepts text; the stored artefact is the parsed transcript + extracted drafts, never the audio file. Rare in a space where meeting-intelligence vendors routinely retain recordings.

## Voice notes — per-section dictation

- **S3 voice notes per section with background transcription** — authors record a voice note against a specific section (`POST /documents/:documentId/voice-notes?sectionRef=<id>`); the upload enqueues a `clinical.voice_transcribe` job that transcribes in the background and attaches the text to the section as supplementary grounding. Separate code path from CRM. Competitor voice-to-text exists but typically isn't wired into section-level prompt context.

## Regulatory / compliance surface

- **21 CFR Part 11 signature chain with TOTP + NTP stratum attestation** — each e-signature records the TOTP window, NTP stratum of the time source, and chains to the previous signature's hash. Industry standard is to log the signature event; capturing clock-trust metadata is rare.
- **Hash-chained audit events in raw SQL** (ADR 0002, outside ORM) — audit rows chain by SHA-256 of the prior row + a secret that never rotates, so tampering is cryptographically detectable. Competitor audit logs are append-only tables trusting the DB.
- **ICH E3 section-waiver tracking** — authors can mark a required section "waived with justification" and the TLF inventory + submission packager honour it. Competitor platforms treat sections as present-or-missing.
- **Checklist templates at platform + project tier with override semantics** — tenant admins ship a baseline checklist; project leads override per project. Competitor checklist is global.
- **DocumentRaci with per-role signature meanings** — the RACI matrix drives not just permissions but *what each signer attests to* (reviewed-for-stats-accuracy vs. approved-for-release). Competitor RACI is permission-only.

## Install + licensing

- **Signed JWT licence token from GenBioCa, pasted once by IT Admin, verified per request** — module enablement (`A/B/C/D/E`), plan tier and renewal date all ride on an asymmetrically-signed token stored in `platform_settings`. IT Admin has read-only visibility of what's enabled; GenBioCa controls what they can turn on. Dev installs auto-enable all modules when the embedded dev pubkey is in use so the demo isn't blocked on a procurement step. Competitors ship a seat-licence spreadsheet.
- **Tabbed Settings screen for IT Admin — Branding / SSO / Localisation / AI engine / Voice / eCTD / Licensing / External APIs** — one tabbed screen covers every install-wide config. Every key an admin pastes (Anthropic, voice provider, OIDC client secret, external API keys) rides the shared `ExternalApiCredential` masked-GET pipe, so turning a feature on never requires editing an env file or restarting a service. Competitors spread install config across admin + superuser + runtime files.
- **SSO full config inline — enable toggle, email-domain routing, OIDC + SAML provider fields** — IT admin captures the install's IdP contract (issuer URL, client id, SAML metadata URL, entity id, ACS URL) in one tab. OIDC client secret is stored separately on `ExternalApiCredential` so it masks like every other secret. Competitors require vendor-side provisioning.

## UX / live-editor details

- **Section navigator sidebar — four tabs: Sections / Sources / TBDs / Search** — a left rail per document covers section navigation (with confidence badges + open-flag counts), the attached sources list with per-source usage, the TBD placeholder roll-up, and full-text search + replace. Each tab persists its own state across tab switches. Competitors list sections but not the document's AI health or its attached sources per section.
- **Live progress toast during initial draft** showing per-section status (drafting / validating / passed / tbd-inserted) with a working Stop button. Competitors show a spinner.
- **Row-click Project Overview panel (non-modal, resizable) + per-row gear-icon Settings panel on the Projects list** — clicking a project row opens a right-side overview panel (header + 5 KPIs + AI cost + active-module launcher buttons) without leaving the list; a per-row gear opens a second panel for team RACI + status changes. Both panels are resizable (drag handle, width persisted), non-modal (background stays interactive), and replaced the former full-page project dashboard. Competitors deep-dive via a route navigation that loses the list context.
- **Per-project AI spend + per-module document chips on the Projects list** — one column shows running Anthropic cost per project (compact format: `$0.0387`, `$12.34`, `$12.5k`); another shows colour-coded module chips (`4 CW`, `1 MW`, `2 SW`) that double as click-to-navigate shortcuts into each module. Competitors list projects but not their AI burn rate.
- **6-stage document stage machine** (Study Start-Up → During Study → Post-Study → Cross-Functional Review → CRM → Final Output) **with stage-scoped feature gating** — the stage drives which RACI roles can edit vs. sign vs. export at each step, not just the pill on the header. Competitor stage machines are display-only; ours gates what every role can actually do.

## Platform craftsmanship (less glamorous but real moats)

- **Shape-mapper pattern** — every API route returns a Zod-validated shape via an inline `*Shape()` helper, so UI contracts can't silently drift from Prisma rows. Reduces whole category of competitor bugs where the UI shows stale fields.
- **AiDraftingPass log** — every single AI pass (initial draft + each validation iteration + every `/ai-suggest`) is a persisted row with input / output / confidence / tokens / model / policy version. Competitors don't persist the AI's reasoning trail.
- **AiSectionDraftTrace — one row per committed section draft with source IDs + titles + prompt/output char counts** — powers the "which sources was the AI reading" view in the AI Debug panel (migration 99). Source titles are denormalised next to the ids so the view renders without an extra join and reflects what the writer saw at draft time — a later rename in the source library doesn't retroactively rewrite history. Competitors don't persist this.
- **`beforeHtml` dropped from clinical-section edit history — derived from previous row's `afterHtml` on read** — halves the edit-history storage footprint for Module A without losing restore. Legacy rows that still carry `beforeHtml` take precedence transparently; new rows store only the authoritative `afterHtml` + let the diff / revert chain derive the rest.

---

## Caveat

Filtered against domain knowledge of the named competitors, not live
competitive intel — treat every bullet as **"plausibly unique"** rather
than "verified absent elsewhere." For buyer-facing slides, lead with
the *mechanism* (what we do + why it's hard) rather than an absolute
"nobody else has this" claim, which is safer in front of a buyer who
may have seen a competitor demo recently.
