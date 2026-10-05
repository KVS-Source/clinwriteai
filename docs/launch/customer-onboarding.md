---
title: Customer Onboarding Playbook
status: draft
owner: Head of Customer Success
reviewers: ["Head of Engineering", "Compliance Lead"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# Customer Onboarding Playbook

What happens between a signed contract and the customer's first productive
day on the platform.

## Timeline overview

| Day | Milestone | Owner |
|---|---|---|
| 0 | Contract signed | Sales |
| 0 | Compliance kickoff — DPA/BAA/SCCs | Compliance Lead |
| 1 | Tenant provisioning + SSO config | SRE Lead |
| 2 | Admin user handoff + training | CS Lead |
| 3-5 | Project seeding + module config + RACI | CS Lead w/ customer admin |
| 7 | First user training session | CS Lead |
| 14 | Health check | CS Lead + Head of Eng |
| 30 | Executive review | Account Executive |

## Day 0 — Compliance package

Before any PHI/PII touches the platform:

1. **DPA signed** (GDPR Art. 28). Template approved by external counsel.
2. **BAA signed** (HIPAA §164.308(b)) if customer is a Covered Entity.
3. **SCCs** attached for US sub-processors (Anthropic, WorkOS).
4. **Data residency variant chosen** — see
   `docs/compliance/runbooks/data-residency-strategy.md`.
5. **Compliance artefact bundle delivered** to customer QA:
   - GAMP 5 CSV binder (URS, FS-DS, IQ-OQ-PQ)
   - SOC 2 Type I/II report (NDA)
   - ISO 27001 certificate + SoA
   - Part 11 compliance assessment
   - DPIAs (GDPR + HIPAA)
   - Status page link + SLO doc

## Day 1 — Technical provisioning

Executed by SRE Lead:

```bash
# 1. Create tenant
curl -X PUT https://api.clinwrite.ai/admin/tenants \
  -b "aurora_session=<super-admin>" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"acme-pharma","name":"Acme Pharma","dataResidency":"eu"}'

# 2. Set AI quota (budget negotiated with customer)
curl -X PUT https://api.clinwrite.ai/ai/quotas \
  -b "aurora_session=<super-admin>" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"acme-pharma","monthlyCapUsd":5000,"warnAtPct":80,"rejectAtPct":100}'

# 3. Configure WorkOS organisation
#    - Add customer's SSO IdP (Okta, Azure AD, Google Workspace, etc.)
#    - Enable SCIM provisioning
#    - Scope: tenantId=acme-pharma

# 4. Create the customer's first admin via SCIM
#    (handled by WorkOS once their IdP is connected)
```

Verification:
- [ ] Customer admin can log in
- [ ] `/auth/me` returns correct tenantId
- [ ] `/ai/quotas/<tenant>` returns the configured cap
- [ ] Audit chain pulled before provisioning: `verify-chain` intact

## Day 2 — Admin training (90 min)

Deliverables to customer admin:

1. **Admin UI tour** — users, RACI, library curation, framework registry
   (if super-admin), reports, subscription settings.
2. **RBAC primer** — roles vs modules, module scoping, how to promote users.
3. **Audit trail access** — `/admin/compliance/report` + `/admin/compliance/access-review`.
4. **Compliance posture** — what the status page shows; incident
   notification pathway; where to see their tenant's SOC 2 + ISO 27001
   evidence snapshots.

## Day 3-5 — Project seeding

Customer admin + CS Lead:

1. Create projects (one per clinical trial or submission).
2. Invite users via SSO; assign roles + modules.
3. Set up RACI matrix for the first project's key activities.
4. Seed Master Library with any approved customer-specific content
   (promotional claims, boilerplates). Admin uses `POST /library/sections`.
5. Pre-create a few content items / documents / submissions as training
   scaffolds the real users will edit.

## Day 7 — User training

| Audience | Content | Length |
|---|---|---|
| Clinical writers (Module A) | Document authoring + AI assistance + version history + e-sig flow | 2h |
| Scientific writers (Module B) | Publication wizard + author mgmt + Vancouver citations | 90m |
| Medical writers (Module C) | Content items + claims matrix + Pre-MLR + MLR | 2h |
| Regulatory writers (Module D) | Submission wizard + eCTD + consistency + redaction | 2.5h |
| Ideation leads (Module E) | Artefact import + content cards + atomisation + KOL review | 90m |
| Reviewers | Comment workflow + state transitions + audit visibility | 60m |

Recorded + archived per customer in their training package.

## Day 14 — Health check

CS Lead + Head of Engineering review:

- Login success rate per user (target ≥95%)
- Audit events / user / week (sanity check for engagement)
- AI usage vs quota (projecting monthly spend)
- Any Sev2/Sev3 incidents in the first fortnight
- Open feature requests / bug reports from customer

Customer-facing deliverable: health check report (JSON export from
`/admin/compliance/report` + annotations).

## Day 30 — Executive review

- Account Executive + Head of Customer Success + customer sponsor
- Review usage, satisfaction, open issues
- Roadmap for the next quarter
- Expansion opportunities (more modules, more seats, additional projects)

## Edge cases + escalations

### Customer requires air-gapped / on-premise deployment
- Not supported in current architecture. Flag at sales qualification.
  See `data-residency-strategy.md` dedicated single-tenant variant for
  closest supported model.

### Customer insists on Anthropic processing in their region only
- Default is US; EU is available via Anthropic Business EU tier.
  Confirm at Compliance kickoff.

### Customer wants their own TLS cert (not Cloudflare)
- Supported but requires VPS DNS A record pointed directly, not CF proxy.
  Loses CF WAF. Document in BAA risk acceptance addendum.

### Customer refuses to accept SCCs for Anthropic
- Option 1: switch to `LLM_PROVIDER=mistral` or `azure-openai-eu`.
- Option 2: no-AI mode — disable `FEATURE_AI_GATEWAY`. Customer loses
  AI-assisted features; everything else works.
- Option 3: decline the sale.

### Customer QA requires a specific scope's CSV binder customisation
- IQ/OQ/PQ in `docs/compliance/GAMP5/` are the baseline. Customisation
  via tenant-specific binder maintained by the Compliance Lead + customer
  QA. Not shared across customers.
