# ClinWrite Standalone Deployment — Product Requirements Document

**Status:** Draft, 2026-10-28
**Author:** Captured from brainstorm with CEO
**Audience:** The team building this will inherit this doc as their input brief. It should be readable without prior context on the current SaaS codebase.

---

## 1. Executive summary

ClinWrite ships today as multi-tenant SaaS at `demo.clinwrite.ai`. This document specifies a **second, parallel delivery model**: a fully customer-hosted, air-gapped deployment where **GenBioCa retains zero access to customer data** after initial handoff. Entitlements are enforced via signed license tokens generated inside a GenBioCa-internal **License Studio**; the customer loads the token file into their deployment and the stack self-configures module access, user caps, and expiry.

The goal is to serve pharma / life-sciences customers whose IT policies, GxP / 21 CFR Part 11 obligations, or DPDPA / HIPAA / GDPR posture make them uncomfortable with any third-party SaaS vendor touching their data.

---

## 2. Problem statement

### Why this exists
- Clinical writing contains PII, PHI, trial-stage safety data, and competitively sensitive IP (molecules, mechanisms, statistical plans). Pharma IT departments are frequently prohibited from running this on vendor-SaaS.
- Regulated environments (GxP-validated systems, 21 CFR Part 11 e-signature chains) require the customer to demonstrate control of chain-of-custody. Harder when a vendor holds the data.
- Several target markets (India post-DPDPA, parts of EU under GDPR-strict interpretations, China if we ever go there) make SaaS harder.
- Pharma procurement teams prefer "runs in our VPC" clauses over "SaaS with DPA."

### Current state (SaaS)
- Multi-tenant Postgres + Redis + API + Web, hosted by GenBioCa.
- All customer data on GenBioCa-controlled infrastructure.
- GenBioCa engineers have DB + logs access for support.
- Anthropic API key held by GenBioCa; all AI calls proxy through GenBioCa's account.

### Desired state (standalone)
- Customer-hosted stack identical to SaaS codebase.
- Customer provides their own PostgreSQL, Redis, object storage, and compute.
- Customer supplies their own LLM API keys (Anthropic / OpenAI / Google / Azure OpenAI / Bedrock / future pharma-specific providers).
- GenBioCa retains zero outbound/inbound network path to the deployment.
- Entitlements driven by a signed JWT license file loaded at startup.
- Updates distributed via signed Docker images on a public registry (primary) and signed tarball on GitHub Releases (secondary).

---

## 3. Non-goals

- **Not a replacement for the SaaS**. demo.clinwrite.ai keeps running for customers who prefer managed. Standalone is a parallel offering.
- **Not a customer-facing portal**. The License Studio is internal to GenBioCa (CEO + IT head only). Customers request changes via sales / email; studio generates and emails the new `.lic`.
- **Not a billing system**. Metering + invoicing stays external (QuickBooks / Zoho / whatever accounting uses) because telemetry would break air-gap.
- **Not multi-sub-tenant inside one deployment** (v1). One license file = one customer tenancy. A CRO running trials for 5 sponsors would get 5 deployments.
- **Not phone-home update checks**. Customer pulls when they're ready.

---

## 4. Target customer segments

| Segment | Why standalone wins |
|---|---|
| Mid/large pharma (India, EU, US) | IT policy forbids SaaS for regulated workflows; GxP validation needs chain-of-custody. |
| CROs serving sponsors with strict confidentiality | Sponsor NDAs often forbid vendor access to sponsor data. |
| Government / defense-adjacent research orgs | Data residency + national-security posture rule out SaaS. |
| Trial sites in restricted markets | SaaS cross-border transfer prohibited by local law. |

Not the right fit (keep on SaaS):
- Early-stage biotechs with no in-house IT.
- Academic groups.
- Price-sensitive buyers who can't absorb the ops cost.

---

## 5. Decisions captured in the kickoff brainstorm

