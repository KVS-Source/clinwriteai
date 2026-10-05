---
title: SOC 2 Type II Evidence Collection Plan
status: draft
owner: Security Lead
reviewers: ["Compliance Lead", "External SOC 2 Auditor"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# SOC 2 Type II — Evidence Collection Plan

Type II requires a **6-month operating window** of evidence. Start collection
*before* starting the audit engagement — the clock starts when the first
evidence is captured, not when the auditor arrives.

## Evidence cadence

| Cadence | Evidence | Automation | Storage |
|---|---|---|---|
| Continuous | Audit trail (every mutating request) | `audit_events` table | DB + nightly export |
| Continuous | Error logs | Loki aggregator | S3-compatible backup bucket |
| Continuous | Metrics (CPU, memory, latency, DB conns) | Prometheus | 30-day retention; archived to object storage after |
| Continuous | Deployment log | GitHub Actions runs | GitHub artifact + commit SHA linked to deploy audit event |
| Daily | Backup success/failure | `infra/standalone/scripts/backup.sh` + cron | Backup log file in B2 |
| Weekly | Vulnerability scan | `npm audit` + Dependabot alerts | GitHub repo issues |
| Monthly | Access review | Script dumps active users + roles + modules | PDF filed to compliance share |
| Monthly | Chain integrity verification | `GET /admin/compliance/verify-chain` snapshot | PDF filed; alert if ever `intact:false` |
| Quarterly | DR drill | Full restore to a staging VPS from latest backup | After-action report |
| Quarterly | Firewall rule review | `ufw status numbered` + nginx config | Reviewed + initialled |
| Annual | Penetration test | External firm engagement | Report + remediation tracker |
| Annual | Policy review (all compliance docs) | Review+update cycle | Git log + signatures |

## Automated evidence inventory

| Source | Pulls | Format | Where it ends up |
|---|---|---|---|
| `audit_events` | `pg_dump --table=audit_events` nightly | SQL dump + Parquet export | B2 bucket `audit-archive/YYYY/MM/DD/` |
| Prometheus | metrics scrape via Grafana API | JSON | B2 bucket `metrics-archive/` |
| Loki | log segments | compressed JSONL | B2 bucket `logs-archive/` |
| GitHub Actions | workflow run metadata | JSON via `gh api` nightly | B2 bucket `ci-archive/` |
| Deploy script | `/opt/platform/logs/deploy-$(date).log` | text | B2 bucket `deploy-archive/` |

## Manual evidence captures

| What | When | How | Who |
|---|---|---|---|
| Access review signoff | Monthly 1st Mon | Review `/admin/users` list; disable inactives | Security Lead |
| Vendor review | Quarterly | DPAs with Anthropic/WorkOS/VPS/B2 reviewed; attestations collected | Compliance Lead |
| Change advisory board | Per major release | Review ADR + risk; approve/decline | CAB chair |
| Incident post-mortem | Within 5 business days of any Sev1/Sev2 | Blameless post-mortem using template in `runbooks/` | On-call engineer |

## Audit readiness dashboard

Build a Grafana dashboard reading from the following queries so auditors can
inspect live:

1. **Audit chain health** — `SELECT COUNT(*) FROM audit_events` + results of
   the chain verify endpoint (last 24h sample).
2. **Deployment velocity** — commits merged to main / deploys per week.
3. **Access denial rate** — 401/403 responses as % of total requests.
4. **Backup success rate** — successful backup cron executions in last 30 days.
5. **Mean time to restore** — from DR drill reports.
6. **Incident count by severity** — rollup by month.
7. **Open high-severity vulns** — Dependabot alerts in `security:advisory` status.

Dashboard URL to be shared with the auditor at audit kickoff.

## Operating-window milestones

Assuming audit engagement starts month 6:

| Month | Deliverable |
|---|---|
| 1 | Automated evidence pipelines live (continuous feeds flowing to B2) |
| 1 | First access review completed and filed |
| 2 | First chain integrity verification snapshot filed |
| 3 | First DR drill executed; after-action report filed |
| 3 | Vendor review cycle completed |
| 4 | Penetration test commissioned (so results in-hand by month 5-6) |
| 5 | Internal readiness review — all SOC 2 TSC controls at 🟢 |
| 6 | External auditor kickoff |

## Failure handling

An evidence collection failure (missing backup, chain break, missed access
review) is itself an auditable incident. Trigger the incident response
runbook (`runbooks/incident-response.md`), file a post-mortem, and record
the remediation in the deficiency log.
