# Phase 0 — Prerequisites & Decisions Tracker

**Phase goal**: Unblock Phase 1 build. Finalise stack ambiguities, start legal/vendor paperwork, provision environments.
**Target duration**: 2 weeks.
**Owner**: Tech lead.

See [architecture-implementation-plan.md](architecture-implementation-plan.md) for the full phase definition.

## Status key

- ✅ Done
- 🔄 In progress
- ⏸ Blocked (external dependency)
- ⬜ Not started
- 📝 Needs human decision

## ADRs — technical decisions

| # | Decision | Status | Blocking |
|---|---|---|---|
| 0001 | [Backend framework → Fastify](adr/0001-backend-framework.md) | ✅ Accepted (2026-10-05) — amended: throughput claim softened, audit-hook named as decisive | — |
| 0002 | [ORM → Prisma + raw SQL for audit trail](adr/0002-orm.md) | ✅ Accepted (2026-10-05) — amended: commits to multi-file schema; typed-SQL option documented; Phase 1 W4 checkpoint added | — |
| 0003 | [Vector store → pgvector on same Postgres](adr/0003-vector-store.md) | ✅ Accepted (2026-10-05) — amended: vector dim ≤ 1536 hard constraint added | — |
| 0004 | [LLM provider → Anthropic Claude (direct API)](adr/0004-llm-provider.md) | ✅ Accepted (2026-10-05) — amended: per-tenant provider switching in AI Gateway is now a hard requirement, not nice-to-have. Still pending BAA with Anthropic (Legal, 4–8w) | — |
| 0005 | SSO provider → Entra ID / Okta / Auth0 | ⬜ Not drafted | Phase 1 auth implementation |
| 0006 | Secrets manager → AWS Secrets vs HashiCorp Vault | ⬜ Not drafted | Phase 1 env config |
| 0007 | Deployment target → AWS / GCP / Azure | ⬜ Not drafted | Terraform skeleton (below) |
| 0008 | Job queue → BullMQ / SQS / NATS | ⬜ Not drafted | Phase 1 async worker scaffold |
| 0009 | Diff algorithm scope (char / word / section) | ⬜ Deferred to Phase 3A kick-off | Module A owner |
| 0010 | E-signature document hash scope | ⬜ Deferred to Phase 3A kick-off | Compliance input required |
| 0011 | Canonical JSON indexing approach | ⬜ Deferred to Phase 3D kick-off | Module D owner, 2-week spike |
| 0012 | Claims Matrix similarity (embedding model + reranker) | ⬜ Deferred to Phase 3C kick-off | AI engineer |
| 0013 | eCTD validator vendor (Extedo / Lorenz / Verrochio) | ⏸ Vendor procurement lead time | Phase 3D cannot ship without |

## Legal / contracting — external dependencies

| Item | Owner | Status | Lead time | Trigger date |
|---|---|---|---|---|
| Anthropic BAA | Legal | ⬜ | 4–8 weeks | Phase 0 W1 |
| Azure OpenAI BAA (fallback) | Legal | ⬜ | 2–4 weeks (standard enterprise) | Phase 0 W1 |
| Customer DPA templates | Legal | ⬜ | 4–6 weeks | Phase 0 W1 |
| HIPAA BAA with cloud provider | Legal | ⬜ | Standard with AWS/Azure/GCP | After ADR 0007 |
| MedDRA MSSO licence (Module A) | Procurement | ⬜ | 2–4 weeks + annual fee | Phase 1 W4 |
| CrossRef depositor account (Module B) | Procurement | ⬜ | 2–3 weeks + annual fee | Phase 2 W8 |
| ORCID member registration (Module B) | Procurement | ⬜ | 2 weeks | Phase 2 W8 |
| eCTD validator licence (Module D) | Procurement | ⬜ | 6–10 weeks (vendor sales cycles) | Phase 0 W1 — critical path |
| **FDA ESG onboarding** | Regulatory + Compliance | ⬜ | **3–6 months** (production certs, test transactions, PGP keys) | **Phase 0 W1 — critical path** |
| EMA CESP onboarding + QES certs | Regulatory + Compliance | ⬜ | 2–4 months | Phase 0 W2 |
| CDSCO SUGAM access (India) | Regulatory | ⬜ | 2–3 months | Phase 0 W2 |