For traceability later. Each is tagged with the question posed and the chosen answer.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Isolation model: pure air-gap** | Zero outbound from the customer app to GenBioCa. License keys imported offline. Max privacy; accepts higher support cost. |
| D2 | **License format: signed JWT (ES256), publicly verifiable** | Customer can read + audit what they're licensed for using the public key. Signed with a private key held in a YubiKey or HSM. |
| D3 | **Control-plane scope: minimum** | License issuance + expiry + module access only. No telemetry, no model-key proxy, no customer-visible portal. |
| D4 | **Update delivery: signed Docker images on public registry + signed tarball on GitHub Releases** | Docker-native shops pull images; air-gap shops curl a tarball + verify signature. Both built from the same tagged commit. |
| D5 | **Sequencing: air-gap-first** | Build License Studio + enforcement before customer #1 lands. One quiet quarter without customer pressure. |
| D6 | **Expiry behaviour: read-only + 30-day grace** | On expiry, users can log in, view, export. New edits + AI blocked. Protects the audit chain integrity (chain never rewinds). Avoids Friday-5pm renewal disasters. |
| D7 | **License Studio audience: GenBioCa internal only** | CEO + IT head. No customer login. Smallest surface, no auth / RBAC complexity. |
| D8 | **AI model placement: customer-provided keys, multi-provider** | Customer brings their own Anthropic / OpenAI / Gemini / Azure OpenAI / Bedrock / pharma-specific key. We ship a provider abstraction so adding a new provider is a config change, not a code change. |
| D9 | **License Studio repo: separate private repo, same stack** | Fastify + Prisma + React. Independent lifecycle; signing key never touches the main repo's CI. Smaller audit scope. |
| D10 | **First deliverable: this PRD** | Allows CEO, IT head, and (if needed) legal to review before any code lands. |

---

## 6. Architecture overview

### 6.1 System diagram

