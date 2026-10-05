# ADR 0004: LLM provider — Anthropic Claude via direct API (with Azure OpenAI as fallback)

**Status**: Accepted (2026-10-05, after adversarial review) — pending BAA confirmation with Anthropic
**Date**: 2026-10-05
**Owner**: Tech lead + Legal
**Deciders**: Tech lead, Legal, Compliance, 1× BE engineer
**Supersedes**: —
**Superseded by**: —

## Context

Every AI-mediated feature in the architecture (`docs/demo/01-architecture.md §21–§23`) assumes an LLM. The prototype's `simulateAI()` hardcodes `model: 'claude-sonnet'`, hinting at Anthropic. We need to make the real decision now because it drives:

- **BAA / DPA negotiation** (legal lead time: 4–8 weeks)
- **Centralised AI Gateway design** (Phase 4) — rate limiting, prompt caching, cost accounting, PII scrubbing
- **Prompt-cache budget planning** — our use case has large repeated per-project contexts (CSR sections, Master Library, claims corpus) that benefit massively from prompt caching
- **Compliance surface** for GAMP 5 (every AI-mediated output is traceable to a prompt + model version + response)

## Decision

**Primary**: Anthropic Claude via the direct Anthropic API (`claude-opus-4-x` for complex reasoning tasks, `claude-sonnet-4-x` for high-volume tasks, `claude-haiku-4-x` for cheap bulk operations).

**Fallback / per-tenant alternative**: Azure OpenAI (GPT-4o / GPT-4-turbo) with the enterprise-tier BAA, if Anthropic BAA negotiation fails or a specific customer tenant requires it.

**Hard requirement baked into the decision after adversarial review**: the AI Gateway (Phase 4) **must support per-tenant provider selection as a runtime config flag**, not just a build-time toggle. This matters because the regulated-SaaS buying market in pharma is 60–70% already on Microsoft 365 + Entra ID; those customers may mandate "AI stays inside our Azure estate" as a contract condition. Per-tenant switchability turns that from a lost deal into a config entry.

**Pattern**: All LLM calls route through the AI Gateway service. The gateway supports both providers behind a stable internal interface, exposes per-tenant provider routing, and enforces cost + rate limits per tenant.

## Options considered

### Option A — Anthropic Claude direct API *(primary)*
- **Pros**
  - **Prompt caching** gives us 90% cost reduction and 85% latency reduction on repeated per-project context (CSR scaffolding, Master Library, claims corpus). This fits our usage pattern precisely — most AI calls in Modules A/C/D re-use the same context across many requests.
  - **Model quality** — Claude Opus leads on long-context regulated-writing-adjacent benchmarks (medical note generation, structured extraction, complex table reasoning).
  - **1M-token context window** on Opus 4 — fits an entire CSR + its referenced TLF package in a single prompt.
  - **Constitutional AI** training reduces jailbreak and off-label-promotion risk — material for a regulated product.
  - **BAA available** (standard enterprise agreement).
- **Cons**
  - Smaller ecosystem of monitoring/observability tooling than OpenAI.
  - BAA negotiation terms depend on volume commitment — may need a committed-use agreement.
- **Rough effort / cost**: Standard; AI Gateway abstracts the SDK choice.

### Option B — Azure OpenAI *(fallback / per-tenant alternative)*
- **Pros**
  - **Enterprise BAA** is boilerplate — Azure has HIPAA/HITRUST attestations covering OpenAI service.
  - Some enterprise customers mandate Azure-hosted everything — this unlocks them without us running two different gateways.
  - Mature ecosystem (Datadog, New Relic, Langfuse all have first-class support).
- **Cons**
  - **Prompt caching** is less mature than Anthropic's; semantic caching alternatives are vendor-specific.
  - GPT-4o quality is competitive on most tasks but lags Claude Opus on long-context structured extraction (where we live).
  - Per-token price is higher at the 1M-context tier that we need.
- **Rough effort / cost**: Standard once the gateway abstracts both providers.

