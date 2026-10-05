---
title: Service Level Objectives (SLOs)
status: draft
owner: SRE Lead
reviewers: ["Head of Engineering", "Head of Customer Success"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# Service Level Objectives

What customers can expect from ClinWrite.AI as a service, and how the SRE
team measures itself against that promise.

## Headline SLOs

| # | SLI | SLO target | Error budget | Measurement window |
|---|---|---|---|---|
| 1 | API availability (`platform-api` returns non-5xx on `/health`) | **99.9%** | 43 min / month | Monthly |
| 2 | Non-AI endpoint latency p95 | **≤500 ms** | 5% of requests may exceed | Rolling 7-day |
| 3 | Non-AI endpoint latency p99 | **≤1500 ms** | 1% of requests may exceed | Rolling 7-day |
| 4 | API error rate (5xx) | **≤0.1%** | 43,200 bad requests / 30M total | Rolling 7-day |
| 5 | AI gateway latency p95 (gateway overhead, excluding provider time) | **≤100 ms** | 5% may exceed | Rolling 7-day |
| 6 | Backup success rate | **≥99.5%** | ~1 missed in 200 nights | Rolling 90-day |
| 7 | Audit chain integrity | **100%** (zero breaks) | None — a break is a Sev1 | Continuous |

## Why these numbers?

- **99.9% uptime** = 8.76h / year, 43m / month, 10m / week. This is the
  commercial standard for pharma-adjacent SaaS. 99.95% is achievable with
  multi-AZ failover (ADR 0007 Year 2 target); 99.99% requires architectural
  changes (active-active, write-path consensus) we have no commercial need for.
- **p95 500ms** — writers tolerate up to ~1s latency before noticing;
  500ms gives headroom for the SPA to layer renders on top.
- **AI gateway overhead 100ms** — the provider call is the dominant cost,
  so the gateway's PII scrub + quota lookup must stay cheap.
- **Audit chain 100%** — Part 11 is binary. A break isn't an SLO miss,
  it's an audited compliance incident.

## Error budget policy

Error budgets are spent, not wasted. When a budget is burning fast
(>50% of a monthly budget in the first week), feature releases pause
and reliability work takes priority. See `docs/launch/error-budget-policy.md`
(TBD) for the fallback-to-SRE playbook.

## Measurement sources

| SLI | Metric source | Dashboard panel |
|---|---|---|
| Availability | Prometheus `up{job="platform-api"}` + Cloudflare synthetic | overview — "uptime last 30d" |
| p95/p99 latency | `histogram_quantile(0.95, ...http_request_duration...)` | api-latency — "latency percentiles" |
| Error rate | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` | api-errors — "5xx rate" |
| AI gateway overhead | `histogram_quantile(0.95, ai_gateway_overhead_seconds)` — custom metric | ai-gateway — "gateway overhead" |
| Backup success | `platform_backup_last_success_seconds` from backup.sh | infra — "backup health" |
| Audit chain | `/admin/compliance/verify-chain` nightly cron → `platform_audit_chain_intact` gauge | compliance — "chain integrity" |

## Burn-rate alerts

Two-threshold burn-rate alerting (Google SRE book):

| Alert | Burn rate | Window | Severity |
|---|---|---|---|
| ApiErrorBudgetFastBurn | 14.4× (burns 2% in 1h) | 1h | critical / page |
| ApiErrorBudgetSlowBurn | 1× (burns 10% in 3d) | 6h | warning / ticket |

Encoded in `infra/standalone/observability/prometheus/alerts.yml`.

## What's NOT covered by these SLOs

- **AI provider latency** — Anthropic's p95 is their problem. The gateway
  overhead SLO excludes the forwarded call explicitly.
- **Scheduled maintenance** — up to 1h/month of pre-announced maintenance
  excluded from availability calc. Communicated via status page >48h prior.
- **Customer network issues** — Cloudflare synthetic measures from
  multiple regions; a single-region issue outside Cloudflare's control
  doesn't count against our SLO.
- **DR drill windows** — explicitly announced; excluded.

## Status page

Three states:
- 🟢 Operational — all SLOs in budget
- 🟡 Degraded — one or more SLOs burning fast or breached in rolling window
- 🔴 Outage — availability SLO is actively failing (`up == 0` or 5xx > 50%)

State transitions are automatic via Prometheus → Alertmanager → status page.
Manual override by the IC during an incident.

## Review cadence

- **Weekly**: SRE Lead reviews the SLO dashboard; files tickets for any
  burn-rate concerns.
- **Monthly**: SLO review meeting; adjust targets ONLY on data (e.g.
  "we've held 99.95% for 6 months — tighten the target to 99.95").
  Loosening a target without reliability work is forbidden.
- **Per-release**: Any change to error budget consumption is a release
  gate review item.