```
┌───────────────────────────────────────────────────────────────────┐
│  GenBioCa HQ                                                      │
│  (physical office / small cloud VM; CEO + IT head only)           │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  ClinWrite License Studio (new repo: clinwrite-license-studio) │
│  │                                                             │  │
│  │  • Customer directory + contract metadata                   │  │
│  │  • License JWT generator (ES256)                            │  │
│  │  • Private signing key (ES256) in YubiKey / HSM             │  │
│  │  • Revocation list (JWT jti → revoked_at)                   │  │
│  │  • Audit log of every issued / revoked license              │  │
│  │  • Export: .lic file (JWT) + README with install steps      │  │
│  │  • Email the .lic + install docs to customer contact        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Public GitHub Releases (existing repo clinwriteai)         │  │
│  │  • Signed Docker images (ghcr.io/kvs-source/...)            │  │
│  │  • Signed tarball of each tagged release                    │  │
│  │  • Public key (ES256) published; verification instructions  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
           │                                       │
           │ email .lic file                       │ customer `docker pull`
           │ (one-time at signup / renewal)        │ OR `curl` tarball
           │                                       │ (self-serve, when ready to update)
           ▼                                       ▼
┌───────────────────────────────────────────────────────────────────┐
│  Customer environment (their cloud / their datacenter)            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  ClinWrite stack                                            │  │
│  │  ┌────────┐  ┌────────┐  ┌─────────┐  ┌──────────────────┐  │  │
│  │  │  Web   │  │  API   │  │ Worker  │  │   Collab (Y.js)  │  │  │
│  │  └────────┘  └────────┘  └─────────┘  └──────────────────┘  │  │
│  │       │           │           │              │              │  │
│  │       └───────────┼───────────┴──────────────┘              │  │
│  │                   │                                         │  │
│  │  ┌─────────────┐  │  ┌──────────────┐  ┌────────────────┐  │  │
│  │  │  Postgres   │◀─┴─▶│    Redis     │  │ Blob (S3/MinIO)│  │  │
│  │  └─────────────┘     └──────────────┘  └────────────────┘  │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────────┐│  │
│  │  │  License engine (Fastify plugin, boot-time)             ││  │
│  │  │  • Reads /opt/clinwrite/license/current.lic             ││  │
│  │  │  • Verifies JWT signature with embedded public key      ││  │
│  │  │  • Enforces expiry + 30-day grace                       ││  │
│  │  │  • Writes activation + daily heartbeat to audit chain   ││  │
│  │  │  • Clock-rollback detection via monotonic DB counter    ││  │
│  │  └─────────────────────────────────────────────────────────┘│  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────────┐│  │
│  │  │  Multi-provider AI gateway                              ││  │
│  │  │  • Reads provider config from env + license features    ││  │
│  │  │  • Adapters: anthropic | openai | google | azure-openai ││  │
│  │  │                | bedrock | ollama | nabla | ...         ││  │
│  │  │  • Per-feature model routing (CRM uses one, edit uses   ││  │
│  │  │    another). Customer config drives it.                 ││  │
│  │  │  • Fallback chain: primary → secondary → disable AI     ││  │
│  │  └─────────────────────────────────────────────────────────┘│  │
│  │                                                             │  │
│  │  ZERO outbound to GenBioCa.                                 │  │
│  │  Customer owns all data, backups, upgrades, LLM billing.    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### 6.2 Data plane (customer-hosted)

Identical to today's `infra/standalone/docker-compose.yml` except:
- The `platform-api` service gains a boot step that reads `./license/current.lic`.
- The `FEATURE_MODULES_ENABLED` env var is **removed** — module access now comes from the license JWT's `modules` claim.
- The AI gateway section is replaced with a provider-abstraction layer; env vars like `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` are read opportunistically.
- `AUDIT_HASH_SECRET` is customer-generated and documented as **never rotatable** (same as today's SaaS).

### 6.3 Control plane (License Studio)

New application. Smallest viable scope (D3):

- **Customer directory**: name, primary contact email, contract start/end, modules purchased, seat count.
- **License generator**: input the customer + modules + expiry → output a `.lic` file (JWT) + a README with install instructions tailored to the customer.
- **Revocation list**: a signed, versioned JSON file published to GitHub Releases alongside the public key. Customer-side license engine refreshes it on an opt-in schedule (opt-in = NOT air-gap-breaking, because the customer explicitly configures it; e.g. a Monday-morning `curl` cron).
- **Issuance audit**: every license generated writes a row. Compliance-friendly.
- **No customer login.** Changes come in by email; Studio operator (CEO / IT head) acts on them.

Tech stack: Fastify + Prisma + React + Tailwind (same as main app, so the team's muscle memory applies). Hosted on an internal VM; signing key lives on a YubiKey plugged into the operator's laptop. Studio never speaks to any customer deployment.

### 6.4 License token format

Signed with ES256 (Elliptic Curve P-256). Public key embedded in the main app binary — customer doesn't need to configure it.

```json
{
  "iss": "clinwrite.genbioca.ai",
  "sub": "acme-pharma",
  "deployment_id": "acme-prod-01",
  "iat": 1760640000,
  "exp": 1792176000,
  "modules": ["A", "B", "C"],
  "seats": {
    "max_users": 25,
    "max_concurrent": 25
  },
  "features": [
    "section-locks",
    "crm-ai-notetaker",
    "edit-history-sessions"
  ],
  "ai_providers_allowed": ["anthropic", "openai", "azure-openai"],
  "jti": "lic-7d2f-9c1a-...",
  "contact": {
    "primary_email": "clinops@acme-pharma.com",
    "primary_name":  "Dr. R. Mehta"
  }
}
```

**Verification path** (customer-side, at API boot):
1. Read `./license/current.lic`.
2. Parse JWT header, confirm `alg: ES256`.
3. Verify signature against the embedded public key.
4. Confirm `exp > now()` or `exp + 30d > now()` (grace window).
5. Pull the revocation list snapshot (if cached locally); refuse to boot if `jti` is in it.
6. Compare `iat` against Postgres's `license_heartbeats.max_timestamp`. If current system clock is behind that, flag as `clock_rollback_detected` and refuse to boot (anti-rollback).
7. Populate `app.license` with modules / seats / features.
8. Append `license_activated` to the audit chain.

Daily at 02:00 local, the API writes a `license_heartbeat` row with the current timestamp. This is the monotonic counter that detects clock rollback.

### 6.5 Multi-provider AI gateway

**Interface** every provider adapter must implement:

```ts
export interface AiProvider {
  readonly name: string                      // 'anthropic' | 'openai' | ...
  readonly supportedModels: readonly string[]
  chat(args: {
    system?: string
    prompt: string
    model: string
    maxOutputTokens: number
    temperature?: number
  }): Promise<{
    text: string
    inputTokens: number
    outputTokens: number
    costUsd: number | null                   // null if cost not reportable
    rawResponse: unknown                     // for debugging
  }>
  health(): Promise<{ ok: boolean; latencyMs: number }>
}
```

**Routing config** (customer-editable `/opt/clinwrite/config/ai-routing.json`):

```json
{
  "default_provider": "anthropic",
  "default_model":    "claude-3-5-sonnet-20241022",
  "per_feature": {
    "clinical.ai_edit":          { "provider": "anthropic",   "model": "claude-3-5-sonnet-20241022" },
    "clinical.ai_draft":         { "provider": "anthropic",   "model": "claude-3-5-sonnet-20241022" },
    "crm.notetaker.extract":     { "provider": "openai",      "model": "gpt-4o-mini" },
    "crm.notetaker.minutes":     { "provider": "anthropic",   "model": "claude-3-5-sonnet-20241022" },
    "ich-e3.sentence_classify":  { "provider": "ollama",      "model": "llama3.1:8b" }
  },
  "fallback_chain": [
    { "provider": "anthropic",   "model": "claude-3-haiku-20240307" },
    { "provider": "openai",      "model": "gpt-4o-mini" }
  ],
  "disable_ai_on_total_failure": true
}
```

**Providers to ship at v1** (adapter files + env vars):

| Provider | Env | Notes |
|---|---|---|
| `anthropic`   | `ANTHROPIC_API_KEY`     | Default. Claude 3.5 Sonnet + Haiku. |
| `openai`      | `OPENAI_API_KEY`        | GPT-4o + GPT-4o-mini. |
| `google`      | `GEMINI_API_KEY`        | Gemini 1.5 Pro + Flash. |
| `azure-openai`| `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_KEY` | Pharma CIOs often standardize here. |
| `bedrock`     | AWS creds + region      | Enterprise AWS shops. |
| `ollama`      | `OLLAMA_BASE_URL`       | Local models. Zero outbound. |

**Future / optional** (abstract so adapter is a drop-in later):
- Writer.com (healthcare-focused)
- Nabla (medical AI)
- BioGPT / BioMedLM (open biomedical models via vLLM)
- Palantir Foundry AIP (used by some pharma)

**License-gated**. The license's `ai_providers_allowed` claim restricts which providers the gateway will initialize. Customer configures the API keys; license decides what the engine will consume. This is a safety net — stops a customer from pointing a non-approved provider at their regulated workflow without a license amendment.

### 6.6 Deployment artefact

Primary: **signed Docker images** on `ghcr.io/kvs-source/clinwrite-{api,web,worker,collab}:<version>`. Each tag is a git commit SHA + semver. `cosign` signatures published; customer verifies with:

```bash
cosign verify --key clinwrite-signing.pub ghcr.io/kvs-source/clinwrite-api:v1.2.3
```

Secondary: **signed tarball** on `https://github.com/kvs-source/clinwriteai/releases`. For truly air-gapped customers who can't reach a Docker registry.

