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
| 0005 | [SSO → WorkOS for B2B federation](adr/0005-sso-provider.md) | ✅ Accepted (2026-10-05) — amended: KOL guest path isolated from WorkOS. BAA needed (Legal, ~2w) | — |
| 0006 | [Secrets → SecretsProvider interface; sops+age standalone, Secrets Manager cloud](adr/0006-secrets-manager.md) | ✅ Accepted (2026-10-05) — revised same day for standalone-first per ADR 0007 | — |
| 0007 | [Deployment → Standalone VPS year 1, AWS/Azure year 2](adr/0007-deployment-target.md) | ✅ Accepted (2026-10-05) — revised same day for standalone-first | — |
| 0008 | [Job queue → BullMQ on Redis (standalone + cloud)](adr/0008-job-queue.md) | ✅ Accepted (2026-10-05) — new `apps/worker/` scaffold added | — |
| 0009 | [Standalone deployment stack](adr/0009-standalone-deployment-stack.md) | ✅ Accepted (2026-10-05) — follows ADR 0007 revision | — |
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
| Deployment decision (ADR 0007) | Tech lead + DevOps | ✅ Standalone VPS year 1 (per user direction) | — |
| ~~AWS org account + billing + sub-accounts~~ | ~~Finance + DevOps~~ | ⏸ Deferred to year 2 cloud migration | — |
| **Provision 1 dedicated Ubuntu 24.04 VPS for demo + bootstrap** | DevOps | ⬜ | Phase 1 deploy. See [`demo-environment-setup.md`](demo-environment-setup.md) runbook. Target spec: Hetzner CPX31 (€15/mo). Hosts DB + API + web app together. |
| Terraform skeleton — AWS year 2 target | DevOps | ✅ Preserved; shells exist in `infra/terraform/` | Year 2 cloud migration |
| **Standalone infra scaffold** — Docker Compose + nginx + systemd + MinIO + Prom/Grafana/Loki + sops + B2 backup | DevOps | ✅ Added this session under `infra/standalone/` | Phase 1 Week 2 provisions real VPS |
| sops age key generation + Backblaze B2 bucket + VPS BAA | DevOps + Security | ⬜ | Phase 1 Week 2 |
| **Cloudflare DNS + origin cert** per env | DevOps | ⬜ | Phase 1 Week 2 |
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
- ✅ ADR 0005 SSO (WorkOS) — **Accepted (2026-10-05, defaults policy)**
- ✅ ADR 0006 Secrets — **Accepted (2026-10-05, revised same day for standalone-first)** — SecretsProvider interface; sops+age standalone, Secrets Manager cloud
- ✅ ADR 0007 Deployment target — **Accepted (2026-10-05, revised same day for standalone-first)** — Standalone VPS year 1 with cloud-portable architecture
- ✅ ADR 0008 Job queue (BullMQ on Redis — standalone + cloud) — **Accepted (2026-10-05, defaults policy)**
- ✅ ADR 0009 Standalone deployment stack — **Accepted (2026-10-05)** — Docker Compose + nginx + MinIO + sops + Prom/Grafana/Loki + B2 backup
- ✅ `infra/standalone/` complete scaffold: docker-compose files, nginx config + snippets, systemd units + timer, bootstrap/deploy/backup/restore/rotate scripts, sops config, observability configs, 3 runbooks (BOOTSTRAP / BACKUP / DEPLOY)
- ✅ Phase 1 scaffold started on `apps/api`: Prisma multi-file schema layout, initial + audit_trail SQL migrations, `src/config/env.ts` + `src/config/secrets.ts` (SecretsProvider interface), `src/audit/hash.ts` + `src/audit/repository.ts` with InMemory implementation, Vitest unit tests for the hash chain (23 assertions)
- ✅ demo environment plan — single VPS hosts DB + API + web app: [`docs/demo-environment-setup.md`](demo-environment-setup.md) runbook, [`.github/workflows/deploy-demo.yml`](../.github/workflows/deploy-demo.yml) auto-deploy, nginx config updated for `demo.clinwrite.ai` + `demo-api.clinwrite.ai`, `scripts/deploy.sh` extended to build + rsync the web SPA bundle with `VITE_API_URL=https://demo-api.clinwrite.ai` baked in
- ✅ This tracker

## Next in this session (Claude will produce)

- ⬜ GitHub Actions base CI workflow (`.github/workflows/ci.yml`) — lint + typecheck + build for `apps/web`, scaffold-only for `apps/api`
- ⬜ Terraform skeleton under `infra/terraform/` with provider-agnostic module shape (fill in provider after ADR 0007)
- ⬜ `apps/api/` baseline scaffold: `package.json`, `tsconfig.json`, `src/server.ts` (empty Fastify boot), `prisma/schema.prisma` (empty), `.env.example`

## Needs human action to unblock Phase 1

Before Phase 1 can start:
1. ~~**Review and Accept ADRs 0001–0004**~~ ✅ Done 2026-10-05 after adversarial review
2. ~~**Draft ADRs 0005–0008**~~ ✅ Done 2026-10-05 (defaults policy)
3. ~~**Agree on cloud provider**~~ ✅ Standalone VPS year 1 (user direction), AWS year 2 (ADRs 0007 + 0009)
4. ~~**Create AWS org account**~~ ⏸ Deferred to year 2 cloud migration
5. ✅ **ADR 0009 Standalone deployment stack** drafted + `infra/standalone/` scaffold complete
6. **FDA ESG + eCTD validator procurement** — ✅ Boss notified; proceed with placeholders in Module D for now, wire real integrations when licence lands
7. **Engage Legal** on BAAs: Anthropic + WorkOS + VPS provider + customer DPA templates
8. ✅ **Team is ready for dev** (per user) → Phase 1 can begin

Phase 1 scaffold already in flight — see "Done this session" above.
