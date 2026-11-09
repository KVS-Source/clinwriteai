# Pending work across modules

Snapshot: **2026-11-09** after the session that wired the AI connector
across all five modules, wired the shared **Master Library** across all
five modules, and closed stubs that no longer needed external blockers.

This document is the single source of truth for what is still stubbed /
hardcoded / unwired across every module, grouped by **shared dependency**
first (fix one, unblock many) and then by module. Numbering matches
each module's audit list used during the 2026-11-09 session.

> **Convention:** user-facing docs use "Clinical Writing", "Scientific
> Writing", "Medical Writing", "Regulatory Writing", "Ideation &
> Publishing" — never "Module A/B/C/D/E". The letters are used below
> **only inside each audit's internal numbering** (code paths still use
> `requireAuth({ modules: ['A'] })` etc.).

---

## Cross-module blockers (fix one → unblock many)

Each row names the dependency, the modules it blocks, and the shape of
the fix. Order is rough "highest-leverage first".

| # | Blocker | Blocks | Shape of fix |
|---|---|---|---|
| ~~X-1~~ | ~~Master Library data model~~ | — | **RESOLVED** 2026-11-09. The Master Library (`LibrarySection` + `LibraryAdoptionRecord` in [platform-services.prisma](../apps/api/prisma/schema/platform-services.prisma)) already existed at the platform level; the gap was module-side wiring, not schema. Every module now reads + writes to `LibrarySection` via tag-based filtering (`module:A..E`, `project:<id>`, `source:<id>`, `doctype:<type>`). Single-tenant installs use `tenantId: null` consistently. |
| X-2 | **pgvector extension + embedding model** | Medical Writing + Ideation & Publishing claim similarity (currently token-Jaccard — good for near-duplicates, misses paraphrases) | Install `pgvector` on QA/prod Postgres (Hetzner CPX31: `apt install postgresql-16-pgvector`). Pick embedding provider — recommend Voyage AI (cost / quality trade). Add `vector(1536)` column to `library_sections`. Swap `jaccardSimilarity()` in [platform/library/text-match.ts](../apps/api/src/modules/platform/library/text-match.ts) for cosine on the embedding column; signature stable. |
| X-3 | **MedDRA licensing (MSSO)** | Medical Writing (AE claim validation), Regulatory Writing (AE line-lists inside aggregate safety reports) | MSSO licence + download MedDRA LLT/PT tables + seed `meddra_lookup` table + wire validators. |
| X-4 | **Part 11 compliance decision** — PDF vs canonical-JSON hash binding + inline credential re-auth | Clinical Writing (e-sig chain), Medical Writing (MLR Lead e-sig), Regulatory Writing (gateway transmit, super-review e-sig) | Compliance review decision; artefact format pick; wire inline re-auth per sign. Blocks three modules' sign-off chains. |
| X-5 | **Email provider (Postmark / SES / SendGrid)** + domain SPF / DKIM | Scientific Writing (author-reminder send), future reminder flows across modules | Provider pick → adapter impl behind the shipped `EmailAdapter` interface (`apps/api/src/modules/platform/email/`). DNS work in parallel. |
| X-6 | **Publication PDF renderer** | Scientific Writing (final download), Medical Writing (final output bundle), Regulatory Writing (dossier rendering) | Design pass — manuscript layout, journal templates, page numbering. Clinical Writing's `renderFinalDocumentPdf` is document-shaped and not directly reusable. |
| X-7 | **Role catalogue expansion** — MLR Lead, PV Lead, Biostats Lead, SuperReviewer seats | Medical Writing (tier-override gate, MLR decision), Regulatory Writing (super-review panel strict gate), platform-wide | Add roles to `CanonicalRole` + `LegacyRole` unions in `apps/api/src/auth/rbac.ts`. Policy decision on who can grant. |
| X-8 | **Anthropic-gated budget / cost caps** | Everywhere `aiGateway.chat()` is now wired — all 5 modules | Operational: configure AI engine in Admin Panel → AI Engine per tenant. Tenant-level monthly budget. |

---

## Clinical Writing — pending

Shipped this session: Document Brief + carry prompt + `/ai-suggest`
wiring + open-flags persistence + resolve/dismiss UI + badge count.

### Operational (needs DB / VPS access)
- Apply migration **63** (`document_brief`) on QA / prod via
  `prisma migrate deploy`.
- Apply migration **64** (`document_brief_open_flags`) ditto.
- Set `FEATURE_CARRY_PROMPT=protocol` via the shipped
  `set-env-var.sh` on the VPS.
