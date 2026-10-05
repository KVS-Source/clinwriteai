---
title: ISMS Scope Statement
status: draft
owner: Security Lead
reviewers: ["Compliance Lead", "ISO 27001 Certification Body"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# ISMS Scope Statement

Per ISO/IEC 27001:2022 clause 4.3, the Information Security Management
System scope defines what is in and out, and the interfaces between.

## In scope

- **Services**: The ClinWrite.AI SaaS platform (Fastify API, SPA, worker)
  across all tenants.
- **Data**: Customer-authored content, audit logs, AI call records,
  user identity + session data.
- **Infrastructure**: Hosted VPS running `platform-api`, `platform-worker`,
  Postgres, Redis, MinIO, nginx, Prometheus/Grafana/Loki stack.
- **Processes**: Software development lifecycle (ADR → PR → CI → deploy),
  incident response, change management, backup/restore, access provisioning.
- **People**: Engineering + Compliance + SRE roles with platform access.

## Out of scope

- Customer end-user devices (laptops, phones).
- Customer-provided third-party services integrated via API (unless we
  broker credentials for them).
- Non-ClinWrite workloads on the same cloud provider's shared infrastructure
  (the VPS boundary is clear).

## Interfaces + dependencies

| External party | Interface | Risk owner |
|---|---|---|
| WorkOS | OIDC/SAML federation + SCIM provisioning | WorkOS (SOC 2 Type II attested) |
| Anthropic | HTTPS API for LLM | Anthropic (SOC 2 Type II attested) |
| Hetzner (VPS) | IaaS hosting | Hetzner (ISO 27001 certified) |
| Backblaze B2 | Object storage for backups | Backblaze (SOC 2 Type II attested) |
| Cloudflare | WAF + CDN + TLS termination | Cloudflare (ISO 27001 certified) |

## Information security objectives (ISO 27001 clause 6.2)

| Objective | Metric | Target |
|---|---|---|
| Prevent unauthorised access | Access denial events / month | Trending flat or down |
| Preserve data integrity | Chain breaks in audit_events | 0 |
| Maintain availability | API uptime | ≥99.9% monthly |
| Protect confidentiality | Confirmed data leaks | 0 |
| Respond to incidents | Sev1 MTTR | <4h |
| Pass audits | External audit findings | Zero critical/high |