```bash
curl -LO .../clinwrite-v1.2.3.tar.gz
curl -LO .../clinwrite-v1.2.3.tar.gz.sig
openssl dgst -sha256 -verify clinwrite-signing.pub \
             -signature clinwrite-v1.2.3.tar.gz.sig \
             clinwrite-v1.2.3.tar.gz
tar xzf clinwrite-v1.2.3.tar.gz && cd clinwrite-v1.2.3
./install.sh
```

Both artefacts built from the same tagged commit via GitHub Actions (`.github/workflows/release.yml`). Signing happens inside the Action using a cosign key stored in Actions Secrets (or ideally keyless OIDC).

### 6.7 Documentation shipped alongside

- **Install guide** (per OS / per cloud): Ubuntu + Docker Compose; AKS; EKS; GKE.
- **Backup + restore runbook**: pg_dump cadence; blob rsync; disaster-recovery drill.
- **Upgrade runbook**: pre-flight checks, migration rollback.
- **Security hardening checklist**: TLS termination, secret rotation, firewall rules.
- **Compliance appendix**: how to extract Part 11 audit chain for inspectors.

Written-once, versioned alongside the release.

---

## 7. Current codebase alignment

Where the existing code already supports this direction (good) and where surgery is needed.

### 7.1 Already supportive (no surgery needed)

- **Role model**: `super-admin` was consolidated into `admin + tenantId=null` on 2026-10-27. In a single-tenant deployment the distinction collapses naturally.
- **Audit chain** (`AUDIT_HASH_SECRET` + hash-chained events): already tenant-agnostic + tamper-evident. Perfect fit for compliance audit extraction.
- **Section locks** + **autosave** + **Edit History** (`sPM-autosave`, 2026-10-27): all tenant-scoped already.
- **Module kill-switch** (`FEATURE_MODULES_ENABLED` env var): the plumbing for module gating already exists; license engine just replaces the env var as its source.
- **Prisma + Postgres** stack is portable to any Postgres-compatible target (RDS, Azure Flexible Server, Cloud SQL, on-prem).
- **Docker Compose** `infra/standalone/docker-compose.yml` already exists; this becomes the customer-shipped artefact (with slight renames).

### 7.2 Needs surgery