### Option C — AWS Bedrock
- **Pros**: Access to Claude via Bedrock gives a single AWS bill + BAA.
- **Cons**: Bedrock's Claude flavour trails Anthropic direct by ~2–4 weeks on model updates; prompt caching feature parity has historically been late. Also forces us onto AWS as the compute platform (preempts ADR 0007).
- **Rejected for primary** but keep as a tertiary option if AWS lock-in becomes acceptable.

### Option D — Self-hosted open models (Llama, Mistral, Qwen)
- **Pros**: No vendor BAA to negotiate, no data leaves our VPC.
- **Cons**
  - Quality gap on regulated-writing tasks is large and unlikely to close within our timeline.
  - GPU hosting is a line item we don't need.
  - Compliance paperwork for a hosted model is actually *more* work (we own the whole validation stack vs inheriting the vendor's).
- **Rejected** for production use. Reconsider for low-stakes utility tasks only (e.g. doc classification) if we hit cost ceilings.

## Rationale

Three decisive factors stack:

1. **Prompt caching fit.** Our workload — repeated per-project context (CSR sections, Master Library claims, author profiles) across many short completions per session — is the textbook best-case for Anthropic's prompt caching. 90% cost reduction on steady-state operations is material to the AI cost line.
2. **1M-token context.** Several Module D use cases (cross-CTD consistency, HA response drafting with full dossier context) genuinely need the context window. Without it we're synthesising summaries, which hurts accuracy on exactly the Part 11 outputs we care about.
3. **Switchability via the gateway.** Because the AI Gateway abstracts the SDK, the decision is reversible per-tenant at near-zero code cost. We're not locking ourselves in.

## Consequences

### Positive
- Prompt caching cuts AI costs ~70–90% on repeated-context workloads (Modules A/C/D).
- Full-document context on Opus removes a class of accuracy bugs (summary-of-summary drift).
- Switchable per tenant via the gateway.

### Negative
- **BAA negotiation lead time**: 4–8 weeks typical with Anthropic; start Phase 0 Week 1.
- Ecosystem gap on observability — need to adopt Langfuse (OSS, provider-agnostic) early for prompt/response tracing.
- Monthly cost ceiling needs a hard enforcement in the AI Gateway from day one.

### Neutral / downstream work
- Phase 0 Week 1: Legal engages Anthropic for BAA; parallel Azure OpenAI BAA as fallback.
- Phase 4 (AI Gateway) must implement a `LLMProvider` interface with both Anthropic and Azure OpenAI adapters from day one, even if only Anthropic is wired in production. **Per-tenant provider selection is a hard requirement** of the gateway, not a nice-to-have. Rules out hard-coding either SDK into feature code.
- Prompt-cache keys and TTLs are a per-feature design decision; captured in a `prompt-cache-registry.md` created in Phase 3A.
- Model-version pinning is mandatory for GAMP 5 — PRs that bump a model version must trigger regression testing against the AC suite.

## Compliance implications

- **21 CFR Part 11**: Every AI-mediated output must be audit-logged with prompt hash + model ID + model version + response hash + timestamp. The AI Gateway is the enforcement point; feature code cannot bypass it (same architectural pattern as the audit trail from ADR 0002).
- **HIPAA**: BAA with the LLM provider is a hard requirement before any PHI (patient narratives, SAE case data) touches the API. Non-PHI workloads can run without BAA for cost-sensitive bulk operations.
- **GDPR**: EU-tenant workloads must either use an EU-hosted inference endpoint (Anthropic has European-region API) or route via Azure OpenAI EU regions. Gateway must enforce regional routing per tenant.
- **GAMP 5**: Each prompt template is a Configurable Item under version control. Model-version changes are controlled changes requiring regression test evidence.

## References

- Anthropic prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Anthropic BAA process: https://support.anthropic.com/en/articles/8956058
- Azure OpenAI HIPAA/HITRUST: https://learn.microsoft.com/en-us/azure/compliance/
- Langfuse (observability): https://langfuse.com/
