# ClinWrite.AI — Clinical Writing Unique Features

Curated list of Clinical Writing (Module A) features that plausibly
differentiate ClinWrite.AI from established clinical-writing competitors
(TrialAssure, Veeva Vault RIM, Certara, Yseop, Lorenz docuBridge, Extedo,
Trialect, ICON authoring suites). Intended as source material for a PPT.

Each bullet includes a one-line rationale so you can pick the strongest
3-4 per slide.

## AI drafting — grounding + confidence

- **85% confidence validation loop with explicit `[TBD: what is needed]` grounding contract** — Claude re-reads its own draft, scores it, and iterates up to 5 passes until ≥85% or inserts a visible `[TBD: …]` marker rather than fabricate. Competitors with AI typically ship a one-shot draft with no in-model self-audit.
- **Per-section confidence chip + open-flags badge in the editor** — authors see a live 0-100% score and a count of unresolved AI concerns right next to the section they're editing. Most competitor AI drafters surface confidence (if at all) only at document level.
- **Verbose AI Debug Panel with one-click "Copy JSON"** — slide-out panel shows the exact policy version pinned, AI prompt record, template, every source document with drop reasons (not_pdf / exceeds_cap / virus_scan_failed), per-section rewrite counts, and the audit tail. Built for support/debugging — no competitor exposes the prompt stack this transparently.
- **DocumentBrief as a derived summary carried on every AI call** — a compact ~1.5k-token project brief (indication, population, phase, endpoints) is auto-maintained and injected into every rewrite so Claude re-grounds against trial facts on every section. Competitors typically rely on static templates and author-pasted context.
- **SECTION_GROUNDING_RULES — one shared product-wide guardrail constant** — the "attached sources are authoritative primary references; never fabricate; use `[TBD: …]`; preserve reference markers" contract is enforced identically across Clinical / Medical / Regulatory / Publications / KOL modules. Competitors scope prompt guardrails per doc type, not product-wide.

## Policy + versioning architecture

- **`policy_version_at_create` pinning** — the policy, SME prompt, and best-practice digest in force the day a document was created stay bolted to that document even after admin publishes a newer version. Competitor platforms re-apply the "current" template, silently drifting authored intent.
- **AiPromptRecord + BestPracticeRecord pointer refactor with draft → approved → retired lifecycle** — SME prompts and best-practice digests are independently versioned entities with approval workflow, not free-text buried in a template file. No competitor I'm aware of treats the AI prompt itself as a first-class versioned regulated artefact.
- **Policy-preview panel showing the rendered prompt block admins will send** — admins see the exact composed `SME PROMPT (policy v3)` / `SECTION RULES (s6_2)` text the AI will receive before approving a policy change. Competitor admin UIs show config, not the generated prompt.

## Section-level editing mechanics

- **90-second lease-based section locks with heartbeat + `stolen` semantics** — two authors can co-edit a document section by section; locks auto-release on blur, heartbeat on focus, and a force-release path explains who stole the lock. Competitors tend to lock at document or chapter level (Vault) or have no lock at all.
- **Polymorphic per-section edit history with revert across human + AI origins** — every section edit (manual save, AI rewrite, AI initial draft, revert) is a row with origin + author; authors can revert to any prior point. Competitor history is usually document-level or AI-vs-human siloed.
- **5-intent section `/ai-suggest`** (rewrite / shorten / expand / clarify / fix-flags) **with grounding + policy pinning on every call** — one API with intent routing, all five intents honour the same TBD contract. Yseop et al. tend to offer whole-section rewrite only.
- **Open-flags escape-hatches that persist across structural regenerations** — unresolved AI concerns (missing data, inconsistency flags) survive template re-generation so authors can't lose the TODO list. Competitor flag systems reset on regenerate.

## Source-attachment + citation integrity

- **PDF-only source picker with silent-drop visibility** — document creation hides non-PDF uploads behind an amber banner showing exactly how many `.docx`/`.xlsx` files were suppressed and why, so authors never wonder "why didn't the AI use my file?" Competitors silently accept all formats and the AI just doesn't cite them.
- **Span-level `SourceReference` citations** — AI-drafted claims cite the specific page / paragraph / span in the source PDF, not just "Document X." Competitor citation is mostly document-level footnote.
- **DocumentSource many-to-many with virus-scan + confirmation state machine** — sources are first-class records with upload / scanning / confirmed / rejected states; AI only ever sees `confirmed`. Most competitor tools treat uploads as opaque blobs.

## CRM + voice + cross-module integration

- **CRM loop with AI minute-draft on every meeting comment** — a comment in CRM triggers an AI draft of meeting minutes keyed off the project brief + attendee list. Competitors don't integrate CRM minutes with the writing pipeline at all.
- **S3 voice notes with inline transcription attached to sections** — authors dictate section context by voice; transcripts attach to the section as supplementary grounding. Competitor voice-to-text exists but isn't wired into section-level prompt context.

## Regulatory / compliance surface

- **21 CFR Part 11 signature chain with TOTP + NTP stratum attestation** — each e-signature records the TOTP window, NTP stratum of the time source, and chains to the previous signature's hash. Industry standard is to log the signature event; capturing clock-trust metadata is rare.
- **Hash-chained audit events in raw SQL** (ADR 0002, outside ORM) — audit rows chain by SHA-256 of the prior row + a secret that never rotates, so tampering is cryptographically detectable. Competitor audit logs are append-only tables trusting the DB.
- **ICH E3 section-waiver tracking** — authors can mark a required section "waived with justification" and the TLF inventory + submission packager honour it. Competitor platforms treat sections as present-or-missing.
- **Checklist templates at platform + project tier with override semantics** — tenant admins ship a baseline checklist; project leads override per project. Competitor checklist is global.
- **DocumentRaci with per-role signature meanings** — the RACI matrix drives not just permissions but *what each signer attests to* (reviewed-for-stats-accuracy vs. approved-for-release). Competitor RACI is permission-only.

## UX / live-editor details

- **Section navigator sidebar with confidence badges + open-flag counts** — a left rail shows every section with a numeric confidence badge and a flag count, so authors route to weakest sections first. Competitors list sections but not AI health per section.
- **Live progress toast during initial draft** showing per-section status (drafting / validating / passed / tbd-inserted). Competitors show a spinner.
- **6-stage document stage machine** (draft → qc → review → approved → submitted → archived) **with stage-scoped feature gating**. Competitor stage machines are display-only; ours gates which actions each role can take.

## Platform craftsmanship (less glamorous but real moats)

- **Shape-mapper pattern** — every API route returns a Zod-validated shape via an inline `*Shape()` helper, so UI contracts can't silently drift from Prisma rows. Reduces whole category of competitor bugs where the UI shows stale fields.
- **AiDraftingPass log** — every single AI pass (initial draft + each validation iteration + every /ai-suggest) is a persisted row with input / output / confidence / tokens / model / policy version. Competitors don't persist the AI's reasoning trail.

---

## Caveat

Filtered against domain knowledge of the named competitors, not live
competitive intel — treat every bullet as **"plausibly unique"** rather
than "verified absent elsewhere." For buyer-facing slides, lead with
the *mechanism* (what we do + why it's hard) rather than an absolute
"nobody else has this" claim, which is safer in front of a buyer who
may have seen a competitor demo recently.