| Area | Current state | Change needed |
|---|---|---|
| **AI gateway** | Single Anthropic provider, GenBioCa-owned key, hard-coded model choice. | Refactor into provider-abstraction interface + 6 adapters + routing config. |
| **License engine** | Doesn't exist. | New Fastify plugin: boot-time JWT verification, grace window, clock-rollback, heartbeat. |
| **Module gating source** | Reads `FEATURE_MODULES_ENABLED` env var. | Reads `app.license.modules`; env var removed. |
| **Config loading** | `apps/api/src/config/env.ts` validates env vars. | Add license schema + routing-config schema, validate both at boot. |
| **Database seed** | Includes synthetic multi-tenant users (Alex Thornton etc.). | Customer-first-boot seed: creates one admin from the license's `contact` field + a default tenant; no demo users. |
| **Deploy pipeline** | GitHub Actions builds images but doesn't sign. | Add `cosign sign` + GitHub Release upload. |
| **Public key distribution** | N/A. | Embed public key as a constant in the API; publish it in README too. |

### 7.3 Dual-track: SaaS stays alive

Both delivery models share the same codebase. A single boolean (`DEPLOYMENT_MODE=saas | standalone`) switches between:
- `saas`: current behaviour, multi-tenant, GenBioCa-owned, env-var module gating, Anthropic-only AI.
- `standalone`: license-driven module gating, multi-provider AI, no demo users, telemetry off.

Minimizes code divergence. One PR, two deploy flavors.

---

## 8. Build phases

Recommend 6 phases. Rough sizing: each is 1-3 weeks of focused work for a small team.

### Phase 0 — Foundation (prerequisite, ~1 week)
- Set up `clinwrite-license-studio` private repo (D9).
- Generate the ES256 keypair; put the private key on a YubiKey.
- Document the "ceremony" for signing a license (who touches the YubiKey, who records the issuance, what gets emailed).
- Define the license JWT schema; land it in both repos as a shared types package or spec file.

### Phase 1 — License engine in the data plane (~2 weeks)
- New Fastify plugin: load `.lic` → verify → populate `app.license`.
- Replace `FEATURE_MODULES_ENABLED` reads with `app.license.modules`.
- Add `license_heartbeats` table + daily cron.
- Expiry degradation: a route-level middleware that returns 403 `license_expired` on write routes once past the grace window.
- Audit entries: `license_activated`, `license_renewed`, `license_grace_entered`, `license_expired`.
- Boot refuses to start if no `.lic` present (hard requirement).
- Tests: valid license, expired license in grace, expired past grace, revoked, clock rollback, missing file.

### Phase 2 — License Studio (~3 weeks)
- Customer directory CRUD.
- License JWT generator (click button → YubiKey sign → `.lic` file + README downloaded).
- Revocation list management.
- Issuance audit log.
- Email templates (customer onboarding, renewal, revocation notice).
- Zero network calls to customer deployments. Studio is a tool for GenBioCa staff.

