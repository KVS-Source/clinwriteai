---
title: Statement of Applicability (SoA) — ISO/IEC 27001:2022 Annex A
status: draft
owner: Security Lead
reviewers: ["Compliance Lead", "ISO 27001 Certification Body"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# Statement of Applicability — Annex A controls

Per ISO/IEC 27001:2022 Annex A (93 controls across 4 themes). Marks each
control as **Applicable** / **Not applicable** with justification.

## Theme A.5 — Organisational controls

| # | Control | A/N | Justification + evidence |
|---|---|---|---|
| A.5.1 | Policies for information security | A | Compliance docs in this folder |
| A.5.2 | Information security roles and responsibilities | A | Role matrix in `SOC2/control-matrix.md` + RACI |
| A.5.3 | Segregation of duties | A | Admin vs super-admin split; deploy keys separate from user accounts |
| A.5.4 | Management responsibilities | A | Weekly security sync + quarterly review |
| A.5.5 | Contact with authorities | A | Incident response runbook names regulators + contact plan |
| A.5.6 | Contact with special interest groups | A | OWASP + SIG membership (TBD) |
| A.5.7 | Threat intelligence | A | Dependabot + CVE monitoring |
| A.5.8 | Information security in project management | A | ADR process includes security review |
| A.5.9 | Inventory of assets | A | `infra/standalone/` + docker-compose.yml |
| A.5.10 | Acceptable use of assets | A | AUP document (TBD) |
| A.5.11 | Return of assets | A | Offboarding runbook (TBD) |
| A.5.12 | Classification of information | A | Retention policy in `../README.md` |
| A.5.13 | Labelling of information | A | Table-level comments in schema (PHI columns commented) |
| A.5.14 | Information transfer | A | TLS 1.2+ enforced; no plaintext file transfers |
| A.5.15 | Access control | A | WorkOS + RBAC (ADR 0005 + `src/auth/rbac.ts`) |
| A.5.16 | Identity management | A | WorkOS SCIM provisioning |
| A.5.17 | Authentication information | A | sops+age for secrets (ADR 0006) |
| A.5.18 | Access rights | A | Admin UI + audit of changes |
| A.5.19 | Information security in supplier relationships | A | DPAs with Anthropic/WorkOS/Hetzner/B2/Cloudflare |
| A.5.20 | Addressing information security within supplier agreements | A | Same |
| A.5.21 | Managing information security in the ICT supply chain | A | npm audit + Dependabot + supply chain policy (TBD) |
| A.5.22 | Monitoring, review and change management of supplier services | A | Quarterly vendor review |
| A.5.23 | Information security for use of cloud services | A | Cloud provider SOC2/ISO27001 attestations collected |
| A.5.24 | Information security incident management planning | A | `runbooks/incident-response.md` |
| A.5.25-28 | Incident response variants | A | Same runbook |
| A.5.29 | Information security during disruption | A | DR plan `runbooks/disaster-recovery.md` |
| A.5.30 | ICT readiness for business continuity | A | Same |
| A.5.31 | Legal, statutory, regulatory and contractual requirements | A | HIPAA + GDPR DPIAs; Part 11 assessment |
| A.5.32 | Intellectual property rights | A | Licence tracking via npm; OSS clearance (TBD) |
| A.5.33 | Protection of records | A | Audit chain + Part 11 retention |
| A.5.34 | Privacy and protection of PII | A | GDPR DPIA + pii-scrub |
| A.5.35 | Independent review of information security | A | Annual pen test + SOC 2 audit |
| A.5.36 | Compliance with policies, rules and standards | A | Compliance monitoring (SOC2 §CC4) |
| A.5.37 | Documented operating procedures | A | runbooks/ folder |

## Theme A.6 — People controls

| # | Control | A/N | Justification + evidence |
|---|---|---|---|
| A.6.1 | Screening | A | Background checks on hire (TBD policy) |
| A.6.2 | Terms and conditions of employment | A | Employment contract + confidentiality clause |
| A.6.3 | Information security awareness, education and training | A | Annual security training (TBD) |
| A.6.4 | Disciplinary process | A | HR policy (TBD) |
| A.6.5 | Responsibilities after termination | A | Offboarding runbook (TBD) |
| A.6.6 | Confidentiality or non-disclosure agreements | A | Signed on hire |
| A.6.7 | Remote working | A | Remote work policy (TBD) + VPN for infrastructure access |
| A.6.8 | Information security event reporting | A | Internal + customer-facing reporting channels |

## Theme A.7 — Physical controls

| # | Control | A/N | Justification |
|---|---|---|---|
| A.7.1-14 | Physical security (perimeter, entry, offices, equipment, cabling, etc.) | N | Fully outsourced to Hetzner (ISO 27001 certified data centres). Attestation on file. |

## Theme A.8 — Technological controls

| # | Control | A/N | Justification + evidence |
|---|---|---|---|
| A.8.1 | User endpoint devices | A | MDM for engineering laptops (TBD) |
| A.8.2 | Privileged access rights | A | super-admin role; audit of role changes |
| A.8.3 | Information access restriction | A | RBAC + tenantId isolation |
| A.8.4 | Access to source code | A | Private GitHub repo; branch protection on main |
| A.8.5 | Secure authentication | A | WorkOS SSO + MFA |
| A.8.6 | Capacity management | A | Prometheus + alerting |
| A.8.7 | Protection against malware | A | Dependabot + CI dep scan; container base image updates |
| A.8.8 | Management of technical vulnerabilities | A | Dependabot + annual pen test |
| A.8.9 | Configuration management | A | Infrastructure as code (`infra/standalone/`) |
| A.8.10 | Information deletion | A | Retention policy; soft-deprovisioning + hard delete on DSR |
| A.8.11 | Data masking | A | PII scrubber on AI prompts; redaction (Module D) |
| A.8.12 | Data leakage prevention | A | Egress monitoring (TBD); audit of large exports |
| A.8.13 | Information backup | A | `infra/standalone/scripts/backup.sh` + B2 off-site |
| A.8.14 | Redundancy of information processing facilities | A | Partial — single VPS year 1; AWS multi-AZ year 2 per ADR 0007 |
| A.8.15 | Logging | A | Loki + audit_events |
| A.8.16 | Monitoring activities | A | Prometheus + Grafana alerts |
| A.8.17 | Clock synchronisation | A | systemd-timesyncd on all nodes |
| A.8.18 | Use of privileged utility programs | A | Deployment via `deploy.sh` through sudo platform user; no direct DB write access from app accounts |
| A.8.19 | Installation of software on operational systems | A | Managed via `deploy.sh` + apt pinning |
| A.8.20 | Networks security | A | ufw + nginx + Cloudflare WAF |
| A.8.21 | Security of network services | A | nginx config in repo + reviewed |
| A.8.22 | Segregation of networks | A | Postgres + Redis bind to 127.0.0.1 only; MinIO behind nginx |
| A.8.23 | Web filtering | N | Not applicable — no outbound browsing from servers |
| A.8.24 | Use of cryptography | A | TLS; sops+age; sha256 audit chain |
| A.8.25 | Secure development life cycle | A | ADR + PR review + CI gates |
| A.8.26 | Application security requirements | A | Zod validation; parameterised queries; rate limits |
| A.8.27 | Secure system architecture and engineering principles | A | ADR series documents each decision |
| A.8.28 | Secure coding | A | ESLint; `npm run typecheck`; code review |
| A.8.29 | Security testing in development and acceptance | A | 75 unit tests + testcontainers integration suite |
| A.8.30 | Outsourced development | N | No outsourced development in current state |
| A.8.31 | Separation of development, test and production environments | A | QA VPS + production VPS kept separate |
| A.8.32 | Change management | A | ADR + PR + CI |
| A.8.33 | Test information | A | Seed data is synthetic; no production data in test envs |
| A.8.34 | Protection of information systems during audit testing | A | Pen test performed in isolated staging env |

## Summary

- **Applicable**: 85
- **Not applicable**: 8 (A.7.* physical controls outsourced; A.8.23 + A.8.30)
- **Partially implemented** (marked A but with TBD evidence): ~15 — see
  `risk-register.md` for remediation tracking.
