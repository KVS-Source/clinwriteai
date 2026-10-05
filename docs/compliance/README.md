# Compliance Documentation

This directory is the single source of truth for compliance artefacts
required to pass GAMP 5 Computerised System Validation (CSV), SOC 2 Type II,
ISO 27001, 21 CFR Part 11, HIPAA, and GDPR audits.

## Structure

| Folder | Purpose | Audience |
|---|---|---|
| [GAMP5/](./GAMP5/) | User Requirements, Functional / Design Specs, IQ/OQ/PQ protocols | Big-pharma procurement, FDA |
| [SOC2/](./SOC2/) | Control matrix, evidence collection plan, policies | SOC 2 auditor (Type II needs 6-month window) |
| [ISO27001/](./ISO27001/) | ISMS scope, risk register, Statement of Applicability | ISO 27001 auditor |
| [Part11/](./Part11/) | 21 CFR Part 11 compliance assessment | FDA, Compliance sign-off |
| [DPIA/](./DPIA/) | HIPAA + GDPR Data Protection Impact Assessments | Legal, DPO, regulators |
| [runbooks/](./runbooks/) | Incident response, Disaster recovery, backup/restore drills | On-call engineer, SRE lead |

## Document status conventions

Every artefact carries a frontmatter block:

```yaml
---
title: ...
status: draft | in-review | approved | revised
owner: <role, not person — "Compliance Lead", "DPO", "SRE Lead">
reviewers: ["Head of Engineering", "External auditor firm"]
effective_date: YYYY-MM-DD
next_review: YYYY-MM-DD
version: 1.0
supersedes: <prior-doc-ref or n/a>
---
```

Treat `status: approved` as the authoritative version. Draft is where edits
happen; in-review is handed to the named reviewers; approved is signed.

## Lifecycle

- **Draft** → engineering writes against the current system state.
- **In-review** → compliance + legal + external auditor review.
- **Approved** → signed by owner; effective_date set; immutable until the
  next_review date triggers a revision cycle.
- **Revised** → new document version; previous version remains in git history
  but is linked via `supersedes:`.

Revisions are first-class — compliance artefacts rot the moment the system
changes. Every ADR acceptance (`docs/adr/`) must check whether any approved
compliance doc is now stale.

## Mapping compliance obligations → shipped code

| Obligation | Where implemented | Evidence source |
|---|---|---|
| 21 CFR Part 11 §11.10 audit trail | `apps/api/src/audit/` — hash-chained append-only | `/admin/audit/verify-chain` + `audit_events` table |
| 21 CFR Part 11 §11.300 authority checks | `apps/api/src/auth/rbac.ts` | `/admin/users` + session logs |
| 21 CFR Part 11 §11.10(e) write access control | Postgres triggers on `audit_events` | Migration `00000000000002_audit_trail` + `pg_trigger` output |
| GDPR Art. 5(1)(e) storage limitation | Retention policy (see §Retention below) | `/admin/compliance/retention-report` |
| GDPR Art. 32 encryption at rest | sops+age for secrets (ADR 0006), Postgres TDE on VPS | infra/standalone/scripts/decrypt-env.sh |
| GDPR Art. 15/17 subject access + erasure | Admin API — `GET /admin/users/:id`, `DELETE /admin/users/:id` (soft deprovision) | audit events: `user.deprovision` |
| SOC 2 CC6 access controls | SSO + RBAC + session revocation | `/auth/me`, session rows, audit trail |
| SOC 2 CC7 system operations | Deployment runbooks + health checks | `infra/standalone/scripts/deploy.sh`, `/health` |
| ISO 27001 A.8 asset management | Infra inventory | `infra/standalone/docker-compose.yml`, systemd units |
| ISO 27001 A.12 operations security | Patching + logging + backup | Backup script, Loki logs, OTel traces |

## Retention summary (default)

| Data class | Retention | Rationale |
|---|---|---|
| audit_events | **Indefinite** | Part 11 record of authenticity |
| document_versions + section_contents | **Indefinite** | Content provenance |
| ai_call_records | 7 years | HIPAA minimum necessary + cost auditability |
| notifications | 2 years then truncated | Transactional, not record of authenticity |
| sessions | 90 days after expiry | Security forensics window |
| provenance_records | **Indefinite** | Part 11 AI provenance |

Any deviation needs sign-off from Compliance + DPO.

## External engagements (budget line items)

- **GAMP 5 Validator** — external CSV firm engaged for IQ/OQ/PQ witness
- **SOC 2 Type II auditor** — 6-month evidence window required *before* audit
- **ISO 27001 Certification body** — Stage 1 + Stage 2 audits
- **Pen test firm** — annual + after major arch changes
- **Legal / DPO** — HIPAA BAA with each covered entity customer; GDPR DPA with EU customers