- Deploy pipeline (if it doesn't auto-pick on main push).
- Optional: backfill brief rows for pre-migration documents (lazy
  regen on first GET already handles this, so purely a latency
  optimisation).

### Phase 3A deferrals still open
(See `memory/project_phase_3a_deferrals.md` — not re-verified this session.)
- S3 wiring for voice notes blob storage
- Section diff refinements
- Presence multi-instance Redis fanout
- TLF per-section grouping edge cases
- CRM meeting post-review workflow polish
- AI / eSig / MedDRA external blockers (see X-3, X-4)

---

## Scientific Writing — pending

Shipped this session: real PubMed E-utilities + peer-review-draft AI
+ `EmailAdapter` scaffold + DOI + COI submission checks.

### Still blocked
- **FDA / OIG debarment lookup** — vendor (LexisNexis / Thomson
  Reuters) OR worker that mirrors public FDA/OIG lists. Significant
  infra. Route stub always returns `status: 'clear'`.
- **Email reminder actual send** — unblocked once X-5 lands.
- **Final publication PDF** — unblocked once X-6 lands.
- **Congress portal integration** — intentional per OQ-B-004 ("no
  live portal API"); bundle-to-blob + manual-upload is the design.

### Scope-choice
- **Submission checks 3-15 of 15** — only DOI + COI are evaluated
  live. Format checker, word counter, EQUATOR validator, figure
  resolution, plagiarism, reference formatting remain scaffold-only
  state-preserving rows. Each is an engine unto itself; add them
  piecemeal.

---

## Medical Writing — pending

Shipped this session: agentic report AI narrative + content
`ai-suggest` AI + escalate creates real `MlrComment` row + portfolio
analytics endpoint.

### Still blocked
- **pgvector-grade semantic similarity** — X-2. Harvest now uses
  token-Jaccard against real `LibrarySection` claim rows
  ([claims/routes.ts](../apps/api/src/modules/medical-writing/claims/routes.ts)
  + [library-match.ts](../apps/api/src/modules/platform/library/text-match.ts)).
  Catches near-duplicate reuse; misses semantic paraphrases.
- **Review tier formula** — placeholder `≥70→A / 40-69→B / <40→C`.
  Needs SME sign-off.
- **MLR Lead role gate** — X-7. Still uses `['admin','super-admin']`.
- **MedDRA** — X-3.
- **ACCME CME tables** — framework data + SME review.
- **WCAG runtime check** — axe-core runs in a browser, not an API
  route. Harness exists at `apps/web/playwright/a11y/`. Needs worker
  job w/ headless Chrome.
- **KOL session data model** — schema design + migration.
- **Locales list** — hardcoded locale list; **unrelated to Master
  Library** (locales are UI translation, not reusable text). Needs
  its own shared locale service.

### Wired this session
- **pushToLibrary** — real `LibrarySection` write at
  [content/routes.ts](../apps/api/src/modules/medical-writing/content/routes.ts);
  gated on `item.status === 'approved'`; dedup via `claim:<id>` tag.
- **Claim harvest** — reads `LibrarySection` rows + Jaccard match;
  stores `similarityPct` + `approvedLibraryText` for the adopt flow.

---

## Regulatory Writing — pending

Shipped this session: HA auto-draft AI + PPD/CCI auto-detect AI +
validator-alias count-accept + canonical-index real counts + 63-node
ICH M4 seed + dynamic super-review panel.

### Still blocked
- **Gateway submissions** — FDA ESG (prod certs + PGP + test
  transactions, months), EMA CESP (QES certs in some member states),
  CDSCO (API not opened), MHRA (`apiReady: false`). All four
  endpoints in `aliases-and-stubs.ts:221-285` return canned shapes.
- **Extedo / Lorenz eCTD validator** — vendor client. Canonical
  `/validation/run` + alias `/ectd-validation/run` both trust caller
  counts; endpoint shape is the real vendor's shape so no breaking
  change when wired.
- **Part 11 inline re-auth on transmit** — X-4.
- **Canonical JSON PDF / Word extractor** — real parser is a project
  unto itself. `POST /canonical-json` stores whatever JSON client
  sends; `POST /canonical-json/index` now computes counts from the
  stored blob (realistic given what's there).
- **MedDRA for AE line-lists** — X-3. `aggregate_safety_reports`
  bodies are HTML; no MedDRA PT structure.
- **Regulatory alerts newswire** — vendor (EMA / FDA / MHRA /
  commercial newswire). Four seeded alerts in
  `aliases-and-stubs.ts:362` until a feed is wired.

### Scope-choice / data model
- **`targetHas: string[]` → `health_authorities` FK** — lookup table
  lands with gateway integration.
- **DB-level redaction constraint** — API gate at stage 5+ is
  enforced; defence-in-depth DB CHECK / trigger is a raw-SQL
  migration (Prisma can't express cross-table CHECK). Needs
  reviewer.

### Wired this session
- **Library cards GET + push** — reads real `LibrarySection` rows
  filtered to submission TA + `module:A`/`C`/`D` tags; push creates
  new rows with `source:<submissionId>` dedup.

---

## Ideation & Publishing — pending

Nothing shipped in this session — audit only. Memory from 2026-10-05
is still accurate.

### Externally blocked
- **CrossRef DOI minting** — procurement only (public lookup is now
  wired via `crossref-client.ts`; mint returns `{source: 'stub'}` if
  `CROSSREF_API_USER` + `CROSSREF_API_PASSWORD` absent OR deposit
  implementation still pending).
- **SMS actual delivery** — Twilio or equivalent procurement.
  `SmsAdapter` scaffold shipped; `SMS_PROVIDER=twilio` surfaces the
  gap with a warn log.
- **Social listening + sentiment** — vendor (Brandwatch / Sprinklr
  / equivalent) + `social_listening_alerts` table (not in schema).
  `GET /ideation-projects/:id/social-alerts` returns `[]`.

### Wired this session
- **Claim currency against real Library** — new `claimTexts[]` mode
  runs each claim through token-Jaccard against `LibrarySection`
  (category='claim'), classifies as extracted / superseded /
  retired. Audit records `classifiedByServer: true`.

### Security-sensitive (needs threat model before shipping)
- **Public `/kol-review/:token` guest route** — token is generated at
  review-link creation; no consumer endpoint. Juicy attack surface
  (public, token-only auth, external users). Needs threat model +
  WAF rules + rate limits per the architecture plan §3E.
- **`mobile_encrypted` column encryption** — plain TEXT with TODO
  flag on both `KolContact.mobileEncrypted` and
  `MaContact.mobileEncrypted`. GDPR personal data; needs KMS
  strategy (per-tenant key vs shared; envelope vs column-level).

### Scope-choice
- **Social media publish adapters** — LinkedIn / X / Meta OAuth
  clients + API wiring. `atomised/routes.ts` + aliases store the
  atomised text but don't push to any platform.

### Known placeholders (intentional until upgrade)
- **`aiFootprintHash`** is `sha256(cardId|channel|model|text)` — a
  stable change-detection fingerprint, not a semantic AI-footprint
  score. Current UI reads it as 100% AI if any AI was used. Semantic
  diff is a separate problem.

---

## Operational checklist (what the ops team still has to do)

Groups by *who* needs to act — matters for scheduling.

### Infra / DevOps
- Install `pgvector` on QA + prod Postgres (X-2)
- `prisma migrate deploy` for migrations 63 + 64 on QA + prod
- Email provider selection + DNS (SPF / DKIM) (X-5)
- KMS strategy pick + wiring (Ideation & Publishing mobile_encrypted)

### Procurement / legal
- **NCBI API key** — optional; raises PubMed rate from 3 → 10 req/s
- **CrossRef depositor account** — Sci Writing + Ideation DOI mint
- **Postmark / SES / SendGrid** — email provider
- **ORCID production OAuth app** — scientific-writing author verify
- **Debarment vendor OR scraper policy sign-off** — Sci Writing
- **MedDRA MSSO licence** — Med + Reg Writing
- **ACCME framework data** — Medical Writing
- **FDA ESG onboarding** + production certs + PGP keys — Reg Writing
- **EMA CESP** + QES certs in affected member states — Reg Writing
- **MHRA gateway** when API opens — Reg Writing
- **Extedo / Lorenz** eCTD validator contract — Reg Writing
- **Regulatory alerts newswire** — Reg Writing
- **Twilio** (or equivalent SMS) — Ideation
- **Social listening provider** (Brandwatch / Sprinklr / etc.) — Ideation
- **LinkedIn / X / Meta API apps** — Ideation publish adapters

### Compliance / SME
- Part 11 artefact format decision (X-4)
- MLR Lead role catalogue expansion (X-7)
- Review tier formula sign-off (Medical Writing #2)
- Public KOL guest route threat model (Ideation)
- Fresh DB CHECK / trigger review for redactions (Reg Writing #13)

### Env toggles ready now (safe to flip once above lands)
- `FEATURE_CARRY_PROMPT=protocol` — Clinical Writing carry prompt
- `NCBI_API_KEY=<key>` — PubMed rate bump
- `EMAIL_PROVIDER=postmark|ses|console|log` — email adapter (noop default)

---

## Session delta (2026-11-09) that produced this snapshot

8 commits on `main`, 2181 API tests, both workspace builds clean.

```
990d0e9 feat(regulatory-writing): derive super-review panel from real project members
665bb1c feat(regulatory-writing): expand DEFAULT_ECTD_NODES to ICH M4 structure
919d73a feat(regulatory-writing): remove hardcoded shapes from validator-alias + canonical-index
879c610 feat(regulatory-writing): PPD/CCI auto-detect via the AI gateway
2a00214 feat(regulatory-writing): wire HA LoQ response auto-draft to the AI gateway
8ec2be9 feat(medical-writing): portfolio analytics summary endpoint
9a68c4b feat(medical-writing): agentic-report escalate creates a real MlrComment row
6237912 feat(medical-writing): wire /:contentId/ai-suggest to the AI gateway
d0a8abe feat(medical-writing): wire agentic MLR advisory narrative to the AI gateway
f894af7 feat(scientific-writing): wire real submission checkers for DOIs + COI statements
af9b9ef feat(platform): EmailAdapter scaffold + wire /authors/:id/remind through it
e74a431 feat(scientific-writing): wire peer-review AI draft to the AI gateway
311bb87 feat(scientific-writing): wire real PubMed search to NCBI E-utilities
```

Plus the Clinical Writing Document Brief chain (`58cff43` → `c9d137a`,
earlier in the session) and the resolve/dismiss UI (`4340eed`).
