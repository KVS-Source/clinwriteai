---
title: Data Residency Strategy
status: draft
owner: SRE Lead
reviewers: ["Compliance Lead", "DPO", "Head of Engineering"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# Data Residency Strategy

Different customers (and jurisdictions) impose different requirements on
where data physically lives. This doc describes the deployment variants
we support + the triggers for each.

## Current deployment variant (default)

- **Primary region**: EU (Hetzner FSN1, Falkenstein, Germany)
- **Backup region**: EU (Backblaze B2 EU-central, Amsterdam)
- **TLS termination**: Cloudflare EU proxies
- **AI provider**: Anthropic — processing in US; SCCs in place

Suitable for:
- EU-based customers under GDPR
- US-based customers who accept SCCs for AI processing
- UK customers (post-Brexit — UK ICO accepts SCCs or UK Addendum)

## Variant: EU-only (no US processing)

**When required**: Customer under strict EU data residency mandate (e.g.,
some German pharma, French public-sector customers).

**Changes**:
- AI provider swapped to a EU-hosted Anthropic deployment (Anthropic
  Business tier EU residency) OR Mistral / Azure OpenAI EU region. The
  AI Gateway `LlmClient` interface makes this swap a one-file change.
- Backups: Backblaze EU-central (already default).
- Cloudflare EU-only Zone + Enterprise feature "no US proxying".
- WorkOS: EU residency option — needs WorkOS Enterprise tier.
- Logs (Loki): EU VPS only; no shipping to US-hosted log aggregators.

**Documentation deliverable to customer**: EU-residency attestation
appended to DPA.

## Variant: US-only (HIPAA-preferred)

**When required**: US Covered Entities who want all PHI to stay in US
jurisdiction.

**Changes**:
- Primary VPS: Hetzner US (Ashburn, VA) OR AWS us-east-1 if we've migrated
  to AWS per ADR 0007.
- Backups: Backblaze US-West or AWS S3 us-east-1 (depending on infra).
- AI provider: Anthropic US (default).
- WorkOS: US region.
- Cloudflare: standard proxies.

**Documentation deliverable**: HIPAA-preferred attestation + BAA.

## Variant: Dedicated single-tenant

**When required**: Enterprise contracts that require physical isolation.

**Changes**:
- Dedicated VPS pool (not multi-tenant).
- Separate DB cluster.
- Separate MinIO buckets.
- Separate BullMQ queue.
- Potentially separate deploy pipeline so this tenant's releases are
  independently scheduled.

**Trade-offs**: ~5x hosting cost per tenant; slower feature propagation
unless we invest in multi-tenant deploy automation.

## Decision criteria

| Customer profile | Default | EU-only | US-only | Dedicated |
|---|---|---|---|---|
| EU pharma, no explicit mandate | ✅ | | | |
| EU pharma, explicit "no US" mandate | | ✅ | | |
| US pharma under HIPAA, standard | ✅ | | | |
| US pharma under HIPAA, "US-only" clause | | | ✅ | |
| Big pharma (any geo) requiring dedicated | | | | ✅ |
| Government / highly regulated | | | | ✅ |

## Technical enablers

### AI provider swap

`AiGatewayService` constructor takes an `LlmClient`. The `StubLlmClient`
can be swapped for an `AnthropicLlmClient` (standard), `AnthropicEULlmClient`,
`MistralLlmClient`, or `AzureOpenAILlmClient`. All implement the same
`LlmClient.send()` contract.

Deployment env determines which client the plugin wires:
```
LLM_PROVIDER=anthropic | anthropic-eu | mistral | azure-openai
```

### Backup region swap

`infra/standalone/scripts/backup.sh` reads `BACKUP_S3_ENDPOINT` from
sops-encrypted env. Point at EU or US endpoint without code change.

### WorkOS region

Set in WorkOS org config (not platform code).

## Audit evidence for data-residency claims

When a customer attests to "all my data stays in region X", the compliance
evidence they can request:

1. **Infrastructure fingerprint**: `GET /admin/compliance/report` includes
   a future `regionAttestation` field (TBD) reporting the API host region,
   backup endpoint region, and LLM provider region in effect.
2. **Backup location**: Backblaze B2 console shows the bucket region.
3. **DNS**: WHOIS + IP geolocation of the API hostname.
4. **AI provider attestation**: Anthropic (or alt) attestation of
   processing region for the specific tenant's API key.

## Known cross-border data flows (and how to make them stop)

| Flow | How to disable |
|---|---|
| Anthropic (US) processing EU customer prompts | Swap to Anthropic EU / Mistral; set `LLM_PROVIDER=anthropic-eu` |
| GitHub Actions runners (US) running our CI | Switch to self-hosted EU runners for the deploy workflow (not needed for build-and-test) |
| Sentry (US) ingesting error reports | Use Sentry self-hosted on our EU VPS OR Sentry EU region |
| OpenTelemetry collectors shipping traces | Keep traces on-VPS; no external vendor |