### Phase 3 — Multi-provider AI gateway (~3 weeks)
- Refactor `app.aiGateway` into the provider-abstraction interface.
- Ship 6 adapters: anthropic, openai, google, azure-openai, bedrock, ollama.
- Routing config schema + loader + hot-reload (SIGHUP).
- Per-feature usage of the routing config (fan out from the handful of today's call sites).
- Fallback chain + "disable AI on total failure" branch.
- Tests per adapter + routing tests + chaos test (primary dies, fallback kicks in).

### Phase 4 — Deployment artefacts (~2 weeks)
- GitHub Actions: build + cosign-sign Docker images on tag push.
- Build + sign the tarball; attach both to GitHub Releases.
- Pre-flight check script: validates host (Postgres reachable, Redis reachable, blob writable, `.lic` present + valid, provider keys parseable).
- Install script: pulls images, writes systemd units, runs migrations.
- Backup / restore / upgrade runbooks (written, tested).

### Phase 5 — Compliance appendix + documentation (~2 weeks)
- Audit extraction CLI: dumps the hash-chained audit log in CSV/JSON for inspectors.
- Compliance mapping doc: GxP / 21 CFR Part 11 / HIPAA / DPDPA — which clause maps to which log / which feature.
- Threat model document.
- Install guides per cloud (AWS, Azure, GCP, bare metal).
- Security hardening checklist.

### Phase 6 — Pilot deployment + hardening (~2 weeks)
- Pick a friendly customer; deploy standalone with a 90-day pilot license.
- Weekly check-ins; capture every pain point.
- Harden the weakest piece.
- Only after the pilot survives a renewal cycle do we open the door to paid customers.

**Not in scope for v1** (would be a Phase 7+):
- Multi-sub-tenant inside one deployment.
- Online license refresh (phone-home).
- Automated migration dry-run.
- Browser-client Yjs collaboration across air-gap boundaries.
- Shared-key AI usage telemetry.

---

## 9. Open questions

Call these out so the new project's kickoff has them tabled:

1. **Signing-key custody**: YubiKey is specified. Who physically holds it? Where's the backup if the primary is lost? Suggest a 2-of-3 Shamir split across CEO, IT head, and a sealed envelope in legal's safe.
2. **License amendment flow**: when a customer wants to add seats or a module mid-term, what's the SLA from request → new `.lic` emailed? Suggest 1 business day with a documented request form.
3. **Revocation enforcement**: pure air-gap deployments can't check revocation online. Options: ship revocation list in each monthly release (slow); customer opt-in to a Monday-morning `curl` of the signed revocation list (fast but customer-configured). Pick one.
4. **AI provider KYC**: if the customer uses OpenAI with its 30-day retention default, that undermines our privacy pitch. Do we require customers to configure "no retention" with their chosen provider? Document that expectation.
5. **PHI boundary**: section text may contain patient identifiers if the customer is sloppy. Current AI gateway proxies through to the LLM without masking. For HIPAA-covered deployments we may need an opt-in PII redaction pass before the LLM call. Scope decision.
6. **Support model** without logs: who runs the "golden ticket" session where a customer screen-shares their logs? Document the process.
7. **Legal / DPDPA signoff**: before Phase 6 pilot, we need a Data Processing Agreement template that reflects "we touch nothing." Legal / DPO review required.

---

## 10. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Customer-side support becomes a cost sink | High | High | Invest in Phase 4/5 install + ops docs; ship a `clinwrite-doctor` CLI that gathers safe-to-share diagnostics. |
| Multiple-version-support debt | Medium | High | Max two supported minor-versions behind current. Deprecation policy documented at Phase 2. |
| Customer bungles their own migration + loses data | Medium | Catastrophic | Install script writes pre-migration pg_dump into `./backups/`; refuses migration without free disk space. |
| Signing key compromise | Low | Catastrophic | YubiKey hardware. Rotation playbook: new keypair → emergency release that trusts both keys for 90 days → remove old. |
| Customer sets system clock back to extend license | Medium | Medium | Monotonic heartbeat table + `clock_rollback_detected` boot guard (D2 scope). |
| LLM provider changes model names / deprecates | High | Medium | Provider adapters version-pin; routing config is customer-editable so they can bump at their pace. |
| Customer opts into no-telemetry so you miss a critical bug | High | Medium | Release notes include known-issue callouts; `clinwrite-doctor` surfaces common misconfig locally. |
| Customer uses OpenAI with default retention; privacy pitch undermined | High | High | Install guide includes a required "configure your provider for zero-retention" step; documented in compliance appendix (D5 open question 4). |

---

## 11. Appendix

### 11.1 Example compose fragment (customer-shipped)

```yaml
# docker-compose.yml (fragment)
services:
  api:
    image: ghcr.io/kvs-source/clinwrite-api:v1.2.3
    environment:
      DEPLOYMENT_MODE: standalone
      DATABASE_URL: postgresql://clinwrite:${DB_PASSWORD}@postgres:5432/clinwrite
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      BLOB_DIR: /var/lib/clinwrite/blob
      AUDIT_HASH_SECRET: ${AUDIT_HASH_SECRET}
      # License file is a volume mount, not an env var
    volumes:
      - ./license:/opt/clinwrite/license:ro
      - ./config:/opt/clinwrite/config:ro        # ai-routing.json lives here
      - blob:/var/lib/clinwrite/blob
    depends_on: [postgres, redis]
```

### 11.2 Example AI routing config

See §6.5.

### 11.3 Example license JWT

See §6.4.

### 11.4 Reference external products

For prior art the team can study:
- **Keygen** (license-as-a-service) — JWT shape + revocation patterns.
- **Replicated / KOTS** — "Kubernetes off-the-shelf" distribution model.
- **GitLab EE** — self-hosted enterprise with license tokens.
- **Mattermost / Rocket.Chat** — self-hosted communications with signed tarball releases.
- **Metabase Enterprise** — small internal control app + customer-hosted analytics.

---

**End of PRD.** Carry this file into the new project's `docs/` folder as the kickoff brief.