## Cloud + infra — provision

| Item | Owner | Status | Blocking |
|---|---|---|---|
| Cloud provider decision (ADR 0007) | Tech lead + DevOps | ⬜ | Everything infra |
| Cloud account + billing | Finance + DevOps | ⬜ | Env provisioning |
| VPC + networking baseline (3 envs) | DevOps | ⬜ | Phase 1 deploy |
| Terraform skeleton (provider-agnostic start) | DevOps | 🔄 Scaffolded this session | Fleshing out per ADR 0007 |
| Secrets manager provisioned | DevOps | ⬜ | ADR 0006 |
| GitHub Actions base CI | DevOps | 🔄 Pending — next in this session | — |
| Container registry (ECR / GAR / ACR) | DevOps | ⬜ | After ADR 0007 |
| Observability stack (OTel collector, Grafana / Datadog) | DevOps | ⬜ | Phase 1 end |

## Team + process

| Item | Owner | Status |
|---|---|---|
| Hire BE engineers (2) | Tech lead | ⬜ |
| Hire DevOps/SRE (1) | Tech lead | ⬜ |
| Hire or engage Security/Compliance (part-time ok) | Tech lead | ⬜ |
| Hire or engage AI engineer (part-time ok) | Tech lead | ⬜ |
| Agree on definition-of-done per phase | Tech lead | ⬜ |
| Set up Linear/Jira project with phases + ACs imported | Tech lead | ⬜ |
| SOC 2 Type II **evidence collection start** (6-month window) | Compliance | ⬜ — **start end of Phase 1, not Phase 5** |

## Done this session (what Claude has produced)

- ✅ Architecture plan → [`architecture-implementation-plan.md`](architecture-implementation-plan.md)
- ✅ ADR structure, template, README index → [`adr/README.md`](adr/README.md) + [`adr/template.md`](adr/template.md)
- ✅ ADR 0001 Backend framework (Fastify) — **Accepted (2026-10-05)**
- ✅ ADR 0002 ORM (Prisma + raw SQL for audit) — **Accepted (2026-10-05)**
- ✅ ADR 0003 Vector store (pgvector) — **Accepted (2026-10-05)**
- ✅ ADR 0004 LLM provider (Anthropic with Azure fallback) — **Accepted (2026-10-05)**
- ✅ Adversarial review on ADRs 0001–0004 → 4 amendments merged
- ✅ This tracker

## Next in this session (Claude will produce)

- ⬜ GitHub Actions base CI workflow (`.github/workflows/ci.yml`) — lint + typecheck + build for `apps/web`, scaffold-only for `apps/api`
- ⬜ Terraform skeleton under `infra/terraform/` with provider-agnostic module shape (fill in provider after ADR 0007)
- ⬜ `apps/api/` baseline scaffold: `package.json`, `tsconfig.json`, `src/server.ts` (empty Fastify boot), `prisma/schema.prisma` (empty), `.env.example`

## Needs human action to unblock Phase 1

Before Phase 1 can start:
1. ~~**Review and Accept ADRs 0001–0004**~~ ✅ Done 2026-10-05 after adversarial review
2. **Draft ADRs 0005–0008** (SSO, Secrets, Deployment target, Job queue — Claude to draft, team confirms)
3. **Kick off FDA ESG + eCTD validator procurement** (long lead time; must start now)
4. **Engage Legal** on BAAs (Anthropic + cloud provider + customer DPA)
5. **Agree on cloud provider** (ADR 0007) — unblocks Terraform fleshing-out
